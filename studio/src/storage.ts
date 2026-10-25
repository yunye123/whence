import { safeUrl } from './board-utils';
import { getSourceUrl } from './media-source';
import { remapDraftSourceLinks as remapSourceLinks } from './draft-references';
import { MAX_CARD_SIZE } from './card-size';
import { uid, type Board, type BoardNode, type CardData, type CardKind, type MediaRecord, type Workspace } from './model';
import { SAMPLE_ASSET_PATTERN } from './templates';
export { createBoard } from './templates';

export const STORAGE_LIMITS = { mediaBytes: 64 * 1024 * 1024, packageBytes: 96 * 1024 * 1024, nodes: 500, edges: 1500, boards: 100 } as const;
const DB_NAME = 'field-creator-workspace';
const TYPES: CardKind[] = ['video', 'image', 'note', 'quote', 'draft', 'link', 'frame'];
const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg', 'video/x-m4v', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/flac']);
const EXTENSIONS: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac' };
const NATIVE_STRINGS = ['nativeAssetId', 'nativeProjectId', 'nativeDirectory', 'nativeNodeId', 'nativeEntityId', 'nativeSourceId', 'nativeTranscriptId', 'nativeGroup', 'nativeMediaWarning', 'nativeImportJobId'] as const;
const SOURCE_STRINGS = ['sourceTitle', 'sourceAuthor', 'sourceOriginalText', 'sourceStatus', 'sourceDescription', 'excerptNote'] as const;
let databasePromise: Promise<IDBDatabase> | undefined;
const savedFolders = new Map<string, string>();

