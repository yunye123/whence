import fs from 'node:fs/promises';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectStore } from '../../electron/store';
import { detectTools, importMedia, transcribeMedia } from '../../electron/media';
import type { Asset, ProjectState, Source, Transcript } from '../../shared/types';
import { downloadVideo, normalizeVideoInput, xPostSourceFields, type DownloadOptions, type XVideoSource } from './download';
import { imageNoteText, tidyImageText } from './page-media';
import { recognizeImages } from './image-text';
import { normalizeXLink, type XPost } from '../shared/x-import';
import { VIDEO_IMPORT_TERMINAL, type VideoImportInput, type VideoImportStage, type VideoImportTask } from './contracts';
import { readingLines } from './transcript-sentences';
import { TRANSCRIBE_STARTING, transcribeProgressMessage } from './transcribe-progress';
import { IMPORT_MEDIA_GATES, missingToolsMessage, TRANSCRIPTION_GATES, YT_DLP_DOWNLOAD_GATES } from './transcription-readiness';

interface TaskRecord extends VideoImportTask { key: string; localFile?: string; sourceOnly?: boolean }
export interface VideoImportServiceOptions {
  directory: string;
  onTask?: (task: VideoImportTask) => void;
  download?: typeof downloadVideo;
  importMedia?: typeof importMedia;
  transcribeMedia?: typeof transcribeMedia;
  detectTools?: typeof detectTools;
  resolvePublicVideo?: DownloadOptions['resolvePublicVideo'];
  resolveXPost?: DownloadOptions['resolveXPost'];
}
const active = (task: VideoImportTask) => !VIDEO_IMPORT_TERMINAL.has(task.status);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 4096);
const now = () => new Date().toISOString();
function requiredText(value: unknown, label: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || value.includes('\0')) throw new Error(`${label}无效或过长。`);
  return value;
}
function mediaUrl(projectId: string, relative: string) { return `media://${encodeURIComponent(projectId)}/${relative.split(/[\\/]/).map(encodeURIComponent).join('/')}`; }

/** Durable, local-only import queue. This store never switches the legacy editor's project. */
export class VideoImportService {
  /** Info.json descriptions, keyed by source id. Never written into project.sqlite. */
  private descriptions = new Map<string, string>();
  private tasks = new Map<string, TaskRecord>();
  private queue: string[] = [];
  private controllers = new Map<string, AbortController>();
  private stoppingTasks = new Map<string, Promise<void>>();
  private localUploads = new Map<string, Promise<void>>();
  private running = false;
  private closing = false;
  private closePromise: Promise<void> | undefined;
  private lastPersistedAt = 0;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly taskFile: string;
  private readonly store: ProjectStore;
  private readonly options: VideoImportServiceOptions;

  private constructor(store: ProjectStore, options: VideoImportServiceOptions) {
    this.store = store; this.options = options;
    this.taskFile = path.join(store.directory, 'import-tasks.json');
  }

  static async open(options: VideoImportServiceOptions): Promise<VideoImportService> {
    const directory = path.resolve(options.directory);
    await fs.mkdir(path.dirname(directory), { recursive: true });
    const store = existsSync(path.join(directory, 'project.sqlite')) ? ProjectStore.open(directory) : ProjectStore.create(directory, '来处视频素材库');
    const service = new VideoImportService(store, options);
    try {
      if (existsSync(service.taskFile)) {
        const saved: unknown = JSON.parse(readFileSync(service.taskFile, 'utf8'));
        if (!saved || typeof saved !== 'object' || (saved as { schema?: unknown }).schema !== 1 || !Array.isArray((saved as { tasks?: unknown }).tasks)) throw new Error('视频导入任务文件格式无效，请保留资料库并恢复备份。');
        for (const item of (saved as { tasks: unknown[] }).tasks) {
          const record = item as TaskRecord;
          requiredText(record.id, '任务 ID', 200); requiredText(record.boardId, '画布 ID', 200); requiredText(record.nodeId, '卡片 ID', 200);
          requiredText(record.key, '链接标识', 10_000); requiredText(record.url, '链接', 10_000);
          if (!['queued', 'downloading', 'processing', 'media-ready', 'transcribing', 'completed', 'failed', 'cancelled', 'interrupted'].includes(record.status) || !Number.isSafeInteger(record.attempt) || record.attempt < 1 || service.tasks.has(record.id)) throw new Error('视频导入任务记录不完整或重复，请保留资料库并恢复备份。');
          // A prior process cannot still own this queue. Completed assets stay reusable.
          if (active(record)) { record.status = 'interrupted'; record.message = '上次运行已中断；重试会复用已下载的视频。'; record.updatedAt = now(); }
          service.tasks.set(record.id, record);
        }
      }
      service.persist();
      return service;
    } catch (error) { store.close(); throw error; }
  }

