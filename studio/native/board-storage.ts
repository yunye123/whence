import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateBoard } from '../src/storage';
import type { Board, BoardNode } from '../src/model';

export interface DirectoryChoice { id: string; directory: string }
export interface StoredMedia { id: string; name: string; mime: string; createdAt: string; data: Uint8Array }
interface MediaEntry { id: string; name: string; mime: string; createdAt: string; file: string; size: number; sha256: string }
interface Manifest { format: 'field-folder'; version: 1; savedAt: string; board: Board; media: MediaEntry[] }
export type FolderMediaMetadata = Omit<MediaEntry, 'file' | 'sha256'>;
export interface BoardOpenedResult { kind: 'opened'; board: Board; media: FolderMediaMetadata[] }
export interface BoardRecoveryAvailable { kind: 'recovery-available'; recoveryId: string; savedAt: string; title: string; reason: string }
export type BoardOpenResult = BoardOpenedResult | BoardRecoveryAvailable;
interface Location extends DirectoryChoice { boardId: string }
interface SourceMedia { entry: MediaEntry; file: string }
const MAX_FILE = 64 * 1024 * 1024;
const types: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/ogg': '.ogv', 'video/x-m4v': '.m4v' };
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
async function fileHash(file: string) { const digest = createHash('sha256'); for await (const part of createReadStream(file)) digest.update(part); return digest.digest('hex'); }
async function atomic(file: string, content: string | Uint8Array) {
  const temp = `${file}.${randomUUID()}.next`;
  try { await fs.writeFile(temp, content, { flag: 'wx' }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
}
function text(value: unknown, name: string, limit = 4096) {
  if (typeof value !== 'string' || !value || value.length > limit || value.includes('\0')) throw new Error(`${name}无效。`);
  return value;
}

/** Renderer paths are descriptive only. Every write resolves an ID granted by a native picker. */
export class BoardStorage {
  private choices = new Map<string, string>();
  private locations = new Map<string, DirectoryChoice & { boardId: string }>();
  private saves: Promise<unknown> = Promise.resolve();
  private recoveries = new Map<string, { directory: string; manifestHash: string }>();
  constructor(private registry: string, private nativeFile?: (node: BoardNode) => Promise<{ path: string; name: string; mime: string } | undefined>) {}
  async initialize() {
    try {
      const entries = JSON.parse(await fs.readFile(this.registry, 'utf8'));
      if (!Array.isArray(entries)) throw new Error('画布目录登记损坏。');
      for (const entry of entries) this.locations.set(text(entry.id, '目录 ID', 160), { id: entry.id, directory: text(entry.directory, '目录'), boardId: text(entry.boardId, '画布 ID', 160) });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private async persist() { await atomic(this.registry, JSON.stringify([...this.locations.values()], null, 2)); }
  async choose(directory: string): Promise<DirectoryChoice> {
    const canonical = await fs.realpath(directory); if (!(await fs.stat(canonical)).isDirectory()) throw new Error('请选择一个本机文件夹。');
    const id = randomUUID(); this.choices.set(id, canonical); return { id, directory: canonical };
  }
  async create(choiceId: string, board: Board, media: StoredMedia[] = []): Promise<DirectoryChoice> {
    return this.queue(() => this.createCopy(choiceId, board, media, false)).then(result => result.location);
  }
  private queue<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.saves.then(operation); this.saves = work.catch(() => {}); return work;
  }
  private async createCopy(choiceId: string, input: Board, media: StoredMedia[], independent: boolean, recoverySources?: Map<string, SourceMedia>) {
    const parent = this.choices.get(text(choiceId, '保存位置 ID', 160)); if (!parent) throw new Error('保存位置已失效，请重新选择文件夹。');
    if (path.resolve(await fs.realpath(parent)).toLowerCase() !== path.resolve(parent).toLowerCase()) throw new Error('保存位置已被移动或替换，请重新选择文件夹。');
    const clean = validateBoard(input); let sources = recoverySources ?? await this.sourceMedia(clean, media);
    const title = clean.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').slice(0, 60) || '未命名画布';
    const directory = path.join(parent, `${title}-${randomUUID().slice(0, 8)}`);
    let mediaIds: Map<string, string> | undefined;
    if (independent) {
      clean.id = randomUUID(); this.detachTasks(clean);
      // The renderer's byte cache is shared by all boards. Reusing an older
      // snapshot's media ID could overwrite a newer source board's bytes.
      mediaIds = new Map([...new Set([...media.map(item => item.id), ...sources.keys()])].map(id => [id, randomUUID()]));
      media = media.map(item => ({ ...item, id: mediaIds!.get(item.id)! }));
      sources = new Map([...sources].map(([id, source]) => [mediaIds!.get(id)!, { file: source.file, entry: { ...source.entry, id: mediaIds!.get(id)! } }]));
      for (const node of clean.nodes) {
        if (node.data.mediaId) node.data.mediaId = mediaIds.get(node.data.mediaId)!;
        if (node.data.url?.startsWith('media:')) node.data.url = `field-media://pending/${node.data.mediaId ?? mediaIds.get(this.nativeMediaId(node))!}`;
      }
    }
    const location = { id: randomUUID(), directory, boardId: clean.id };
    clean.storage = { id: location.id, directory }; delete clean.groupId;
    this.rebindMedia(clean, location.id, mediaIds);
    await fs.mkdir(directory);
    try {
      await fs.mkdir(path.join(directory, 'media'));
      const saved = await this.write(location.id, clean, media, location, sources);
      const manifest = await this.readManifest(directory); await this.verifyManifest(directory, manifest);
      this.locations.set(location.id, location);
      try { await this.persist(); } catch (error) { this.locations.delete(location.id); throw error; }
      return { location: { id: location.id, directory }, board: saved, media: this.metadata(manifest) };
    } catch (error) {
      // Only this operation's fresh child is eligible for cleanup. Never follow a
      // replaced directory or delete another concurrent operation's destination.
      const disk = await fs.lstat(directory).catch(() => undefined);
      if (disk && !disk.isSymbolicLink() && path.dirname(directory) === parent
        && path.resolve(await fs.realpath(directory)).toLowerCase() === path.resolve(directory).toLowerCase()) await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  async exportDirectory(board: Board, media: StoredMedia[], choiceId: string): Promise<{ status: 'saved'; directory: string }> {
    const result = await this.queue(() => this.createCopy(choiceId, board, media, true));
    return { status: 'saved', directory: result.location.directory };
  }
  async recoverPrevious(recoveryId: string, choiceId: string): Promise<BoardOpenedResult> {
    return this.queue(async () => {
      const recovery = this.recoveries.get(text(recoveryId, '恢复 ID', 160)); if (!recovery) throw new Error('恢复凭证已失效，请重新打开原画布文件夹。');
      const real = await fs.realpath(recovery.directory);
      if (path.resolve(real).toLowerCase() !== path.resolve(recovery.directory).toLowerCase()) throw new Error('原画布目录已被替换，请重新打开。');
      const file = path.join(real, 'canvas.previous.field.json');
      if (await this.manifestHash(file) !== recovery.manifestHash) throw new Error('上一版画布已发生变化，请重新打开后检查恢复。');
      const manifest = await this.readManifest(real, 'canvas.previous.field.json'); await this.verifyManifest(real, manifest);
      if (await this.manifestHash(file) !== recovery.manifestHash) throw new Error('上一版画布已发生变化，请重新打开后检查恢复。');
      const sources = new Map<string, SourceMedia>();
      for (const item of manifest.media) sources.set(item.id, { entry: item, file: await this.verifiedMedia(real, item) });
      const result = await this.createCopy(choiceId, manifest.board, [], true, sources);
      this.recoveries.delete(recoveryId);
      return { kind: 'opened', board: result.board, media: result.media };
    });
  }
  private detachTasks(board: Board) {
    for (const node of board.nodes) {
      if (node.data.sourceUrl === undefined && node.data.videoImport?.url) node.data.sourceUrl = node.data.videoImport.url;
      delete node.data.nativeImportJobId; delete node.data.videoImport;
    }
  }
  private rebindMedia(board: Board, id: string, mediaIds?: ReadonlyMap<string, string>) {
    const rebind = (value: string | undefined) => {
      if (!value?.startsWith('field-media:')) return value;
      const mediaId = new URL(value).pathname.slice(1);
      return `field-media://${id}/${mediaIds?.get(mediaId) ?? mediaId}`;
    };
    for (const node of board.nodes) { if (node.data.url) node.data.url = rebind(node.data.url); if (node.data.poster) node.data.poster = rebind(node.data.poster); }
    if (board.cover) board.cover = rebind(board.cover);
  }
  private metadata(manifest: Manifest): FolderMediaMetadata[] { return manifest.media.map(({ file: _file, sha256: _sha, ...item }) => item); }
  private async location(id: string) {
    const entry = this.locations.get(text(id, '目录 ID', 160)); if (!entry) throw new Error('画布目录未授权，请通过“打开本机画布”重新选择。');
    const real = await fs.realpath(entry.directory).catch(() => { throw new Error('画布文件夹无法访问，请检查所在磁盘是否连接、文件夹是否被移动。'); });
    if (path.resolve(real).toLowerCase() !== path.resolve(entry.directory).toLowerCase()) throw new Error('画布目录已被替换，请重新选择本机画布。');
    const mediaDirectory = await fs.realpath(path.join(real, 'media'));
    if (path.dirname(mediaDirectory).toLowerCase() !== real.toLowerCase()) throw new Error('素材文件夹指向画布以外，保存已停止。');
    return entry;
  }
  save(id: string, input: Board, media: StoredMedia[]): Promise<Board> {
    return this.queue(() => this.write(id, input, media));
  }
  private async write(id: string, input: Board, media: StoredMedia[], fresh?: Location, seedSources?: Map<string, SourceMedia>) {
    const entry = fresh ?? await this.location(id); const board = validateBoard(input);
    if (board.id !== entry.boardId || board.storage?.id !== id || board.storage.directory !== entry.directory) throw new Error('存储位置与画布不一致。');
    if (!Array.isArray(media) || media.length > 500) throw new Error('素材列表无效。');
    const referenced = new Set(board.nodes.flatMap(node => node.data.mediaId ? [node.data.mediaId] : []));
    const entries: MediaEntry[] = [];
    for (const item of media) {
      text(item.id, '素材 ID', 160); text(item.name, '素材名称', 500); text(item.createdAt, '素材时间', 80);
      if (!referenced.has(item.id) || !types[item.mime] || !(item.data instanceof Uint8Array) || !item.data.length || item.data.byteLength > MAX_FILE) throw new Error('画布包含无效或超过 64 MB 的素材。');
      const sha256 = hash(item.data), file = `media/${hash(item.id).slice(0, 24)}-${sha256.slice(0, 12)}${types[item.mime]}`;
      const destination = path.join(entry.directory, file);
      const existing = await fs.lstat(destination).catch(() => null);
      if (existing?.isSymbolicLink()) throw new Error('素材文件被替换成链接，保存已停止。');
      if (!existing || existing.size !== item.data.length || await fileHash(destination) !== sha256) await atomic(destination, item.data);
      entries.push({ id: item.id, name: item.name, mime: item.mime, createdAt: item.createdAt, file, size: item.data.length, sha256 });
    }
    if (new Set(entries.map(item => item.id)).size !== entries.length) throw new Error('本机画布素材有重复身份，保存未完成。');
    for (const url of this.folderUrls(board)) if (new URL(url).hostname !== id) throw new Error('画布媒体引用了其他存储目录。');
    const sources = seedSources ?? await this.sourceMedia(board, media);
    for (const { entry: item, file: source } of sources.values()) {
      if (entries.some(value => value.id === item.id)) continue;
      const destination = path.join(entry.directory, item.file);
      const existing = await fs.lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (existing?.isSymbolicLink()) throw new Error('素材文件被替换成链接，保存已停止。');
      if (!existing || existing.size !== item.size || await fileHash(destination) !== item.sha256) {
        const temp = `${destination}.${randomUUID()}.next`;
        try {
          await fs.copyFile(source, temp);
          if ((await fs.stat(temp)).size !== item.size || await fileHash(temp) !== item.sha256) throw new Error('复制期间素材内容已更改，请重试保存。');
          await fs.rename(temp, destination);
        } finally { await fs.rm(temp, { force: true }); }
      }
      entries.push(item);
    }
    if ([...referenced].some(mediaId => !entries.some(item => item.id === mediaId))) throw new Error('本机画布缺少引用的素材，保存未完成。');
    if (entries.length > 500) throw new Error('本机画布引用的素材超过 500 项，请拆分画布后保存。');
    for (const node of board.nodes) {
      if (!node.data.mediaId && node.data.url?.startsWith('media:')) node.data.url = `field-media://${id}/${this.nativeMediaId(node)}`;
      if (node.data.poster?.startsWith('media:')) delete node.data.poster;
    }
    const folderBoard = { ...board }; delete folderBoard.groupId;
    const manifest: Manifest = { format: 'field-folder', version: 1, savedAt: new Date().toISOString(), board: folderBoard, media: entries };
    const content = JSON.stringify(manifest, null, 2); if (Buffer.byteLength(content) > 20 * 1024 * 1024) throw new Error('画布文字与封面超过 20 MB，请拆分画布后保存到文件夹。');
    const file = path.join(entry.directory, 'canvas.field.json');
    if ((await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))?.isSymbolicLink()) throw new Error('画布描述文件被替换成链接，保存已停止。');
    const previousBytes = await fs.readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (previousBytes) await atomic(path.join(entry.directory, 'canvas.previous.field.json'), previousBytes);
    await atomic(file, content);
    return board;
  }
  private nativeMediaId(node: BoardNode) { return `disk-${hash(`${node.data.nativeProjectId}:${node.data.nativeAssetId}`).slice(0, 32)}`; }
  private folderUrls(board: Board): string[] {
    return [...board.nodes.flatMap(node => [node.data.url, node.data.poster]), board.cover].filter((url): url is string => Boolean(url?.startsWith('field-media:')));
  }
  private async sourceMedia(board: Board, media: StoredMedia[]): Promise<Map<string, SourceMedia>> {
    if (!Array.isArray(media) || media.length > 500) throw new Error('素材列表无效。');
    const result = new Map<string, SourceMedia>(), supplied = new Set(media.map(item => item.id)), origins = new Map<string, string>();
    const manifests = new Map<string, Promise<{ directory: string; manifest: Manifest }>>();
    const folder = (id: string) => {
      if (!manifests.has(id)) manifests.set(id, this.location(id).then(async location => ({ directory: location.directory, manifest: await this.readManifest(location.directory) })));
      return manifests.get(id)!;
    };
    const append = async (id: string, sourceId: string) => {
      if (supplied.has(id) || origins.get(id) === sourceId) return;
      const source = await folder(sourceId), item = source.manifest.media.find(item => item.id === id);
      if (!item) throw new Error('本机画布缺少引用的素材，保存未完成。');
      const previous = result.get(id)?.entry;
      if (previous && (previous.sha256 !== item.sha256 || previous.size !== item.size || previous.mime !== item.mime)) throw new Error('不同目录的素材使用了相同身份，请先分别导入画布。');
      result.set(id, { entry: item, file: await this.verifiedMedia(source.directory, item) });
      origins.set(id, sourceId);
    };
    for (const node of board.nodes) if (node.data.mediaId && !supplied.has(node.data.mediaId)) {
      if (!board.storage) throw new Error('本机画布缺少引用的素材，保存未完成。');
      await append(node.data.mediaId, board.storage.id);
    }
    for (const rawUrl of this.folderUrls(board)) { const url = new URL(rawUrl); await append(url.pathname.slice(1), url.hostname); }
    for (const node of board.nodes) if (!node.data.mediaId && node.data.url?.startsWith('media:')) {
      const mediaId = this.nativeMediaId(node); if (result.has(mediaId)) continue;
      if (board.storage) {
        // A previous independent folder copy remains authoritative when its
        // original library has moved. Hash it once per asset, not once per card.
        const previous = await folder(board.storage.id).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
        const stored = previous?.manifest.media.find(item => item.id === mediaId);
        if (stored) {
          const file = await this.verifiedMedia(previous!.directory, stored).catch(error => {
            if ((error as Error).message.includes('缺失或损坏')) return undefined;
            throw error;
          });
          if (file) { result.set(mediaId, { entry: stored, file }); continue; }
        }
      }
      const native = await this.nativeFile?.(node); if (!native) throw new Error(`“${node.data.title}”的原视频无法访问，且本机副本缺失或损坏，画布文件尚未更新。`);
      if (!types[native.mime]) throw new Error('这种素材格式不能存进本机画布。');
      text(native.name, '素材名称', 500);
      const stat = await fs.stat(native.path); if (!stat.isFile() || stat.size < 1) throw new Error('素材文件是空的，或者不是文件。');
      const sha256 = await fileHash(native.path), file = `media/${mediaId}-${sha256.slice(0, 12)}${types[native.mime]}`;
      result.set(mediaId, { file: native.path, entry: { id: mediaId, name: native.name, mime: native.mime, createdAt: new Date().toISOString(), file, size: stat.size, sha256 } });
    }
    return result;
  }
  private async verifiedMedia(directory: string, media: MediaEntry): Promise<string> {
    const file = path.join(directory, media.file);
    try {
      const disk = await fs.lstat(file);
      if (disk.isSymbolicLink()) throw new Error('素材文件被替换成链接，读取已停止。');
      const canonical = await fs.realpath(file);
      if (path.dirname(canonical).toLowerCase() !== path.join(directory, 'media').toLowerCase()) throw new Error('素材路径不在画布目录中。');
      if (!disk.isFile() || disk.size !== media.size || await fileHash(canonical) !== media.sha256) throw new Error(`素材“${media.name}”缺失或损坏，请检查本机备份。`);
      return canonical;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`素材“${media.name}”缺失或损坏，请检查本机备份。`);
      throw error;
    }
  }
  private async verifyManifest(directory: string, manifest: Manifest) {
    const mediaDirectory = await fs.realpath(path.join(directory, 'media'));
    if (path.dirname(mediaDirectory).toLowerCase() !== directory.toLowerCase()) throw new Error('素材文件夹指向画布以外，读取已停止。');
    for (const item of manifest.media) await this.verifiedMedia(directory, item);
  }
  private async manifest(id: string): Promise<Manifest> { return this.readManifest((await this.location(id)).directory); }
  private async manifestHash(file: string) {
    const disk = await fs.lstat(file);
    if (disk.isSymbolicLink()) throw new Error('画布描述文件被替换成链接，读取已停止。');
    if (!disk.isFile() || disk.size > 20 * 1024 * 1024) throw new Error('画布描述文件过大或不是文件，无法打开。');
    return fileHash(file);
  }
  private async readManifest(directory: string, filename = 'canvas.field.json'): Promise<Manifest> {
    const file = path.join(directory, filename);
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('画布描述文件被替换成链接，读取已停止。');
    if ((await fs.stat(file)).size > 20 * 1024 * 1024) throw new Error('画布描述文件过大，无法打开。');
    let manifest: Manifest;
    try { manifest = JSON.parse(await fs.readFile(file, 'utf8')) as Manifest; }
    catch (error) { if (error instanceof SyntaxError) throw new Error('画布描述文件损坏，无法解析。'); throw error; }
    if (!manifest || typeof manifest !== 'object') throw new Error('不支持的本机画布格式。');
    if (manifest.format !== 'field-folder' || manifest.version !== 1 || !Array.isArray(manifest.media) || manifest.media.length > 500) throw new Error('不支持的本机画布格式。');
    const board = validateBoard(manifest.board);
    if (typeof manifest.savedAt !== 'string' || !Number.isFinite(Date.parse(manifest.savedAt))) throw new Error('画布保存时间无效。');
    if (new Set(manifest.media.map(item => item.id)).size !== manifest.media.length || new Set(manifest.media.map(item => item.file)).size !== manifest.media.length) throw new Error('画布素材记录有重复身份。');
    for (const item of manifest.media) { text(item.id, '素材 ID', 160); text(item.name, '素材名称', 500); text(item.createdAt, '素材时间', 80); }
    for (const item of manifest.media) if (!/^media\/[a-z0-9-]+\.(png|jpg|webp|gif|avif|mp4|webm|mov|ogv|m4v)$/.test(item.file) || !Number.isSafeInteger(item.size) || item.size < 1 || !/^[a-f0-9]{64}$/.test(item.sha256) || !types[item.mime]) throw new Error('画布素材记录无效。');
    const references = new Set(board.nodes.flatMap(node => node.data.mediaId ? [node.data.mediaId] : []));
    for (const rawUrl of this.folderUrls(board)) { const url = new URL(rawUrl); if (url.hostname !== board.storage?.id) throw new Error('本机视频引用了其他画布目录。'); references.add(url.pathname.slice(1)); }
    if (manifest.media.length !== references.size || [...references].some(id => !manifest.media.some(item => item.id === id))) throw new Error('画布缺少引用的素材或存在多余的素材记录。');
    return { ...manifest, board };
  }
  async open(directory: string, existing: { id: string; directory?: string }[] = []): Promise<BoardOpenResult> {
    if (!Array.isArray(existing) || existing.length > 200 || existing.some(item => typeof item.id !== 'string' || item.id.length > 160 || (item.directory !== undefined && (typeof item.directory !== 'string' || item.directory.length > 4096)))) throw new Error('工作区画布列表无效。');
    const real = await fs.realpath(directory);
    let manifest: Manifest;
    try { manifest = await this.readManifest(real); await this.verifyManifest(real, manifest); }
    catch (error) {
      try {
        const previousFile = path.join(real, 'canvas.previous.field.json'), manifestHash = await this.manifestHash(previousFile);
        const previous = await this.readManifest(real, 'canvas.previous.field.json'); await this.verifyManifest(real, previous);
        if (await this.manifestHash(previousFile) !== manifestHash) throw new Error('上一版画布正在变化，请重新打开。');
        const recoveryId = randomUUID(); this.recoveries.set(recoveryId, { directory: real, manifestHash });
        return { kind: 'recovery-available', recoveryId, savedAt: previous.savedAt, title: previous.board.title, reason: error instanceof Error ? error.message : '当前画布无法打开。' };
      } catch { throw error; }
    }
    const board = manifest.board; const collision = existing.find(item => item.id === board.id);
    if (collision && (!collision.directory || (path.resolve(collision.directory).toLowerCase() !== real.toLowerCase() && await fs.stat(collision.directory).catch(() => null)))) board.id = randomUUID();
    const id = randomUUID();
    return this.queue(async () => {
      const entry = { id, directory: real, boardId: board.id }; this.locations.set(id, entry);
      try {
        board.storage = { id, directory: real }; delete board.groupId;
        this.rebindMedia(board, id);
        await this.persist();
        return { kind: 'opened' as const, board, media: this.metadata(manifest) };
      } catch (error) { this.locations.delete(id); throw error; }
    });
  }
  async readMedia(id: string, mediaId: string): Promise<Uint8Array> {
    const { file, size } = await this.mediaFile(id, mediaId); if (size > MAX_FILE) throw new Error('该视频超过 64 MB，请直接从本机画布播放。'); return new Uint8Array(await fs.readFile(file));
  }
  async mediaFile(id: string, mediaId: string) {
    const entry = await this.location(id); const manifest = await this.manifest(id); const media = manifest.media.find(item => item.id === mediaId);
    if (!media) throw new Error('画布中没有该素材。');
    const file = await fs.realpath(path.join(entry.directory, media.file));
    if (path.dirname(file).toLowerCase() !== path.join(entry.directory, 'media').toLowerCase()) throw new Error('素材路径不在画布目录中。');
    return { file, size: media.size, mime: media.mime };
  }
  async directory(id: string) { return (await this.location(id)).directory; }
}