function fail(message: string): never { throw new Error(message); }
function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${context}格式不正确。`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) fail(`${context}包含不安全的字段。`);
  return record;
}
function keys(value: Record<string, unknown>, allowed: string[], context: string) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${context}包含不支持的字段，请使用来处导出的文件。`);
}
function string(value: unknown, context: string, max = 20_000, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || value.includes('\u0000')) fail(`${context}为空、过长或格式不正确。`);
  // These fields are rendered as text, never as HTML. Preserve literal tags in writing.
  return value;
}
function number(value: unknown, context: string, min = -10_000_000, max = 10_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${context}超出范围或不是有效数字。`);
  return value;
}
function array(value: unknown, context: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${context}数量超过限制或格式不正确。`);
  return value;
}
function id(value: unknown, context: string) { return string(value, context, 160, false); }
function date(value: unknown, context: string): string {
  const result = string(value, context, 40, false);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(result) || !Number.isFinite(Date.parse(result))) fail(`${context}不是有效的 ISO 日期。`);
  return result;
}
function validBase64(value: string) { return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value); }
function rasterPoster(value: string): boolean {
  const comma = value.indexOf(',');
  const prefix = value.slice(0, comma), base64 = value.slice(comma + 1);
  if (!['data:image/jpeg;base64', 'data:image/png;base64', 'data:image/webp;base64'].includes(prefix) || value.length > 3 * 1024 * 1024 || !validBase64(base64)) return false;
  if (base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0) > 2 * 1024 * 1024) return false;
  const signature = atob(base64.slice(0, 24));
  if (prefix.includes('jpeg')) return signature.startsWith('\xff\xd8\xff');
  if (prefix.includes('png')) return signature.startsWith('\x89PNG\r\n\x1a\n');
  return signature.startsWith('RIFF') && signature.slice(8, 12) === 'WEBP';
}
function resource(value: unknown, context: string, portable: boolean): string {
  const url = string(value, context, 4096, false);
  if (safeUrl(url)) return url;
  // Built-in example media ships with the app (both modes): the old scene SVGs and the example samples (EXAMPLE_CONTENT §8.1).
  if (/^\/assets\/scene-(?:morning|architecture|landscape)\.svg$/.test(url) || SAMPLE_ASSET_PATTERN.test(url)) return url;
  if (!portable && /^(?:media|field-media):\/\/[^\s<>"'\u0000-\u001f]+$/.test(url)) return url;
  if (/^field-picture:[^\s:]+:[1-9]\d*$/.test(url)) return url;
  fail(`${context}使用了不允许的 URL 协议。只支持 HTTP、HTTPS 和内置示例素材。`);
}
function unique(values: string[], context: string) { if (new Set(values).size !== values.length) fail(`${context}有重复 ID。`); }

function validateNode(value: unknown, portable: boolean): BoardNode {
  const node = object(value, '卡片');
  keys(node, ['id', 'type', 'position', 'data', 'style'], '卡片');
  if (node.type !== 'card') fail('卡片类型不受支持。');
  const position = object(node.position, '卡片位置');
  keys(position, ['x', 'y'], '卡片位置');
  const raw = object(node.data, '卡片内容');
  keys(raw, ['kind', 'title', 'body', 'translation', 'tone', 'mediaId', 'poster', 'url', 'duration', 'transcript', 'transcriptRevision', 'citation', 'tags', 'draftVersions', 'demo', 'videoImport', 'pictures', ...NATIVE_STRINGS, ...SOURCE_STRINGS, 'sourceUrl', 'collectedAt', 'nativeHasAudio', 'nativeSegmentIds', 'nativeWordIds', 'nativeRanges', 'nativeCapture'], '卡片内容');
  if (portable && Object.keys(raw).some(key => key.startsWith('native'))) fail('画布包包含设备专属路径，无法安全导入。请从原设备重新导出。');
  if (!TYPES.includes(raw.kind as CardKind)) fail('卡片内容类型不受支持。');
  const data: CardData = { kind: raw.kind as CardKind, title: string(raw.title, '卡片标题', 500), body: string(raw.body, '卡片正文', 300_000) };
  if (raw.translation !== undefined) data.translation = string(raw.translation, '译文', 300_000, false);
  if (raw.tone !== undefined) {
    if (!['paper', 'butter', 'mint', 'lavender', 'blue'].includes(raw.tone as string)) fail('卡片颜色不受支持。');
    data.tone = raw.tone as CardData['tone'];
  }
  if (raw.mediaId !== undefined) data.mediaId = id(raw.mediaId, '媒体 ID');
  if (raw.poster !== undefined && raw.poster !== '') data.poster = typeof raw.poster === 'string' && rasterPoster(raw.poster) ? raw.poster : resource(raw.poster, '预览图片', portable);
  if (raw.url !== undefined && raw.url !== '') data.url = resource(raw.url, '来源链接', portable);
  if (raw.pictures !== undefined) {
    if (raw.kind !== 'note' && raw.kind !== 'link') fail('一组图片只放在笔记或链接卡片上。');
    const pictures = array(raw.pictures, '笔记图片', 10_000).map(item => resource(item, '笔记图片', portable));
    if (new Set(pictures).size !== pictures.length) fail('笔记图片有重复。');
    if (pictures.length) data.pictures = pictures;
  }
  if (raw.duration !== undefined) data.duration = number(raw.duration, '视频时长', 0, 604_800);
  if (raw.demo !== undefined) { if (typeof raw.demo !== 'boolean') fail('示例标记格式不正确。'); data.demo = raw.demo; }
  if (raw.videoImport !== undefined) {
    if (raw.kind !== 'video') fail('视频导入任务只能属于视频卡片。');
    const task = object(raw.videoImport, '视频导入任务');
    keys(task, ['attemptId', 'url', 'originalText', 'status', 'progress', 'message', 'error', 'mediaReady', 'createdAt', 'updatedAt'], '视频导入任务');
    const url = safeUrl(string(task.url, '视频来源链接', 4096, false));
    if (!url) fail('视频来源链接仅允许 HTTP 或 HTTPS。');
    if (!['queued', 'downloading', 'transcribing', 'completed', 'failed', 'cancelled', 'interrupted'].includes(task.status as string)) fail('视频导入状态不受支持。');
    if (typeof task.mediaReady !== 'boolean') fail('视频就绪状态格式不正确。');
    data.videoImport = {
      attemptId: id(task.attemptId, '视频导入尝试 ID'), url,
      originalText: string(task.originalText, '视频分享内容', 20_000),
      status: task.status as NonNullable<CardData['videoImport']>['status'],
      message: string(task.message, '视频导入进度', 4096), mediaReady: task.mediaReady,
      createdAt: date(task.createdAt, '视频导入创建时间'), updatedAt: date(task.updatedAt, '视频导入更新时间'),
      ...(task.progress !== undefined ? { progress: number(task.progress, '视频导入进度', 0, 100) } : {}),
      ...(task.error !== undefined ? { error: string(task.error, '视频导入错误', 4096) } : {}),
    };
  }
  if (raw.tags !== undefined) data.tags = array(raw.tags, '标签', 30).map(tag => string(tag, '标签', 100));
  if (raw.transcriptRevision !== undefined) data.transcriptRevision = id(raw.transcriptRevision, '逐字稿修订版本');
  if (raw.transcript !== undefined) {
    data.transcript = array(raw.transcript, '字幕', 10_000).map(item => {
      const line = object(item, '字幕条目');
      keys(line, ['id', 'start', 'end', 'text', 'originalText', 'translation'], '字幕条目');
      const start = number(line.start, '字幕开始时间', 0, 604_800), end = number(line.end, '字幕结束时间', 0, 604_800);
      if (end <= start) fail('字幕结束时间须晚于开始时间。');
      return { id: id(line.id, '字幕 ID'), start, end, text: string(line.text, '字幕文字', 20_000),
        ...(line.originalText !== undefined ? { originalText: string(line.originalText, '字幕原始文字', 20_000) } : {}),
        ...(line.translation !== undefined ? { translation: string(line.translation, '字幕译文', 40_000, false) } : {}),
      };
    });
    unique(data.transcript.map(line => line.id), '字幕');
  }
  if (raw.citation !== undefined) {
    const citation = object(raw.citation, '引用');
    keys(citation, ['nodeId', 'title', 'start', 'end', 'text', 'transcriptRevision', 'textAnchor'], '引用');
    data.citation = { nodeId: id(citation.nodeId, '引用来源 ID'), title: string(citation.title, '引用来源标题', 500) };
    if (citation.start !== undefined) data.citation.start = number(citation.start, '引用开始时间', 0, 604_800);
    if (citation.end !== undefined) data.citation.end = number(citation.end, '引用结束时间', 0, 604_800);
    if (citation.text !== undefined) data.citation.text = string(citation.text, '引用原文', 100_000);
    if (citation.transcriptRevision !== undefined) data.citation.transcriptRevision = id(citation.transcriptRevision, '引用逐字稿修订版本');
    if (citation.textAnchor !== undefined) {
      if (data.kind !== 'quote' || !data.citation.text?.trim()) fail('文字定位只适用于有原文的摘录。');
      const anchor = object(citation.textAnchor, '文字定位');
      keys(anchor, ['from', 'to', 'prefix', 'suffix'], '文字定位');
      const from = number(anchor.from, '文字定位起点', 0, 300_000), to = number(anchor.to, '文字定位终点', 0, 300_000);
      const original = data.citation.text.replace(/\r\n?/g, '\n');
      if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from || to - from !== original.length || original.length > 20_000) fail('文字定位范围与原文不一致。');
      const prefix = string(anchor.prefix, '文字定位前文', 64), suffix = string(anchor.suffix, '文字定位后文', 64);
      const invalidContext = (text: string) => text.includes('\r') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
      if (invalidContext(prefix) || invalidContext(suffix)) fail('文字定位上下文包含无效字符。');
      data.citation.textAnchor = { from, to, prefix, suffix };
    }
    if (data.citation.start !== undefined && data.citation.end !== undefined && data.citation.end < data.citation.start) fail('引用结束时间早于开始时间。');
  }
  if (raw.draftVersions !== undefined) {
    data.draftVersions = array(raw.draftVersions, '文稿版本', 100).map(item => {
      const version = object(item, '文稿版本');
      keys(version, ['id', 'title', 'body', 'createdAt'], '文稿版本');
      return { id: id(version.id, '版本 ID'), title: string(version.title, '版本标题', 500), body: string(version.body, '版本正文', 300_000), createdAt: date(version.createdAt, '版本日期') };
    });
    unique(data.draftVersions.map(version => version.id), '文稿版本');
  }
  for (const key of SOURCE_STRINGS) if (raw[key] !== undefined) {
    const max = key === 'sourceOriginalText' || key === 'excerptNote' ? 300_000 : key === 'sourceDescription' ? 20_000 : 2000;
    data[key] = string(raw[key], '来源信息', max);
  }
  if (raw.collectedAt !== undefined) data.collectedAt = date(raw.collectedAt, '收进时间');
  if (raw.sourceUrl !== undefined) {
    const url = string(raw.sourceUrl, '原始来源链接', 4096);
    if (url && !safeUrl(url)) fail('原始来源链接仅允许 HTTP 或 HTTPS。');
    data.sourceUrl = url;
  }
  for (const key of NATIVE_STRINGS) {
    if (raw[key] !== undefined) {
      if (portable) fail('画布包包含设备专属路径，无法安全导入。请从原设备重新导出。');
      data[key] = string(raw[key], '本机素材引用', key === 'nativeDirectory' || key === 'nativeMediaWarning' ? 4096 : 200, key === 'nativeGroup');
    }
  }
  if (raw.nativeHasAudio !== undefined) { if (typeof raw.nativeHasAudio !== 'boolean') fail('原视频音轨标记无效。'); data.nativeHasAudio = raw.nativeHasAudio; }
  for (const key of ['nativeSegmentIds', 'nativeWordIds'] as const) if (raw[key] !== undefined) data[key] = array(raw[key], '原始字幕引用', 10_000).map(item => id(item, '原始字幕 ID'));
  if (raw.nativeRanges !== undefined) data.nativeRanges = array(raw.nativeRanges, '原始字幕范围', 10_000).map(item => {
    const range = object(item, '原始字幕范围'); keys(range, ['startMs', 'endMs'], '原始字幕范围');
    const startMs = number(range.startMs, '原始范围开始时间', 0, 604_800_000), endMs = number(range.endMs, '原始范围结束时间', 0, 604_800_000);
    if (endMs <= startMs) fail('原始范围结束时间须晚于开始时间。');
    return { startMs, endMs };
  });
  if (raw.nativeCapture !== undefined) {
    const capture = object(raw.nativeCapture, '原始截图'); keys(capture, ['assetId', 'timeMs'], '原始截图');
    data.nativeCapture = { assetId: id(capture.assetId, '原始截图素材 ID'), timeMs: number(capture.timeMs, '原始截图时间', 0, 604_800_000) };
  }
  const result: BoardNode = { id: id(node.id, '卡片 ID'), type: 'card', position: { x: number(position.x, '横坐标'), y: number(position.y, '纵坐标') }, data };
  if (node.style !== undefined) {
    const style = object(node.style, '卡片尺寸'); keys(style, ['width', 'height'], '卡片尺寸'); result.style = {};
    if (style.width !== undefined) result.style.width = number(style.width, '卡片宽度', 40, MAX_CARD_SIZE);
    if (style.height !== undefined) result.style.height = number(style.height, '卡片高度', 40, MAX_CARD_SIZE);
  }
  return result;
}

export function validateBoard(value: unknown, portable = false): Board {
  const raw = object(value, '画布');
  keys(raw, ['id', 'title', 'description', 'category', 'createdAt', 'updatedAt', 'nodes', 'edges', 'viewport', 'cover', 'groupId', 'storage'], '画布');
  if (!['video', 'writing', 'design'].includes(raw.category as string)) fail('画布类别不受支持。');
  const nodes = array(raw.nodes, '卡片', STORAGE_LIMITS.nodes).map(node => validateNode(node, portable));
  unique(nodes.map(node => node.id), '卡片');
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = array(raw.edges, '连线', STORAGE_LIMITS.edges).map(item => {
    const edge = object(item, '连线'); keys(edge, ['id', 'source', 'target', 'label', 'type'], '连线');
    const source = id(edge.source, '连线起点'), target = id(edge.target, '连线终点');
    if (!nodeIds.has(source) || !nodeIds.has(target)) fail('连线指向了不存在的卡片。');
    return { id: id(edge.id, '连线 ID'), source, target,
      ...(edge.label !== undefined ? { label: string(edge.label, '连线标签', 500) } : {}),
      ...(edge.type !== undefined ? { type: string(edge.type, '连线样式', 100) } : {}),
    };
  });
  unique(edges.map(edge => edge.id), '连线');
  const viewport = object(raw.viewport, '画布视图'); keys(viewport, ['x', 'y', 'zoom'], '画布视图');
  let storage: Board['storage'];
  if (raw.storage !== undefined) {
    if (portable) fail('便携画布包含设备专属存储位置，请重新导出。');
    const location = object(raw.storage, '画布存储位置'); keys(location, ['id', 'directory'], '画布存储位置');
    storage = { id: id(location.id, '存储 ID'), directory: string(location.directory, '存储目录', 4096, false) };
  }
  return {
    id: id(raw.id, '画布 ID'), title: string(raw.title, '画布标题', 500), description: string(raw.description, '画布简介', 20_000),
    category: raw.category as Board['category'], createdAt: date(raw.createdAt, '创建时间'), updatedAt: date(raw.updatedAt, '更新时间'), nodes, edges,
    viewport: { x: number(viewport.x, '视图横坐标'), y: number(viewport.y, '视图纵坐标'), zoom: number(viewport.zoom, '缩放比例', .02, 10) },
    ...(raw.cover !== undefined && raw.cover !== '' ? { cover: resource(raw.cover, '画布封面', portable) } : {}),
    ...(raw.groupId !== undefined ? { groupId: id(raw.groupId, '画布分组 ID') } : {}),
    ...(storage ? { storage } : {}),
  };
}

export function validateWorkspace(value: unknown): Workspace {
  const raw = object(value, '工作区'); keys(raw, ['schema', 'activeBoardId', 'boards', 'groups', 'trash'], '工作区');
  if (raw.schema !== 1) fail('工作区版本不受支持，请保留现有数据并更新应用。');
  const boards = array(raw.boards, '画布', STORAGE_LIMITS.boards).map(board => validateBoard(board));
  unique(boards.map(board => board.id), '画布');
  const activeBoardId = id(raw.activeBoardId, '当前画布 ID');
  if (!boards.some(board => board.id === activeBoardId)) fail('当前画布不存在。');
  const groups = raw.groups === undefined ? undefined : array(raw.groups, '画布分组', 50).map(item => {
    const group = object(item, '画布分组'); keys(group, ['id', 'title', 'collapsed'], '画布分组');
    if (group.collapsed !== undefined && typeof group.collapsed !== 'boolean') fail('分组折叠状态无效。');
    return { id: id(group.id, '分组 ID'), title: string(group.title, '分组名称', 100, false), ...(group.collapsed !== undefined ? { collapsed: group.collapsed as boolean } : {}) };
  });
  unique(groups?.map(group => group.id) ?? [], '画布分组');
  if (boards.some(board => board.groupId && !groups?.some(group => group.id === board.groupId))) fail('画布所属分组不存在。');
  const trash = raw.trash === undefined ? undefined : array(raw.trash, '回收站', 100).map(item => {
    const entry = object(item, '已删除画布'); keys(entry, ['board', 'deletedAt'], '已删除画布');
    return { board: validateBoard(entry.board), deletedAt: date(entry.deletedAt, '删除时间') };
  });
  unique([...boards.map(board => board.id), ...(trash?.map(entry => entry.board.id) ?? [])], '画布与回收站');
  return { schema: 1, activeBoardId, boards, ...(groups ? { groups } : {}), ...(trash ? { trash } : {}) };
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('此环境不支持 IndexedDB，无法把工作区保存在本机。'));
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('workspace')) db.createObjectStore('workspace');
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
    };
    request.onerror = () => reject(new Error(`无法打开本机数据库：${request.error?.message ?? '浏览器存储不可用'}`));
    request.onblocked = () => reject(new Error('本机数据库被其他窗口占用，请关闭旧版本的画布窗口后重试。'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      resolve(db);
    };
  }).catch(error => { databasePromise = undefined; throw error; });
  return databasePromise;
}
function done(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error(`本机保存失败：${transaction.error?.message ?? '数据库写入出错'}`));
    transaction.onabort = () => reject(new Error(`本机保存已中止：${transaction.error?.message ?? '存储空间不足或数据无法写入'}`));
  });
}
function read<T>(request: IDBRequest<T>) { return new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('无法读取本机数据。')); }); }