  get projectId() { return this.store.state.id; }
  get hasActiveTasks() { return this.running || this.queue.length > 0 || this.controllers.size > 0; }
  get libraryState(): ProjectState { return this.store.state; }
  projectForMedia(projectId: string): ProjectStore | undefined { return projectId === this.projectId ? this.store : undefined; }
  ownsDirectory(directory: string): boolean { return path.resolve(directory).toLowerCase() === this.store.directory.toLowerCase(); }
  list(): VideoImportTask[] { return [...this.tasks.values()].map(task => this.publicTask(task)).reverse(); }

  submit(input: VideoImportInput): VideoImportTask {
    if (this.closing) throw new Error('应用正在退出，请重新打开后导入。');
    if (!input || typeof input !== 'object') throw new Error('请输入视频链接或分享文本。');
    const boardId = requiredText(input.boardId, '画布 ID', 200), nodeId = requiredText(input.nodeId, '卡片 ID', 200);
    const originalText = requiredText(input.originalText || input.url, '分享内容', 20_000);
    const normalized = normalizeVideoInput(requiredText(input.url, '视频链接', 20_000));
    requiredText(normalized.url, '视频链接', 4096);
    const duplicate = [...this.tasks.values()].find(task => task.boardId === boardId && task.nodeId === nodeId && task.key === normalized.key && active(task));
    if (duplicate) return this.publicTask(duplicate);
    if ([...this.tasks.values()].filter(active).length >= 50) throw new Error('已有 50 个导入任务，请等待或取消部分任务后继续。');
    const task: TaskRecord = {
      id: randomUUID(), boardId, nodeId, key: normalized.key, url: normalized.url, originalText,
      platform: normalized.platform, status: 'queued', progress: 0, message: '已加入导入队列', attempt: 1, createdAt: now(), updatedAt: now(),
    };
    this.tasks.set(task.id, task);
    try { this.publish(task); } catch (error) { this.tasks.delete(task.id); throw error; }
    this.queue.push(task.id);
    setImmediate(() => { void this.pump(); });
    return this.publicTask(task);
  }

  async submitLocal(input: { boardId: string; nodeId: string; name: string; data: Uint8Array }): Promise<VideoImportTask> {
    if (this.closing) throw new Error('应用正在退出，请重新打开后转写。');
    const boardId = requiredText(input?.boardId, '画布 ID', 200), nodeId = requiredText(input?.nodeId, '卡片 ID', 200);
    const name = requiredText(input?.name, '视频名称', 500);
    if (!(input.data instanceof Uint8Array) || !input.data.length || input.data.byteLength > 64 * 1024 * 1024) throw new Error('视频为空或超过 64 MB，请使用桌面媒体工具导入较大的文件。');
    const digest = createHash('sha256').update(input.data).digest('hex'); const key = `local:${digest}`;
    const existing = [...this.tasks.values()].find(task => task.boardId === boardId && task.nodeId === nodeId && task.key === key);
    if (existing) return active(existing) || existing.status === 'completed' ? this.publicTask(existing) : this.retry(existing.id);
    if ([...this.tasks.values()].filter(active).length >= 50) throw new Error('已有 50 个任务，请等待部分任务完成后再转写。');
    const directory = path.join(this.store.directory, 'cache', 'local-inputs'); await fs.mkdir(directory, { recursive: true });
    const ext = /\.(mp4|webm|mov|m4v|ogv)$/i.exec(name)?.[0].toLowerCase() || '.mp4';
    const localFile = path.join(directory, `${digest}${ext}`);
    let upload = this.localUploads.get(localFile);
    if (!upload) {
      upload = (async () => {
        const previous = await fs.readFile(localFile).catch(error => { if (error.code !== 'ENOENT') throw error; return undefined; });
        if (previous && createHash('sha256').update(previous).digest('hex') === digest) return;
        const temporary = `${localFile}.${randomUUID()}.next`;
        try { await fs.writeFile(temporary, input.data, { flag: 'wx' }); await fs.rename(temporary, localFile); }
        finally { await fs.rm(temporary, { force: true }); }
      })(); this.localUploads.set(localFile, upload);
      void upload.finally(() => { if (this.localUploads.get(localFile) === upload) this.localUploads.delete(localFile); }).catch(() => {});
    }
    await upload;
    if (this.closing) throw new Error('应用正在退出，视频已保留；重新打开后再生成逐字稿。');
    const concurrentlyCreated = [...this.tasks.values()].find(task => task.boardId === boardId && task.nodeId === nodeId && task.key === key);
    if (concurrentlyCreated) return active(concurrentlyCreated) || concurrentlyCreated.status === 'completed' ? this.publicTask(concurrentlyCreated) : this.retry(concurrentlyCreated.id);
    if ([...this.tasks.values()].filter(active).length >= 50) throw new Error('已有 50 个任务，请等待部分任务完成后再转写。');
    const task: TaskRecord = { id: randomUUID(), boardId, nodeId, key, localFile, url: `field-local://${digest}`, originalText: name, platform: '本机视频', status: 'queued', progress: 0, message: '等待生成逐字稿', attempt: 1, createdAt: now(), updatedAt: now() };
    this.tasks.set(task.id, task); try { this.publish(task); } catch (error) { this.tasks.delete(task.id); throw error; }
    this.queue.push(task.id); setImmediate(() => { void this.pump(); }); return this.publicTask(task);
  }

