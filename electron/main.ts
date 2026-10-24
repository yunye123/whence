import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, shell, clipboard } from 'electron';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ProjectStore } from './store';
import { exportDocument, exportProject, restoreProject } from './export';
import { detectTools, importMedia, transcribeMedia, captureFrame, resolveLink } from './media';
import { followAppearance, savedAppearance, windowGround } from '../studio/native/window-appearance';
import * as canvasDesktop from '../studio/native/canvas-desktop';
import type { Asset, CanvasItem, Content, Job, ProjectState, Source } from '../shared/types';

/** Bundled main.cjs lives in studio/dist-native. Workers, the icon and the offline page stay in studio/. */
const studioRoot = path.join(__dirname, '..');

protocol.registerSchemesAsPrivileged(['media', 'field-media'].map(scheme => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } })));
let window: BrowserWindow;
let store: ProjectStore | null = null;
let closing = false;
let exporting = false;
let queueRunning = false;
const controllers = new Map<string, AbortController>();
const queue: { id: string; store: ProjectStore; run: (signal: AbortSignal, progress: (value: number, text: string) => void) => Promise<void> }[] = [];
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const linkFailure = (error: unknown) => {
  const detail = errorText(error);
  if (/fresh cookies|sign.?in|login|verification|captcha/i.test(detail)) return '平台要求浏览器验证或登录状态，暂时无法取得视频。来源已保留，请补充本地视频；技术详情可在任务列表查看。';
  if (/no video formats|no formats found/i.test(detail)) return '下载器没有找到可用视频。来源已保留，请补充本地视频；技术详情可在任务列表查看。';
  return `未能取得视频，来源已保留。可以补充本地视频继续使用。${detail.slice(-400)}`;
};
const current = () => { if (!store) throw new Error('请先创建或打开项目'); return store; };
const send = () => { if (store && window && !window.isDestroyed()) window.webContents.send('studio:state', store.state); };
function commit(target: ProjectStore, change: (state: ProjectState) => void) { const result = target.commit(change); if (target === store) send(); return result; }
const now = () => new Date().toISOString();
const uuid = () => randomUUID();
function assertIdle() {
  if (queueRunning || queue.length || exporting) throw new Error('请先完成或取消后台任务，再切换项目');
}
function assertWritable() { if (exporting) throw new Error('正在切换或打包项目，请稍后重试'); }
async function projectOperation<T>(operation: () => Promise<T>): Promise<T> {
  assertIdle(); exporting = true;
  try { return await operation(); } finally { exporting = false; }
}
async function remember(target: ProjectStore) {
  await fs.writeFile(path.join(app.getPath('userData'), 'last-project.json'), JSON.stringify({ directory: target.state.directory }));
}
async function selectDirectory(title: string) {
  const result = await dialog.showOpenDialog(window, { title, properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? undefined : result.filePaths[0];
}
function useStore(target: ProjectStore) {
  const previous = store; store = target; previous?.close(); send(); void remember(target).catch(console.error); return target.state;
}
function addNode(state: ProjectState, type: CanvasItem['type'], entityId: string) {
  const v = state.content.viewport; const index = state.content.nodes.length;
  state.content.nodes.push({ id: uuid(), type, entityId, x: (-v.x + 80) / v.zoom + (index % 3) * 65, y: (-v.y + 65) / v.zoom + (index % 5) * 55, width: type === 'video' ? 860 : 400, height: type === 'video' ? 500 : 380, group: '', createdRevision: state.revision + 1 });
}
function enqueue(target: ProjectStore, kind: Job['kind'], input: string, run: typeof queue[number]['run'], identifiers: Partial<Job> = {}) {
  const id = uuid();
  commit(target, state => state.jobs.unshift({ id, kind, status: 'queued', progress: 0, message: '等待处理', input, createdAt: now(), ...identifiers }));
  queue.push({ id, store: target, run }); void pump(); return id;
}
async function pump() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (queue.length) {
      const entry = queue.shift()!; const controller = new AbortController(); controllers.set(entry.id, controller);
      const update = (change: Partial<Job>) => commit(entry.store, s => { const job = s.jobs.find(j => j.id === entry.id); if (job) Object.assign(job, change); });
      update({ status: 'running', message: '处理中' });
      let lastProgress = 0;
      try {
        await entry.run(controller.signal, (value, text) => { if (Date.now() - lastProgress > 350 || value >= 100) { lastProgress = Date.now(); update({ progress: Math.max(0, Math.min(99, value)), message: text }); } });
        if (controller.signal.aborted) throw new Error('已取消');
        update({ status: 'completed', progress: 100, message: '已完成', error: undefined });
      } catch (error) {
        update({ status: controller.signal.aborted ? 'cancelled' : 'failed', message: controller.signal.aborted ? '已取消' : '处理失败', error: errorText(error) });
      } finally { controllers.delete(entry.id); }
    }
  } finally { queueRunning = false; }
}
function registerAsset(target: ProjectStore, result: Omit<Asset, 'id' | 'createdAt' | 'sourceId'>, sourceId?: string) {
  const asset: Asset = { ...result, id: uuid(), createdAt: now(), sourceId };
  commit(target, state => { state.assets.push(asset); addNode(state, asset.kind, asset.id); if (sourceId) { const source = state.sources.find(s => s.id === sourceId); if (source) { source.status = '已导入'; source.error = undefined; } } });
  return asset;
}
async function importPaths(paths: string[], sourceId?: string) {
  assertWritable();
  const target = current();
  if (sourceId && !target.state.sources.some(s => s.id === sourceId)) throw new Error('来源已不存在');
  for (const input of paths) {
    if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('无效的文件路径');
    enqueue(target, 'import', input, async (signal, onProgress) => {
      const result = await importMedia(input, target.state.directory, { signal, onProgress });
      if (signal.aborted) return;
      registerAsset(target, result, sourceId);
    }, { sourceId });
  }
}
function startTranscript(id: string, cpu = false) {
  assertWritable();
  const target = current(); const asset = target.state.assets.find(a => a.id === id);
  if (!asset || asset.kind !== 'video') throw new Error('找不到视频');
  if (!asset.hasAudio) throw new Error('这条视频没有音轨，可以使用手动选段和截图');
  if (target.state.jobs.some(j => j.assetId === id && j.kind === 'transcribe' && ['queued', 'running'].includes(j.status))) throw new Error('该视频已在转写队列中');
  enqueue(target, 'transcribe', id, async (signal, onProgress) => {
    const tools = await detectTools();
    const result = await transcribeMedia(asset, target.state.directory, tools, { signal, cpu, onProgress });
    if (!signal.aborted) commit(target, state => state.transcripts.push({ ...result, id: uuid(), assetId: id, createdAt: now() }));
  }, { assetId: id });
}
function startLink(text: string, existingSourceId?: string) {
  assertWritable();
  const target = current(); const matched = text.match(/https?:\/\/[^\s<>"\u3000]+/i);
  if (!matched) throw new Error('请粘贴包含 http 或 https 链接的分享内容');
  const url = matched[0].replace(/[，。；！）》」]+$/g, '');
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('不支持的链接');
  const source: Source = { id: existingSourceId ?? uuid(), url, originalText: text, platform: /douyin/.test(parsed.hostname) ? '抖音' : /xiaohongshu|xhslink/.test(parsed.hostname) ? '小红书' : '网页', title: parsed.hostname, author: '', status: '等待解析', createdAt: now() };
  commit(target, state => { if (!existingSourceId) { state.sources.push(source); addNode(state, 'source', source.id); } else { const item = state.sources.find(s => s.id === existingSourceId); if (item) { item.status = '等待解析'; item.error = undefined; } } });
  enqueue(target, 'link', text, async (signal, onProgress) => {
    try {
      const result = await resolveLink(text, target.state.directory, { signal, onProgress });
      let media: Omit<Asset, 'id' | 'createdAt' | 'sourceId'>;
      try { media = await importMedia(result.filePath, target.state.directory, { signal, onProgress }); }
      finally {
        const directory = path.resolve(path.dirname(result.filePath));
        const downloads = path.resolve(target.state.directory, 'cache', 'downloads');
        if (path.dirname(directory) === downloads && /^[a-f0-9-]{36}$/i.test(path.basename(directory))) await fs.rm(directory, { recursive: true, force: true });
      }
      if (signal.aborted) return;
      commit(target, state => { const item = state.sources.find(s => s.id === source.id)!; Object.assign(item, result.source, { id: source.id, originalText: text, createdAt: source.createdAt }); });
      registerAsset(target, media, source.id);
    } catch (error) {
      commit(target, state => { const item = state.sources.find(s => s.id === source.id); if (item) { item.status = signal.aborted ? '已取消' : '待补充视频'; item.error = signal.aborted ? '解析已取消，来源链接已保留。' : linkFailure(error); } });
      throw error;
    }
  }, { sourceId: source.id });
}

async function pasteClipboard() {
  assertWritable();
  const target = current();
  const stillCurrent = () => { assertWritable(); if (store !== target) throw new Error('项目已切换，请重新粘贴'); };
  // Use the installed Electron API; keep compatibility with both documented API generations.
  const cb = clipboard as unknown as { read?: () => Promise<{types: string[]; getType: (type: string) => Promise<Blob>}[]>; readImage?: () => Electron.NativeImage; readText: () => string | Promise<string>; availableFormats?: () => string[]; readBuffer?: (type: string) => Buffer };
  let image: Buffer | undefined; let files: string[] = [];
  function dropFiles(buffer: Buffer) {
    if (buffer.length < 20) return;
    const offset = buffer.readUInt32LE(0); if (offset < 20 || offset >= buffer.length) return;
    const unicode = buffer.readUInt32LE(16) !== 0;
    files = buffer.subarray(offset).toString(unicode ? 'utf16le' : 'latin1').split('\0').filter(Boolean);
  }
  if (typeof cb.read === 'function') {
    const items = await cb.read();
    for (const item of items) for (const type of item.types) {
      if (type === 'text/uri-list') {
        const text = await (await item.getType(type)).text();
        for (const line of text.split(/\r?\n/).filter(line => line && !line.startsWith('#'))) {
          try { const url = new URL(line); if (url.protocol === 'file:') files.push(fileURLToPath(url)); } catch { /* Non-file clipboard URLs are handled as share text below. */ }
        }
      }
      if (/image\/png|image\/jpeg/.test(type) && !image) image = Buffer.from(await (await item.getType(type)).arrayBuffer());
      if (/CF_HDROP|FileDrop|format="15"/i.test(type)) dropFiles(Buffer.from(await (await item.getType(type)).arrayBuffer()));
    }
  } else {
    for (const format of cb.availableFormats?.() ?? []) if (/CF_HDROP|FileDrop/i.test(format)) dropFiles(cb.readBuffer!(format));
    const native = cb.readImage?.(); if (native && !native.isEmpty()) image = native.toPNG();
  }
  stillCurrent();
  if (files.length) { await importPaths(files); return; }
  if (image?.length) {
    const temporary = path.join(target.state.directory, 'cache', `clipboard-${uuid()}.png`);
    await fs.mkdir(path.dirname(temporary), { recursive: true }); await fs.writeFile(temporary, image); stillCurrent(); await importPaths([temporary]); return;
  }
  const text = await cb.readText();
  stillCurrent();
  if (/https?:\/\//i.test(text)) { startLink(text); return; }
  if (text.trim()) {
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    commit(target, state => { const id = uuid(); state.content.drafts.push({ id, title: '粘贴文字', html: `<p>${escape(text).replace(/\r?\n/g, '</p><p>')}</p>`, kind: 'script', versions: [] }); addNode(state, 'draft', id); });
    return;
  }
  throw new Error('没有可导入内容。如果是复制的视频文件，请尝试直接拖入或使用“导入文件”');
}

async function mediaResponse(request: Request): Promise<Response> {
  try {
    // Only this launcher's loopback frontend can read native media into IndexedDB.
    // Native <video>/<img> requests may omit Origin and continue to work normally.
    let allowedOrigin = '';
    try {
      const configured = new URL(process.env.CANVAS_DEV_URL || '');
      if (configured.protocol === 'http:' && configured.hostname === '127.0.0.1' && configured.port && !configured.username && !configured.password) allowedOrigin = configured.origin;
    } catch { /* The packaged file:// fallback has no cross-origin read grant. */ }
    const origin = request.headers.get('Origin');
    if (origin && origin !== allowedOrigin) return new Response('Forbidden origin', { status: 403 });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const url = new URL(request.url);
    const target = canvasDesktop.projectForMedia(url.hostname) ?? current();
    if (url.hostname !== target.state.id) return new Response('Project closed', { status: 404 });
    const relative = decodeURIComponent(url.pathname.slice(1)).replace(/\\/g, '/');
    if (!/^(media|cache)\//.test(relative) || relative.split('/').some(s => s === '..' || s === '.')) return new Response('Forbidden', { status: 403 });
    const absolute = await fs.realpath(path.join(target.state.directory, relative));
    const root = await fs.realpath(target.state.directory);
    if (!absolute.toLowerCase().startsWith((root + path.sep).toLowerCase())) return new Response('Forbidden', { status: 403 });
    const stat = await fs.stat(absolute); if (!stat.isFile()) return new Response('Not found', { status: 404 });
    const mime: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
    const headers = new Headers({ 'Content-Type': mime[path.extname(absolute).toLowerCase()] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    if (allowedOrigin && origin === allowedOrigin) {
      headers.set('Access-Control-Allow-Origin', allowedOrigin);
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Range');
      headers.set('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    let start = 0; let end = stat.size - 1; let status = 200;
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (start > end || start >= stat.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      status = 206; headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    }
    headers.set('Content-Length', String(Math.max(0, end - start + 1)));
    if (request.method === 'HEAD' || stat.size === 0) return new Response(null, { status, headers });
    return new Response(Readable.toWeb(createReadStream(absolute, { start, end })) as ReadableStream<Uint8Array>, { status, headers });
  } catch { return new Response('File unavailable', { status: 404 }); }
}

function registerIpc() {
  const handle = (name: string, handler: (...args: any[]) => unknown) => ipcMain.handle(`studio:${name}`, (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效请求来源');
    return handler(...args);
  });
  handle('state', () => store?.state ?? null);
  canvasDesktop.register(handle, selectDirectory);
  handle('diagnostics', () => detectTools());
  handle('create', async (name: string, parentDirectory?: string) => projectOperation(async () => { const selected = parentDirectory ?? await selectDirectory('选择保存位置（自动创建项目子文件夹）'); if (!selected) return null; return useStore(ProjectStore.createInDirectory(selected, name.trim() || '未命名项目')); }));
  handle('open', async (directory?: string) => projectOperation(async () => { const selected = directory ?? await selectDirectory('打开包含 project.sqlite 的项目文件夹'); if (!selected) return null; canvasDesktop.rejectManagedLibrary(selected); return useStore(ProjectStore.open(selected)); }));
  handle('rename', (name: string) => { assertWritable(); const result = current().rename(name.trim() || '未命名项目'); send(); return result; });
  handle('save', (content: Content, baseRevision?: number) => { if (exporting) throw new Error('正在导出，请稍后保存'); const result = current().saveContent(content, baseRevision); send(); return result; });
  handle('import', async (paths?: string[], sourceId?: string) => {
    assertWritable(); const projectId = current().state.id; let selected = paths;
    if (!selected) { const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'], filters: [{ name: '视频与图片', extensions: ['mp4','mov','mkv','webm','avi','m4v','png','jpg','jpeg','webp','gif','bmp'] }] }); if (result.canceled) return; selected = result.filePaths; }
    if (current().state.id !== projectId) throw new Error('项目已切换，请重新导入');
    if (!Array.isArray(selected) || selected.length > 100) throw new Error('每次最多导入 100 个文件'); await importPaths(selected, sourceId);
  });
  handle('link', (text: string) => startLink(text));
  handle('clipboard', pasteClipboard);
  handle('transcribe', (id: string, cpu?: boolean) => startTranscript(id, cpu));
  handle('cancel', (id: string) => {
    const index = queue.findIndex(e => e.id === id);
    if (index >= 0) { const [entry] = queue.splice(index, 1); commit(entry.store, s => { const job = s.jobs.find(j => j.id === id)!; job.status = 'cancelled'; job.message = '已取消'; }); }
    controllers.get(id)?.abort();
  });
  handle('retry', async (id: string) => { const job = current().state.jobs.find(j => j.id === id); if (!job || !['failed','cancelled','interrupted'].includes(job.status)) throw new Error('此任务不能重试'); if (job.kind === 'transcribe') startTranscript(job.assetId!); else if (job.kind === 'link') startLink(job.input!, job.sourceId); else if (job.kind === 'import') await importPaths([job.input!], job.sourceId); else throw new Error('请重新执行截图'); });
  handle('screenshot', (id: string, time: number) => {
    assertWritable();
    const target = current(); const asset = target.state.assets.find(a => a.id === id);
    if (!asset || !Number.isFinite(time) || time < 0 || time > asset.durationMs) throw new Error('无效的视频截图位置');
    enqueue(target, 'preview', id, async (signal, onProgress) => {
      const result = await captureFrame(asset, target.state.directory, time, { signal, onProgress });
      if (!signal.aborted) {
        const image = registerAsset(target, { ...result, capture: { assetId: id, timeMs: time } }, asset.sourceId);
        commit(target, s => { s.content.imageNotes[image.id] = `来源：${asset.name} · ${(time / 1000).toFixed(2)} 秒`; });
      }
    }, { assetId: id });
  });
  handle('export-document', async (kind: 'txt' | 'md' | 'srt', id: string, destination?: string) => { if (!['txt','md','srt'].includes(kind)) throw new Error('不支持的导出格式'); const target = current(); let out = destination; if (!out) { const result = await dialog.showSaveDialog(window, { defaultPath: path.join(target.state.directory, 'exports', `文稿.${kind}`), filters: [{ name: kind.toUpperCase(), extensions: [kind] }] }); if (result.canceled) return null; out = result.filePath; } return out ? exportDocument(target.state, kind, id, out) : null; });
  handle('export-project', async (destination?: string) => projectOperation(async () => { const target = current(); let out = destination; if (!out) { const result = await dialog.showSaveDialog(window, { defaultPath: `${target.state.name}.ycanvas.zip`, filters: [{ name: '画布项目包', extensions: ['zip'] }] }); if (result.canceled) return null; out = result.filePath; } return out ? await exportProject(target, out) : null; }));
  handle('restore', async (archive?: string, destination?: string) => projectOperation(async () => { let input = archive; if (!input) { const result = await dialog.showOpenDialog(window, { filters: [{ name: '画布项目包', extensions: ['zip'] }], properties: ['openFile'] }); if (result.canceled) return null; input = result.filePaths[0]; } const dir = destination ?? await selectDirectory('选择用于恢复的空文件夹'); if (!dir) return null; return useStore(await restoreProject(input, dir)); }));
  handle('external', async (url: string) => { const value = new URL(url); if (!['http:', 'https:'].includes(value.protocol)) throw new Error('仅允许打开网页链接'); await shell.openExternal(url); });
}
async function requestFlush() {
  const requestId = uuid();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { ipcMain.removeListener('studio:flushed', listener); reject(new Error('保存响应超时')); }, 10000);
    const listener = (event: Electron.IpcMainEvent, id: string, error: string | null) => { if (event.sender !== window.webContents || id !== requestId) return; clearTimeout(timeout); ipcMain.removeListener('studio:flushed', listener); error ? reject(new Error(error)) : resolve(); };
    ipcMain.on('studio:flushed', listener); window.webContents.send('studio:flush', requestId);
  });
}

if (process.env.CANVAS_USER_DATA) app.setPath('userData', path.resolve(process.env.CANVAS_USER_DATA));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    process.env.CANVAS_WORKER_DIR = path.join(studioRoot, 'native', 'workers');
    await canvasDesktop.open({ userData: app.getPath('userData'), legacyProject: () => store, window: () => window });
    protocol.handle('field-media', request => canvasDesktop.fieldMedia(request));
    protocol.handle('media', mediaResponse);
    // field.ico keeps its file name so an existing desktop shortcut still points at it.
    window = new BrowserWindow({
      width: 1540, height: 980, minWidth: 1000, minHeight: 650,
      backgroundColor: windowGround(savedAppearance(app.getPath('userData')), nativeTheme.shouldUseDarkColors),
      title: '来处', icon: path.join(studioRoot, 'desktop-assets', 'field.ico'), show: !process.env.CANVAS_HEADLESS,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !process.env.CANVAS_HEADLESS },
    });
    window.setMenuBarVisibility(false);
    followAppearance(window, { ipcMain, nativeTheme, directory: app.getPath('userData') });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== window.webContents.getURL()) event.preventDefault(); });
    try { const last = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'last-project.json'), 'utf8')); if (!process.env.CANVAS_TEST) store = ProjectStore.open(last.directory); } catch { /* Welcome screen remains available. */ }
    registerIpc();
    window.on('close', event => {
      if (closing) return; event.preventDefault();
      void (async () => {
        try {
          if (exporting) { await dialog.showMessageBox(window, { title: '来处', type: 'info', message: '正在切换或打包项目，请完成后再退出。' }); return; }
          await requestFlush();
          if (queueRunning || queue.length || canvasDesktop.hasActiveImports()) { const result = await dialog.showMessageBox(window, { title: '来处', type: 'question', buttons: ['继续等待', '保存并退出'], defaultId: 0, cancelId: 0, message: '还有后台任务。退出会暂停后台处理；重新打开后可在视频卡片上继续。' }); if (result.response === 0) return; }
          for (const controller of controllers.values()) controller.abort();
          queue.length = 0; await canvasDesktop.close(); closing = true; window.destroy();
        } catch (error) { await dialog.showMessageBox(window, { title: '来处', type: 'error', message: '尚未保存成功，已保留窗口', detail: errorText(error) }); }
      })();
    });
    const dev = process.env.CANVAS_DEV_URL;
    if (dev && /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(dev)) await window.loadURL(dev);
    else await window.loadFile(path.join(studioRoot, 'dist', 'index.html'));
  }).catch(error => { console.error(error); dialog.showErrorBox('画布启动失败', errorText(error)); void canvasDesktop.close().finally(() => app.quit()); });
  app.on('window-all-closed', () => { void canvasDesktop.close().finally(() => app.quit()); });
}