export async function loadWorkspace(): Promise<Workspace | null> {
  const db = await openDatabase();
  const stored = await read(db.transaction('workspace', 'readonly').objectStore('workspace').get('main'));
  return stored === undefined ? null : validateWorkspace(stored);
}
/** Apply only durable media references, preserving edits made while the disk write was pending. */
export function mergeFolderMedia(workspace: Workspace, source: Board, saved: Board): Workspace {
  let changed = false;
  const boards = workspace.boards.map(board => {
    if (board.id !== source.id || board.storage?.id !== source.storage?.id) return board;
    const nodes = board.nodes.map(node => {
      const before = source.nodes.find(item => item.id === node.id), after = saved.nodes.find(item => item.id === node.id);
      if (!before || !after || node.data.url !== before.data.url || node.data.mediaId !== before.data.mediaId || node.data.nativeAssetId !== before.data.nativeAssetId || node.data.nativeProjectId !== before.data.nativeProjectId) return node;
      const urlChanged = after.data.url !== before.data.url;
      const removePoster = before.data.poster?.startsWith('media:') && !after.data.poster && node.data.poster === before.data.poster;
      if (!urlChanged && !removePoster) return node;
      changed = true;
      const data = { ...node.data, ...(urlChanged ? { url: after.data.url } : {}) };
      if (urlChanged && node.data.sourceUrl === undefined) {
        const sourceUrl = getSourceUrl(node.data);
        if (sourceUrl) data.sourceUrl = sourceUrl;
      }
      if (removePoster) delete data.poster;
      return { ...node, data };
    });
    return nodes.some((node, index) => node !== board.nodes[index]) ? { ...board, nodes } : board;
  });
  return changed ? { ...workspace, boards } : workspace;
}
export async function saveWorkspace(workspace: Workspace, options: { folders?: boolean; onNormalized?: (before: Board, saved: Board) => void } = {}): Promise<void> {
  let validated = validateWorkspace(workspace);
  const db = await openDatabase();
  const transaction = db.transaction('workspace', 'readwrite'), completed = done(transaction);
  transaction.objectStore('workspace').put(validated, 'main');
  await completed;
  if (options.folders === false) return;
  const failures: string[] = [];
  const normalized: { before: Board; saved: Board }[] = [];
  for (const board of validated.boards) if (board.storage) {
    const fingerprint = JSON.stringify(board);
    if (savedFolders.get(board.storage.id) === fingerprint) continue;
    try {
      if (typeof window === 'undefined' || !window.fieldBoardStorage) throw new Error('请使用来处桌面版完成目录保存。');
      const media = [];
      for (const mediaId of new Set(board.nodes.flatMap(node => node.data.mediaId ? [node.data.mediaId] : []))) {
        const record = await getMedia(mediaId); if (!record) fail('画布素材缺失，自定义目录尚未更新。');
        media.push({ id: record.id, name: record.name, mime: record.mime, createdAt: record.createdAt, data: new Uint8Array(await record.blob.arrayBuffer()) });
      }
      const saved = validateBoard(await window.fieldBoardStorage.save(board.storage.id, board, media));
      const next = mergeFolderMedia(validated, board, saved);
      if (next !== validated) { validated = next; normalized.push({ before: board, saved }); }
      savedFolders.set(board.storage.id, JSON.stringify(validated.boards.find(item => item.id === board.id)));
    } catch (error) {
      failures.push(`“${board.title || '未命名画布'}”：${error instanceof Error ? error.message : '目录写入失败。'}`);
    }
  }
  if (normalized.length) {
    const update = db.transaction('workspace', 'readwrite'), committed = done(update);
    update.objectStore('workspace').put(validated, 'main');
    await committed;
    for (const value of normalized) options.onNormalized?.(value.before, value.saved);
  }
  if (failures.length) throw new Error(`以下画布的本机文件夹尚未更新：${failures.join('；')}`);
}