  async cancel(taskId: string, expectedAttempt?: number): Promise<VideoImportTask> {
    const task = this.task(taskId);
    if (expectedAttempt !== undefined && expectedAttempt !== task.attempt) throw new Error('任务已重新开始，旧的取消请求不会影响新任务。');
    if (!active(task)) return this.publicTask(task);
    this.queue = this.queue.filter(id => id !== task.id);
    this.controllers.get(task.id)?.abort();
    this.update(task, { status: 'cancelled', message: task.assetId ? '已取消，已下载的视频已保留。' : '已取消下载。', error: undefined });
    await this.stoppingTasks.get(task.id);
    return this.publicTask(task);
  }

  async retry(taskId: string): Promise<VideoImportTask> {
    if (this.closing) throw new Error('应用正在退出，请重新打开后重试。');
    const task = this.task(taskId);
    await this.stoppingTasks.get(task.id);
    if (active(task)) return this.publicTask(task);
    const sourceOnly = task.sourceOnly || (task.status === 'completed' && task.platform === 'X' && this.needsXPostText(this.taskSource(task)));
    if (task.status === 'completed' && !sourceOnly) return this.publicTask(task);
    if ([...this.tasks.values()].filter(active).length >= 50) throw new Error('已有 50 个导入任务，请等待或取消部分任务后继续。');
    this.update(task, { status: 'queued', progress: 0, message: sourceOnly ? '等待补齐 X 原帖正文，将保留已下载视频与逐字稿。' : task.assetId ? '等待继续生成逐字稿，将复用已下载的视频。' : '等待重新下载', error: undefined, attempt: task.attempt + 1, sourceOnly });
    this.queue.push(task.id); setImmediate(() => { void this.pump(); });
    return this.publicTask(task);
  }

  close(): Promise<void> {
    return this.closePromise ||= this.finishClosing();
  }

  private async finishClosing(): Promise<void> {
    this.closing = true;
    this.queue = [];
    try {
      for (const task of this.tasks.values()) if (active(task)) this.update(task, { status: 'interrupted', message: '应用已关闭；重新打开后可继续，已下载的视频已保留。' });
    } catch (error) { this.failPersistence(error); }
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled(this.stoppingTasks.values());
    // A broken disk must not strand the desktop window after its workers have stopped.
    // The last durable active record will become interrupted on the next open.
    try { this.persist(); } catch (error) { this.failPersistence(error); } finally { this.store.close(); }
  }