export async function openLocalBoard(workspace?: Workspace, options: { onRecovery?: (info: Extract<import('../native/board-storage').BoardOpenResult, { kind: 'recovery-available' }>) => Promise<boolean> } = {}): Promise<Board | null> {
  if (!window.fieldBoardStorage) throw new Error('打开本机画布文件夹需要来处桌面版。');
  const known = [...(workspace?.boards.map(board => ({ id: board.id, directory: board.storage?.directory })) ?? []), ...(workspace?.trash?.map(entry => ({ id: entry.board.id })) ?? [])];
  let result = await window.fieldBoardStorage.open(known); if (!result) return null;
  if (result.kind === 'recovery-available') {
    if (!options.onRecovery) throw new Error('主画布文件无法打开，已找到上一版。请通过“打开本机画布”选择恢复副本。');
    if (!await options.onRecovery(result)) return null;
    result = await window.fieldBoardStorage.recoverPrevious(result.recoveryId);
    if (!result) return null;
  }
  const board = validateBoard(result.board); const referenced = new Set(board.nodes.flatMap(node => node.data.mediaId ? [node.data.mediaId] : []));
  const records: MediaRecord[] = [];
  for (const item of result.media) if (referenced.has(item.id)) {
    const bytes = await window.fieldBoardStorage.readMedia(board.storage!.id, item.id);
    records.push({ id: item.id, name: item.name, mime: item.mime, createdAt: item.createdAt, blob: new Blob([new Uint8Array(bytes)], { type: item.mime }) });
  }
  if (records.length !== referenced.size) fail('本机画布缺少引用的素材，请检查备份。');
  const db = await openDatabase(); const transaction = db.transaction('media', 'readwrite'); const completed = done(transaction);
  for (const record of records) transaction.objectStore('media').put(record);
  await completed; return board;
}

/** A separate verified directory copy never changes the active board or its storage identity. */
export async function exportLocalBoardDirectory(value: Board): Promise<{ status: 'saved'; directory: string } | { status: 'cancelled' }> {
  if (!window.fieldBoardStorage) throw new Error('完整目录副本需要来处桌面版。');
  const board = validateBoard(value);
  const media = [];
  for (const mediaId of new Set(board.nodes.flatMap(node => node.data.mediaId ? [node.data.mediaId] : []))) {
    const record = await getMedia(mediaId);
    if (!record || !(record.blob instanceof Blob) || !record.blob.size) throw new Error('引用的本机素材缺失，完整副本尚未建立。请从原备份恢复后重试。');
    media.push({ id: record.id, name: record.name, mime: record.mime, createdAt: record.createdAt, data: new Uint8Array(await record.blob.arrayBuffer()) });
  }
  return window.fieldBoardStorage.exportDirectory(board, media);
}

async function storeMedia(file: File | Blob, name?: string, stableId?: string): Promise<MediaRecord> {
  if (!(file instanceof Blob) || file.size === 0) fail('媒体文件为空或无效。');
  if (file.size > STORAGE_LIMITS.mediaBytes) fail('单个媒体文件最大为 64 MiB，请压缩或裁剪后再导入。');
  const fileName = string(name || ('name' in file ? String(file.name) : '导入媒体'), '媒体文件名', 500, false);
  const mime = file.type.toLowerCase().split(';')[0].trim() || EXTENSIONS[fileName.split('.').pop()?.toLowerCase() ?? ''];
  if (!MIMES.has(mime)) fail('暂不支持此媒体格式。请使用常见图片、MP4、WebM 或音频文件；SVG 和 HTML 文件不能作为媒体导入。');
  const record: MediaRecord = { id: stableId ?? uid(), name: fileName, mime, blob: file.type === mime ? file : file.slice(0, file.size, mime), createdAt: new Date().toISOString() };
  const db = await openDatabase(), transaction = db.transaction('media', 'readwrite'), completed = done(transaction);
  transaction.objectStore('media').put(record);
  await completed;
  return record;
}
export function saveMedia(file: File | Blob, name?: string): Promise<MediaRecord> { return storeMedia(file, name); }
/** The media type a file would be stored as (its type, else its extension), or undefined when storeMedia refuses it. */
export function storableMediaType(file: File): string | undefined {
  const mime = file.type.toLowerCase().split(';')[0].trim() || EXTENSIONS[file.name.split('.').pop()?.toLowerCase() ?? ''];
  return mime && MIMES.has(mime) ? mime : undefined;
}