  private task(id: string): TaskRecord {
    const task = this.tasks.get(requiredText(id, '任务 ID', 200));
    if (!task) throw new Error('找不到这项视频导入任务。');
    return task;
  }
  private publicTask(task: TaskRecord): VideoImportTask {
    const { key: _key, localFile: _local, sourceOnly: _sourceOnly, ...result } = task;
    if (task.platform === 'X' && result.card) {
      const source = this.taskSource(task);
      result.card = { ...result.card, sourceOriginalText: typeof source?.postText === 'string' ? source.postText : undefined, sourceStatus: this.xPostStatus(source) };
      delete result.card.body;
    }
    return structuredClone(result);
  }
  private persist(force = true) {
    if (!force && Date.now() - this.lastPersistedAt < 350) {
      if (!this.persistTimer) this.persistTimer = setTimeout(() => {
        this.persistTimer = undefined;
        try { this.persist(); } catch (error) { this.failPersistence(error); }
      }, 350 - (Date.now() - this.lastPersistedAt));
      return;
    }
    clearTimeout(this.persistTimer); this.persistTimer = undefined;
    const temporary = `${this.taskFile}.next`;
    writeFileSync(temporary, JSON.stringify({ schema: 1, tasks: [...this.tasks.values()] }), 'utf8');
    renameSync(temporary, this.taskFile);
    this.lastPersistedAt = Date.now();
  }
  private emit(task: TaskRecord) {
    // IPC delivery is observational. A vanished renderer must not undo durable jobs.
    try { this.options.onTask?.(this.publicTask(task)); } catch (error) { console.error('视频任务事件未送达；可从任务列表恢复：', error); }
  }
  private publish(task: TaskRecord, force = true) { this.persist(force); this.emit(task); }
  private update(task: TaskRecord, patch: Partial<TaskRecord>, force = true) {
    const previous = structuredClone(task);
    if (patch.message) patch.message = patch.message.slice(0, 4096);
    if (patch.error) patch.error = patch.error.slice(0, 4096);
    Object.assign(task, patch, { updatedAt: now() });
    try { this.publish(task, force); }
    catch (error) {
      for (const key of Object.keys(task)) delete (task as unknown as Record<string, unknown>)[key];
      Object.assign(task, previous);
      throw error;
    }
  }
  private failPersistence(error: unknown) {
    console.error('视频导入队列保存失败：', error);
    const reason = Object.assign(new Error(errorText(error)), { name: 'PersistenceError' });
    for (const controller of this.controllers.values()) controller.abort(reason);
    for (const task of this.tasks.values()) if (active(task)) {
      Object.assign(task, { status: 'failed', error: errorText(error), message: `本机任务保存失败：${errorText(error)}`.slice(0, 4096), updatedAt: now() });
      this.emit(task);
    }
    this.queue = [];
  }
  private checkAbort(signal: AbortSignal) { if (signal.aborted) throw Object.assign(new Error('任务已取消'), { name: 'AbortError' }); }
  private async checkedTools(signal: AbortSignal) {
    this.checkAbort(signal);
    try { return await (this.options.detectTools || detectTools)(); }
    catch (error) {
      if (signal.aborted) throw error;
      throw new Error('没有检查成本机的转写工具。请打开侧栏「本机工具」再检查一次。');
    }
  }
  private async gap(signal: AbortSignal, names: readonly string[], cache: { tools?: Awaited<ReturnType<typeof detectTools>> }): Promise<string | null> {
    if (!cache.tools) cache.tools = await this.checkedTools(signal);
    return missingToolsMessage(cache.tools.checks, names);
  }
  private progress(task: TaskRecord, status: VideoImportStage, progress: number, message: string) {
    if (this.closing || this.controllers.get(task.id)?.signal.aborted) return;
    const rounded = Math.max(0, Math.min(99, Math.round(progress)));
    if (task.status === status && task.progress === rounded && task.message === message) return;
    this.update(task, { status, progress: rounded, message }, false);
  }

  private async pump() {
    if (this.running || this.closing) return;
    this.running = true;
    try {
      while (this.queue.length && !this.closing) {
        const task = this.task(this.queue.shift()!);
        if (task.status !== 'queued') continue;
        const controller = new AbortController(); this.controllers.set(task.id, controller);
        let stopped!: () => void;
        this.stoppingTasks.set(task.id, new Promise<void>(resolve => { stopped = resolve; }));
        try { await this.run(task, controller.signal); }
        catch (error) {
          // A disk failure is not a user cancellation. failPersistence already exposed it.
          if (controller.signal.reason?.name === 'PersistenceError') continue;
          const status = this.closing ? 'interrupted' : controller.signal.aborted ? 'cancelled' : 'failed';
          const detail = errorText(error);
          this.update(task, { status, error: status === 'failed' ? detail : undefined,
            message: status === 'interrupted' ? '上次运行已中断；重试会复用已下载的视频。' : status === 'cancelled' ? (task.assetId ? '已取消，已下载的视频已保留。' : '已取消下载。') : task.sourceOnly ? `原帖正文尚未补齐；原视频记录与逐字稿已保留：${detail}` : (task.assetId ? `视频已保存，逐字稿未完成：${detail}` : `视频导入失败：${detail}`) });
        } finally { this.controllers.delete(task.id); this.stoppingTasks.delete(task.id); stopped(); }
      }
    } catch (error) {
      // Disk errors must be visible; never report an unsaved background task as complete.
      this.failPersistence(error);
    } finally { this.running = false; }
  }

  private async importImages(task: TaskRecord, source: { id: string }, downloaded: { imageFiles?: string[]; source: Partial<XVideoSource>; description?: string }, signal: AbortSignal) {
    const files = downloaded.imageFiles || [];
    if (!files.length) throw new Error('公开页没有返回可下载的图片。');
    this.progress(task, 'processing', 8, '正在识别图片上的文字');
    const recognized = await recognizeImages(files, signal);
    this.checkAbort(signal);
    const pages = files.map((_file, index) => tidyImageText(recognized.texts[index] || ''));
    const assets: Asset[] = [];
    for (let index = 0; index < files.length; index++) {
      this.progress(task, 'processing', 30 + 50 * index / files.length, `正在保存图片（${index + 1}/${files.length}）`);
      const imported = await (this.options.importMedia || importMedia)(files[index], this.store.directory, { signal });
      this.checkAbort(signal);
      if (imported.kind !== 'image') throw new Error('链接取得的文件不是图片。');
      assets.push({ ...imported, id: randomUUID(), sourceId: source.id, name: `${downloaded.source.title || task.platform} ${index + 1}`.slice(0, 500), createdAt: now() });
    }
    const title = String(downloaded.source.title || `${task.platform}图文`).replace(/\s*[-–|]\s*(抖音|小红书).*$/, '').trim().slice(0, 500) || `${task.platform}图文`;
    const author = String(downloaded.source.author || '').trim().slice(0, 500);
    const description = downloaded.description?.trim().slice(0, 20_000);
    const body = imageNoteText({ ...(author ? { author } : {}), ...(description ? { description } : {}), pages });
    const recognizedCount = pages.filter(page => page.trim()).length;
    const message = !recognized.available
      ? `已导入 ${files.length} 张图片。识图程序没找到，图片上的文字还没有识别。请重新运行安装目录里的「安装并检查」。`
      : recognizedCount ? `已导入 ${files.length} 张图片，并识别了其中 ${recognizedCount} 张上的文字。` : `已导入 ${files.length} 张图片。没有识别到图片上的文字。`;
    const library = this.store.state;
    const carried = {
      sourceUrl: task.url, sourceTitle: title, ...(author ? { sourceAuthor: author } : {}), sourceOriginalText: task.originalText,
      nativeProjectId: library.id, nativeDirectory: library.directory, nativeSourceId: source.id, nativeImportJobId: task.id, collectedAt: now(),
    };
    const companions = assets.map((asset, index) => ({
      id: randomUUID(),
      data: {
        kind: 'image' as const, title: `${index + 1} ${title}`.slice(0, 500), body: (pages[index] || '这一张没有识别到文字。').slice(0, 300_000),
        url: mediaUrl(library.id, asset.path), ...(asset.poster ? { poster: mediaUrl(library.id, asset.poster) } : {}), ...carried,
      },
    }));
    const card = {
      kind: 'note' as const, title, body, pictures: companions.map(item => item.data.url).filter((url): url is string => !!url),
      ...carried, ...(description ? { sourceDescription: description } : {}), sourceStatus: '已从公开页保存图片',
    };
    if (description) this.descriptions.set(source.id, description);
    this.store.commit(state => {
      for (const asset of assets) state.assets.push(asset);
      const item = state.sources.find(entry => entry.id === source.id);
      if (item) Object.assign(item, downloaded.source, { id: item.id, url: task.url, originalText: task.originalText, status: '已导入', error: undefined,
        title: title.slice(0, 2000), author: author.slice(0, 2000) });
    });
    this.update(task, { sourceId: source.id, status: 'completed', progress: 100, message, card, companions, error: undefined });
  }