/** Remove only an uncommitted import's newly created media record. */
export async function removeMedia(mediaId: string): Promise<void> {
  const key = id(mediaId, '媒体 ID'), db = await openDatabase();
  const transaction = db.transaction('media', 'readwrite'), completed = done(transaction);
  transaction.objectStore('media').delete(key);
  await completed;
}

function nativeMediaKey(projectId: string, assetId: string): string {
  // Asset IDs are immutable within a native project. A stable key avoids copying
  // the same large file again whenever the renderer or desktop restarts.
  return id(`native:${id(projectId, '素材库 ID')}:${id(assetId, '原生媒体 ID')}`, '原生媒体缓存 ID');
}
export async function getNativeMedia(projectId: string, assetId: string): Promise<MediaRecord | undefined> {
  const record = await getMedia(nativeMediaKey(projectId, assetId));
  return record?.blob instanceof Blob && record.blob.size > 0 ? record : undefined;
}
export async function saveNativeMedia(file: Blob, name: string, projectId: string, assetId: string): Promise<MediaRecord> {
  const key = nativeMediaKey(projectId, assetId);
  const cached = await getNativeMedia(projectId, assetId);
  return cached ?? storeMedia(file, name, key);
}
export async function getMedia(mediaId: string): Promise<MediaRecord | undefined> {
  const db = await openDatabase();
  return read(db.transaction('media', 'readonly').objectStore('media').get(id(mediaId, '媒体 ID')));
}

interface PackedMedia { id: string; name: string; mime: string; createdAt: string; data: string }
function encode(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 24_576) chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576))));
  return chunks.join('');
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value), output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) output[index] = binary.charCodeAt(index);
  return output;
}
export function pictureMediaId(value: string): string | undefined {
  return /^field-picture:([^\s:]+):[1-9]\d*$/.exec(value)?.[1];
}
export function cardMediaIds(data: CardData): string[] {
  return [...new Set(referencedMediaIds(data))];
}
function referencedMediaIds(data: CardData): string[] {
  const ids: string[] = [];
  if (data.mediaId) ids.push(data.mediaId);
  for (const picture of data.pictures || []) { const id = pictureMediaId(picture); if (id) ids.push(id); }
  for (const match of data.body.matchAll(/field-picture:([^\s:)]+):([1-9]\d*)/g)) ids.push(match[1]);
  return ids;
}
function rewritePictureRefs(value: string, mediaIds: Map<string, string>): string {
  return value.replace(/field-picture:([^\s:)]+):([1-9]\d*)/g, (all, id: string, ordinal: string) => mediaIds.has(id) ? `field-picture:${mediaIds.get(id)}:${ordinal}` : all);
}
export async function exportBoard(board: Board): Promise<Blob> {
  const clean = validateBoard(board);
  delete clean.storage;
  delete clean.groupId;
  const references = new Set(clean.nodes.flatMap(node => referencedMediaIds(node.data)));
  const media: PackedMedia[] = [];
  for (const node of clean.nodes) {
    const data = node.data;
    if (data.pictures?.some(item => /^(media|field-media):/.test(item)) || ((/^(media|field-media):/.test(data.url??'') || data.poster?.startsWith('media:')) && !data.mediaId)) fail(`“${data.title}”引用的是本机上的原文件，便携画布文件无法携带。请使用“另存完整画布目录”建立含素材的独立副本。`);
    if (/^(media|field-media):/.test(data.url??'')) delete data.url;
    if (data.poster?.startsWith('media:')) delete data.poster;
    for (const key of Object.keys(data)) if (key.startsWith('native')) delete data[key];
    // A portable copy cannot own a running desktop task. Preserve its source and
    // completed media, but make continuation an explicit action on the new device.
    if (data.videoImport && ['queued', 'downloading', 'transcribing'].includes(data.videoImport.status)) {
      data.videoImport = { ...data.videoImport, status: 'interrupted', message: '此画布副本的导入尚未完成，可点击重试继续。', updatedAt: new Date().toISOString() };
    }
  }
  if (clean.cover?.startsWith('media:')) delete clean.cover;
  let totalBytes = 0;
  for (const mediaId of references) {
    const record = await getMedia(mediaId);
    if (!record || !(record.blob instanceof Blob)) fail('画布引用的素材已丢失，无法导出便携画布文件。请重新导入这个素材。');
    if (!MIMES.has(record.mime) || record.blob.size > STORAGE_LIMITS.mediaBytes) fail('画布内存在不支持或过大的媒体，无法打包。');
    totalBytes += record.blob.size;
    if (totalBytes > 68 * 1024 * 1024) fail('素材总量超过便携画布文件的上限，请使用“另存完整画布目录”。');
    media.push({ id: record.id, name: record.name, mime: record.mime, createdAt: record.createdAt, data: encode(new Uint8Array(await record.blob.arrayBuffer())) });
  }
  const output = new Blob([JSON.stringify({ format: 'field-board', version: 2, exportedAt: new Date().toISOString(), board: clean, media })], { type: 'application/json' });
  if (output.size > STORAGE_LIMITS.packageBytes) fail('便携画布文件超过 96 MiB，请减少素材或拆分画布后导出。');
  return output;
}