  private async reusableAsset(task: TaskRecord): Promise<Asset | undefined> {
    const state = this.store.state;
    const sourceIds = new Set(state.sources.filter(source => {
      try { return normalizeVideoInput(source.url).key === task.key; } catch { return false; }
    }).map(source => source.id));
    const candidates = state.assets.filter(asset => asset.kind === 'video' && (asset.id === task.assetId || (asset.sourceId && sourceIds.has(asset.sourceId)))).reverse();
    for (const asset of candidates) {
      try { if ((await fs.stat(path.join(this.store.directory, asset.path))).isFile()) return asset; } catch { /* A deleted cache will be downloaded again. */ }
    }
    return undefined;
  }
  private taskSource(task: TaskRecord, asset?: Asset): XVideoSource | undefined {
    const state = this.store.state;
    const sourceId = asset?.sourceId || task.sourceId || state.assets.find(item => item.id === task.assetId)?.sourceId;
    return state.sources.find(item => item.id === sourceId) as XVideoSource | undefined;
  }
  private needsXPostText(source?: XVideoSource): boolean {
    return source?.postTextStatus !== 'complete' || typeof source.postText !== 'string';
  }
  private xPostStatus(source?: XVideoSource): string {
    if (source?.postTextStatus === 'complete' && typeof source.postText === 'string') return source.postText.trim() ? '已保存完整原帖正文；由公开内容服务获取。' : '原帖没有文字正文；已通过公开内容服务核对。';
    if (typeof source?.postText === 'string' && source.postText) return `仅取得原帖正文预览${source.postTextError ? `；${source.postTextError}` : '，原帖可能还有内容。'}`;
    return `原帖正文尚未取得，视频已保留${source?.postTextError ? `；${source.postTextError}` : '。可重试补齐正文。'}`;
  }
  private async fillXPostText(task: TaskRecord, asset: Asset, signal: AbortSignal): Promise<string | undefined> {
    let source = this.taskSource(task, asset);
    if (!this.needsXPostText(source)) return undefined;
    this.progress(task, 'processing', 0, '正在补齐 X 原帖正文，已下载视频保持可用。');
    let post: XPost;
    try {
      const resolve = this.options.resolveXPost || (await import('./x-import')).resolveXPost;
      post = await resolve(task.url, { signal });
      this.checkAbort(signal);
      if (post.id !== normalizeXLink(task.url).id) throw new Error('取得的 X 原帖与视频来源不一致，尚未补充正文。');
    } catch (error) {
      if (signal.aborted) throw error;
      const detail = errorText(error).slice(0, 1024);
      if (source) this.store.commit(state => {
        const item = state.sources.find(entry => entry.id === source!.id) as XVideoSource;
        item.postTextStatus = item.postText ? 'partial' : 'unavailable'; item.postTextError = detail;
      });
      return `原帖正文暂未补齐，已下载视频与逐字稿已保留：${detail}`;
    }
    const patch = xPostSourceFields(post);
    // Storage failures remain task failures; they must never be reported as a successful source refresh.
    this.store.commit(state => {
      if (!source) {
        source = { id: randomUUID(), url: task.url, originalText: task.originalText, platform: 'X', title: '', author: '', status: '已导入', createdAt: now() };
        state.sources.push(source);
        const existing = state.assets.find(item => item.id === asset.id)!;
        existing.sourceId = source.id;
      }
      const item = state.sources.find(entry => entry.id === source!.id) as XVideoSource;
      Object.assign(item, patch);
    });
    asset.sourceId = source!.id;
    this.update(task, { sourceId: source!.id });
    return post.completeness === 'partial' ? '原帖正文仍是预览，已如实保留；可以稍后重试补全。' : undefined;
  }
  private card(task: TaskRecord, asset: Asset) {
    const state = this.store.state;
    const source = state.sources.find(item => item.id === asset.sourceId) as XVideoSource | undefined;
    const transcript = state.transcripts.filter(item => item.assetId === asset.id).at(-1);
    return {
      kind: 'video' as const, title: (source?.title || asset.name).slice(0, 500), ...(task.platform === 'X' ? {} : { body: '' }),
      url: mediaUrl(state.id, asset.proxy || asset.path), poster: asset.poster ? mediaUrl(state.id, asset.poster) : undefined,
      duration: asset.durationMs / 1000,
      nativeAssetId: asset.id, nativeProjectId: state.id, nativeDirectory: state.directory, nativeSourceId: source?.id,
      nativeHasAudio: asset.hasAudio, nativeImportJobId: task.id, nativeTranscriptId: transcript?.id,
      sourceUrl: task.localFile ? undefined : task.url, sourceTitle: source?.title, sourceAuthor: source?.author,
      ...(source?.id && this.descriptions.get(source.id) ? { sourceDescription: this.descriptions.get(source.id) } : {}),
      sourceOriginalText: task.localFile ? undefined : task.platform === 'X' ? (typeof source?.postText === 'string' ? source.postText : undefined) : task.originalText,
      ...(task.platform === 'X' ? { sourceStatus: this.xPostStatus(source) } : {}),
      // CORE-06: lines regrouped from word times, so no word is split across two lines.
      transcript: transcript ? readingLines(transcript.segments, state.content.corrections) : undefined,
    };
  }
  private async run(task: TaskRecord, signal: AbortSignal) {
    let asset = await this.reusableAsset(task);
    let sourceWarning: string | undefined;
    const cache: { tools?: Awaited<ReturnType<typeof detectTools>> } = {};
    this.checkAbort(signal);
    if (task.sourceOnly && !asset) throw new Error('已下载的视频文件已缺失，暂不能只补正文；未重新下载视频。');
    if (asset) {
      this.update(task, { assetId: asset.id, sourceId: asset.sourceId, reused: true, message: '已找到同链接视频，复用本机素材。' });
      if (task.platform === 'X') sourceWarning = await this.fillXPostText(task, asset, signal);
      this.checkAbort(signal);
      if (task.sourceOnly) {
        this.update(task, { status: 'completed', progress: 100, message: sourceWarning || 'X 原帖正文已补齐，原视频与逐字稿保持不变。', card: this.card(task, asset), error: undefined, sourceOnly: undefined });
        return;
      }
    } else if (task.localFile) {
      const prep = await this.gap(signal, IMPORT_MEDIA_GATES, cache);
      if (prep) { this.update(task, { status: 'failed', message: prep, error: prep }); return; }
      const file = path.resolve(task.localFile), directory = path.resolve(this.store.directory, 'cache', 'local-inputs');
      if (path.dirname(file) !== directory || !/^[a-f0-9]{64}\.(mp4|webm|mov|m4v|ogv)$/.test(path.basename(file))) throw new Error('本机视频记录无效，请重新粘贴视频。');
      this.progress(task, 'processing', 0, '正在准备本机视频');
      const imported = await (this.options.importMedia || importMedia)(file, this.store.directory, { signal, onProgress: (progress, message) => this.progress(task, 'processing', progress, message) });
      this.checkAbort(signal); if (imported.kind !== 'video') throw new Error('请选择可播放的视频文件。');
      asset = { ...imported, name: task.originalText, id: randomUUID(), createdAt: now() };
      this.store.commit(state => { state.assets.push(asset!); }); this.update(task, { assetId: asset.id });
    } else {
      // Bilibili and YouTube fail inside yt-dlp when a tool is missing. Say which one first.
      // Douyin and Xiaohongshu keep their hidden-window download and the error text that path already uses.
      if (task.platform === 'B站' || task.platform === 'YouTube') {
        const gap = await this.gap(signal, YT_DLP_DOWNLOAD_GATES, cache);
        if (gap) { this.update(task, { status: 'failed', message: gap, error: gap }); return; }
      }
      this.progress(task, 'downloading', 0, '正在解析视频链接');
      let source = this.store.state.sources.find(item => { try { return normalizeVideoInput(item.url).key === task.key; } catch { return false; } });
      if (!source) {
        source = { id: randomUUID(), url: task.url, originalText: task.originalText, platform: task.platform, title: new URL(task.url).hostname, author: '', status: '下载中', createdAt: now() };
        this.store.commit(state => { state.sources.push(source!); });
      }
      this.update(task, { sourceId: source.id });
      const downloaded = await (this.options.download || downloadVideo)(task.url, this.store.directory, {
        signal, resolvePublicVideo: this.options.resolvePublicVideo, resolveXPost: this.options.resolveXPost,
        onProgress: (progress, message) => this.progress(task, 'downloading', progress, message),
      });
      try {
        this.checkAbort(signal);
        if (downloaded.imageFiles?.length) {
          await this.importImages(task, source, downloaded, signal);
          return;
        }
        this.progress(task, 'processing', 0, '视频已下载，正在准备播放画面');
        const prep = await this.gap(signal, IMPORT_MEDIA_GATES, cache);
        if (prep) { this.update(task, { status: 'failed', message: prep, error: prep }); return; }
        const imported = await (this.options.importMedia || importMedia)(downloaded.filePath, this.store.directory, {
          signal, onProgress: (progress, message) => this.progress(task, 'processing', progress, message),
        });
        this.checkAbort(signal);
        if (imported.kind !== 'video') throw new Error('链接取得的文件不是视频。');
        if (downloaded.description) this.descriptions.set(source.id, downloaded.description);
        asset = { ...imported, id: randomUUID(), sourceId: source.id, createdAt: now() };
        this.store.commit(state => {
          state.assets.push(asset!);
          const item = state.sources.find(entry => entry.id === source!.id)!;
          Object.assign(item, downloaded.source, { id: item.id, url: task.url, originalText: task.originalText, status: '已导入', error: undefined,
            title: String(downloaded.source.title || item.title).slice(0, 2000), author: String(downloaded.source.author || item.author).slice(0, 2000) });
        });
        this.update(task, { assetId: asset.id, sourceId: source.id, reused: false });
      } finally {
        // The downloader owns one UUID directory. Never remove arbitrary result parents.
        const temporary = path.resolve(path.dirname(downloaded.filePath));
        const parent = path.resolve(this.store.directory, 'cache', 'downloads');
        if (path.dirname(temporary) === parent && /^[a-f0-9-]{36}$/i.test(path.basename(temporary))) await fs.rm(temporary, { recursive: true, force: true });
      }
    }
    this.checkAbort(signal);
    const withSourceWarning = (message: string) => sourceWarning ? `${message} ${sourceWarning}` : message;
    this.update(task, { status: 'media-ready', progress: 100, message: withSourceWarning('视频已加入画布，可以播放了。'), card: this.card(task, asset) });
    const existing = this.store.state.transcripts.filter(item => item.assetId === asset.id).at(-1);
    if (!asset.hasAudio) {
      this.update(task, { status: 'completed', progress: 100, message: withSourceWarning('视频已导入；此视频没有音轨。'), card: { ...this.card(task, asset), transcript: [] } }); return;
    }
    if (existing) {
      this.update(task, { status: 'completed', progress: 100, message: withSourceWarning('已复用本机视频与逐字稿。'), card: this.card(task, asset), asr: { engine: existing.engine, device: existing.device, elapsedSeconds: existing.elapsedSeconds } }); return;
    }
    const tools = cache.tools ?? await this.checkedTools(signal);
    const gap = missingToolsMessage(tools.checks, TRANSCRIPTION_GATES);
    if (gap) {
      const message = `视频已在画布上，还不能转写。${gap}`;
      this.update(task, { status: 'failed', progress: 100, message, error: message, card: this.card(task, asset) });
      return;
    }
    this.progress(task, 'transcribing', 0, TRANSCRIBE_STARTING);
    const result = await (this.options.transcribeMedia || transcribeMedia)(asset, this.store.directory, tools, {
      // CORE-12: “转写中 0:12 / 2:41”, never the device, batch size or a raw GPU error.
      signal, onProgress: (progress, message) => this.progress(task, 'transcribing', progress, transcribeProgressMessage(message, asset.durationMs / 1000)),
    });
    this.checkAbort(signal);
    const transcript: Transcript = { ...result, id: randomUUID(), assetId: asset.id, createdAt: now() };
    this.store.commit(state => { state.transcripts.push(transcript); });
    this.update(task, { status: 'completed', progress: 100, message: withSourceWarning(transcript.segments.length ? '视频与逐字稿已就绪。' : '视频已导入；未识别到可转写的语音。'),
      card: this.card(task, asset), asr: { engine: transcript.engine, device: transcript.device, elapsedSeconds: transcript.elapsedSeconds } });
  }
}