export async function importBoard(file: File): Promise<Board> {
  if (!(file instanceof Blob) || file.size === 0 || file.size > STORAGE_LIMITS.packageBytes) fail('画布包为空或超过 96 MiB。');
  let parsed: unknown;
  try { parsed = JSON.parse(await file.text()); } catch { fail('文件不是有效的 JSON 画布包。'); }
  const packed = object(parsed, '画布包');
  keys(packed, ['format', 'version', 'exportedAt', 'board', 'media'], '画布包');
  if (packed.format !== 'field-board' || ![1, 2].includes(packed.version as number)) fail('不支持的画布包格式或版本，请选择来处导出的 JSON 文件。');
  date(packed.exportedAt, '导出时间');
  const board = validateBoard(packed.board, true);
  const references = new Set(board.nodes.flatMap(node => referencedMediaIds(node.data)));
  let totalBytes = 0;
  const media = array(packed.media, '媒体文件', STORAGE_LIMITS.nodes).map(item => {
    const entry = object(item, '媒体文件'); keys(entry, ['id', 'name', 'mime', 'createdAt', 'data'], '媒体文件');
    const mediaId = id(entry.id, '媒体 ID');
    if (!references.has(mediaId)) fail('画布包包含未被引用的媒体文件。');
    const name = string(entry.name, '媒体文件名', 500, false), mime = string(entry.mime, '媒体格式', 100, false), createdAt = date(entry.createdAt, '媒体日期');
    if (!MIMES.has(mime)) fail('画布包包含不允许的媒体格式。');
    if (typeof entry.data !== 'string' || entry.data.length > Math.ceil(STORAGE_LIMITS.mediaBytes / 3) * 4 || !validBase64(entry.data)) fail('媒体编码无效或单个媒体超过 64 MiB。');
    const decodedBytes = entry.data.length / 4 * 3 - (entry.data.endsWith('==') ? 2 : entry.data.endsWith('=') ? 1 : 0);
    totalBytes += decodedBytes;
    if (decodedBytes > STORAGE_LIMITS.mediaBytes || totalBytes > 68 * 1024 * 1024) fail('画布包中的媒体总量超过限制。');
    return { id: mediaId, name, mime, createdAt, blob: new Blob([decode(entry.data)], { type: mime }) } satisfies MediaRecord;
  });
  unique(media.map(entry => entry.id), '媒体文件');
  if (media.length !== references.size) fail('画布包缺少引用的媒体文件，无法完整恢复。');
  const nodeIds = new Map(board.nodes.map(node => [node.id, uid()])), mediaIds = new Map(media.map(entry => [entry.id, uid()]));
  board.id = uid();
  board.updatedAt = new Date().toISOString();
  for (const node of board.nodes) {
    node.id = nodeIds.get(node.id)!;
    node.data.body = remapSourceLinks(node.data.body, nodeIds);
    // A removed source may survive as a citation snapshot; retain its original ID.
    if (node.data.citation) node.data.citation.nodeId = nodeIds.get(node.data.citation.nodeId) ?? node.data.citation.nodeId;
    if (node.data.mediaId) node.data.mediaId = mediaIds.get(node.data.mediaId)!;
    node.data.body = rewritePictureRefs(node.data.body, mediaIds);
    if (node.data.pictures) node.data.pictures = node.data.pictures.map(item => rewritePictureRefs(item, mediaIds));
    node.data.transcript?.forEach(line => { line.id = uid(); });
    node.data.draftVersions?.forEach(version => { version.id = uid(); version.body = remapSourceLinks(version.body, nodeIds); });
    if (node.data.videoImport) {
      node.data.videoImport.attemptId = uid();
      if (['queued', 'downloading', 'transcribing'].includes(node.data.videoImport.status)) {
        node.data.videoImport.status = 'interrupted';
        node.data.videoImport.message = '此画布副本的导入尚未完成，可点击重试继续。';
      }
    }
  }
  board.edges = board.edges.map(edge => ({ ...edge, id: uid(), source: nodeIds.get(edge.source)!, target: nodeIds.get(edge.target)! }));
  if (media.length) {
    const db = await openDatabase(), transaction = db.transaction('media', 'readwrite'), completed = done(transaction);
    for (const entry of media) transaction.objectStore('media').put({ ...entry, id: mediaIds.get(entry.id)! });
    await completed;
  }
  return board;
}
