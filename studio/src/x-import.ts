import { normalizeXLink, type XImportResult } from '../shared/x-import';
import { createNode, safeUrl } from './board-utils';
import { placeCards, type CardMeasurements } from './card-placement';
import { uid, type Board, type BoardEdge, type BoardNode, type MediaRecord } from './model';
import { removeMedia as deleteMedia, saveMedia as storeMedia, STORAGE_LIMITS, validateBoard } from './storage';
import { getStoredXPostText } from './x-post-source';

export interface XImportDuplicate {
  postId: string;
  sourceNodeId?: string;
  nodeIds: string[];
  imageNumbers: number[];
  videoNumbers: number[];
}
export interface PrepareXImportOptions {
  position: { x: number; y: number };
  measurements?: CardMeasurements;
  originalText?: string;
  /** Repair text/provenance only; do not create new media cards or video tasks. */
  sourceOnly?: boolean;
  signal?: AbortSignal;
  saveMedia?: (blob: Blob, name?: string) => Promise<MediaRecord>;
  removeMedia?: (id: string) => Promise<void>;
}
export interface PreparedXImport {
  board: Board;
  /** Newly added cards, in source/media order; existing writing is preserved. */
  nodes: BoardNode[];
  videoNodeIds: string[];
  /** Only this call's newly saved media IDs; callers may clean them up if commit fails. */
  mediaIds: string[];
  warnings: string[];
  sourceNodeId: string;
  duplicate: boolean;
}

function statusIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try { return normalizeXLink(value).id; } catch { return undefined; }
}
function nodePostIdentity(node: BoardNode): string | undefined {
  return statusIdentity(node.data.sourceUrl ?? node.data.videoImport?.url ?? node.data.url);
}
function hasCapturedSource(node: BoardNode): boolean {
  if (node.data.kind !== 'link' || !hasTextCaptureStatus(node)) return false;
  if (typeof node.data.sourceOriginalText === 'string' && node.data.sourceOriginalText.trim()) return true;
  // Native cached sources may keep text only in body. Empty snapshots count
  // only when the same public-content evidence used by the reader confirms them.
  return getStoredXPostText(node) !== undefined;
}
function hasTextCaptureStatus(node: BoardNode): boolean {
  return /正文完整|完整正文|已保存完整原帖正文|原帖没有文字正文|部分|预览/.test(String(node.data.sourceStatus ?? ''));
}
function isCompleteCapture(node: BoardNode): boolean {
  return /正文完整|完整正文|已保存完整原帖正文|原帖没有文字正文/.test(String(node.data.sourceStatus ?? ''));
}
function missingOriginalText(node: BoardNode, postId: string): boolean {
  const original = node.data.sourceOriginalText;
  if (typeof original !== 'string') return true;
  if (!original.trim()) return getStoredXPostText(node) === undefined;
  if (hasTextCaptureStatus(node)) return false;
  // Earlier generic imports retained the user's share input as sourceOriginalText.
  // The task still keeps that input; it must not masquerade as fetched post text.
  if (node.data.videoImport && original === node.data.videoImport.originalText) return true;
  try { const value = new URL(original.trim()); return statusIdentity(value.href) === postId; } catch { return false; }
}
function mediaNumber(node: BoardNode, type: 'photo' | 'video'): number | undefined {
  const match = node.data.sourceUrl?.match(new RegExp(`/${type}/([1-9]\\d*)/?(?:[?#].*)?$`));
  if (match) return Number(match[1]);
  // Article cover/inline media are published through a status, but do not have
  // real status/photo/n or status/video/n source pages. Keep their ordinal in
  // existing source metadata, gated by the exact canonical post identity.
  if (!node.data.sourceUrl) return undefined;
  try { if (normalizeXLink(node.data.sourceUrl).url !== node.data.sourceUrl) return undefined; } catch { return undefined; }
  const article = String(node.data.sourceStatus ?? '').match(type === 'photo' ? /^文章图片 ([1-9]\d*)；/ : /^文章视频 ([1-9]\d*)；/);
  return article ? Number(article[1]) : undefined;
}
function existingVideoNumber(node: BoardNode): number | undefined {
  const explicit = mediaNumber(node, 'video');
  if (explicit !== undefined) return explicit;
  if (String(node.data.sourceStatus ?? '').startsWith('文章')) return undefined;
  // Older generic video imports stored the bare status URL for the first clip.
  // Treat that existing card as video 1; its file and task ownership stay untouched.
  try { return /\/status\/\d+\/?$/.test(new URL(node.data.sourceUrl ?? node.data.videoImport?.url ?? node.data.url ?? '').pathname) ? 1 : undefined; } catch { return undefined; }
}
function existingImageNumber(node: BoardNode): number | undefined {
  const explicit = mediaNumber(node, 'photo');
  if (explicit !== undefined) return explicit;
  if (String(node.data.sourceStatus ?? '').startsWith('文章')) return undefined;
  try { return /\/status\/\d+\/?$/.test(new URL(node.data.sourceUrl ?? node.data.url ?? '').pathname) ? 1 : undefined; } catch { return undefined; }
}

/** Tracking URLs, twitter.com URLs and /photo or /video links share one post identity. */
export function getXImportDuplicate(board: Board, input: string): XImportDuplicate {
  const postId = normalizeXLink(input).id;
  const matches = board.nodes.filter(node => nodePostIdentity(node) === postId);
  // A pasted URL or a user's notes are not evidence that post text was captured.
  const sources = matches.filter(node => hasCapturedSource(node) && !mediaNumber(node, 'photo') && !mediaNumber(node, 'video'));
  const source = [...sources].reverse().find(isCompleteCapture) ?? sources[0];
  return {
    postId, ...(source ? { sourceNodeId: source.id } : {}), nodeIds: matches.map(node => node.id),
    imageNumbers: [...new Set(matches.filter(node => node.data.kind === 'image' && (node.data.mediaId || /^(media|field-media):/.test(node.data.url ?? ''))).map(existingImageNumber).filter((value): value is number => value !== undefined))],
    videoNumbers: [...new Set(matches.filter(node => node.data.kind === 'video').map(existingVideoNumber).filter((value): value is number => value !== undefined))],
  };
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('X 导入已取消，尚未添加卡片。', 'AbortError');
}
function reason(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function uniqueWarnings(values: string[]): string[] { return [...new Set(values.filter(value => value.trim()))]; }
function authorText(result: XImportResult): string {
  const { name, handle } = result.post.author;
  return name ? `${name}${handle ? ` (@${handle.replace(/^@/, '')})` : ''}` : handle ? `@${handle.replace(/^@/, '')}` : '作者信息未提供';
}
function sourceStatus(result: XImportResult, imageCount: number, totalImages: number, now: string): string {
  const { post } = result;
  const provider = post.provider === 'fxtwitter' ? 'FxTwitter' : 'X Syndication';
  return [
    `由第三方 ${provider} 取得`, post.completeness === 'complete' ? '正文完整' : '仅取得正文预览，原帖可能还有内容',
    totalImages ? `图片已保存 ${imageCount}/${totalImages}${imageCount < totalImages ? '，缺失图片可重新导入补齐' : ''}` : '原帖无图片',
    post.publishedAt ? `原帖发布时间：${post.publishedAt}` : '原帖发布时间未提供', `获取时间：${now}`,
    ...(post.warnings.length ? [`来源提示：${post.warnings.join('；').slice(0, 1000)}`] : []),
  ].join('；');
}
function mediaTags(kind: string): string[] { return ['X', kind]; }
function updatedCaptureStatus(node: BoardNode, status: string): string {
  const articleIdentity = String(node.data.sourceStatus ?? '').match(/^(文章(?:图片|视频) [1-9]\d*；(?:原图|视频源)：[^；]*)/);
  return articleIdentity ? `${articleIdentity[1]}；${status}` : status;
}
function mediaTitle(title: string, suffix: string): string {
  const limit = 500 - suffix.length;
  let end = Math.min(title.length, limit);
  if (end > 0 && /[\uD800-\uDBFF]/.test(title[end - 1])) end--;
  return title.slice(0, end) + suffix;
}

/**
 * Prepare one durable batch. No queue starts here: the owner must persist the
 * whole returned board before starting the returned video tasks.
 */
export async function prepareXImport(result: XImportResult, board: Board, options: PrepareXImportOptions): Promise<PreparedXImport> {
  checkAbort(options.signal);
  validateBoard(board);
  if (!options.position || !Number.isFinite(options.position.x) || !Number.isFinite(options.position.y)) throw new Error('X 导入位置无效。');
  const link = normalizeXLink(result.post.url);
  if (link.id !== result.post.id) throw new Error('X 返回的推文 ID 与来源链接不一致，尚未导入。');
  const duplicate = getXImportDuplicate(board, link.url);
  const matches = board.nodes.filter(node => nodePostIdentity(node) === link.id);
  const identicalSource = matches.find(node => node.data.kind === 'link' && node.data.sourceOriginalText === result.post.text && (result.post.text.trim() || hasCapturedSource(node)));
  const existingSource = identicalSource ?? (duplicate.sourceNodeId ? board.nodes.find(node => node.id === duplicate.sourceNodeId)! : undefined);
  const priorPreview = !identicalSource && existingSource && result.post.completeness === 'complete'
    && String(existingSource.data.sourceStatus ?? '').includes('仅取得正文预览')
    && (existingSource.data.sourceOriginalText ?? existingSource.data.body) !== result.post.text ? existingSource : undefined;
  const newSource = !existingSource || !!priorPreview;
  const source = newSource ? createNode('link', options.position) : existingSource!;
  const now = new Date().toISOString(), warnings = [...result.post.warnings];
  if (result.post.completeness === 'partial') warnings.push('仅取得正文预览，原帖可能还有内容；已在来源状态中标明。');
  const originalText = options.originalText ?? link.url;
  const incoming: BoardNode[] = newSource ? [source] : [];
  const images: { node: BoardNode; image: XImportResult['images'][number] }[] = [];
  const videoNodeIds: string[] = [];
  const totalImages = result.post.media.filter(media => media.kind === 'image').length;
  let imageNumber = 0, videoNumber = 0, availableImages = duplicate.imageNumbers.filter(number => number <= totalImages).length;
  const usedImageResults = new Set<number>();
  const author = authorText(result);
  if (newSource) source.data = {
    ...source.data, title: result.post.title, body: result.post.text, url: link.url, sourceUrl: link.url,
    sourceTitle: result.post.title, sourceAuthor: author, sourceOriginalText: result.post.text,
    tags: mediaTags(result.post.contentKind === 'article' ? '文章' : result.post.contentKind === 'long-post' ? '长文' : '原帖'),
  };
  if (priorPreview) warnings.push('已新增完整正文版本，并连接到先前的预览；旧正文、已做的编辑和已有摘录均已保留。');
  else if ((source.data.sourceOriginalText ?? source.data.body) !== result.post.text) warnings.push('本次取得的正文与现有原帖卡不同，已保留现有的正文和原文快照；仅补充缺失媒体。');
  const genericLinks = matches.filter(node => node.id !== source.id && node.data.kind === 'link' && !hasCapturedSource(node));
  if (newSource && genericLinks.length) warnings.push('已另存原帖正文；原有链接卡和阅读笔记均已保留，并与正文来源关联。');

  for (const media of result.post.media) {
    if (media.kind === 'image') {
      imageNumber++;
      if (duplicate.imageNumbers.includes(imageNumber)) continue;
      if (options.sourceOnly) continue;
      const resultIndex = result.images.findIndex((image, index) => !usedImageResults.has(index) && image.source.kind === 'image' && image.source.url === media.url);
      if (resultIndex >= 0) usedImageResults.add(resultIndex);
      const image = resultIndex >= 0 ? result.images[resultIndex] : undefined;
      if (!image?.data?.byteLength || image.error) {
        warnings.push(`图片 ${imageNumber} 未保存：${image?.error || '未取得图片文件'}。重新导入同一链接可补齐。`);
        continue;
      }
      const mime = image.mime?.toLowerCase().split(';')[0].trim();
      if (!mime || !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(mime)) throw new Error(`图片 ${imageNumber} 格式不受支持，尚未添加卡片。`);
      if (!(image.data instanceof Uint8Array) || image.data.byteLength > STORAGE_LIMITS.mediaBytes) throw new Error(`图片 ${imageNumber} 无效或超过 64 MiB，尚未添加卡片。`);
      if (!image.name?.trim() || image.name.length > 500 || image.name.includes('\0')) throw new Error(`图片 ${imageNumber} 文件名无效，尚未添加卡片。`);
      const node = createNode('image', options.position);
      node.data = {
        ...node.data, title: mediaTitle(result.post.title, ` · 图片 ${imageNumber}`), body: media.altText ?? '',
        // A real new ID makes prevalidation identical to the eventual persisted shape.
        mediaId: uid(), sourceOriginalText: result.post.text, sourceUrl: result.post.contentKind === 'article' ? link.url : `${link.url}/photo/${imageNumber}`,
        ...(result.post.contentKind === 'article' ? { sourceStatus: `文章图片 ${imageNumber}；原图：${media.url}` } : {}),
        sourceTitle: result.post.title, sourceAuthor: author, tags: mediaTags('图片'),
      };
      images.push({ node, image: { ...image, mime } }); incoming.push(node); availableImages++;
    } else if (media.kind === 'video' || media.kind === 'gif') {
      videoNumber++;
      if (duplicate.videoNumbers.includes(videoNumber)) continue;
      if (options.sourceOnly) continue;
      const url = `${link.url}/video/${videoNumber}`, node = createNode('video', options.position);
      node.style = { width: 320 };
      node.data = {
        ...node.data, title: mediaTitle(result.post.title, ` · ${media.kind === 'gif' ? '动图' : '视频'} ${videoNumber}`), body: '', sourceUrl: result.post.contentKind === 'article' ? link.url : url,
        ...(result.post.contentKind === 'article' ? { sourceStatus: `文章视频 ${videoNumber}；视频源：${media.url}` } : {}),
        sourceOriginalText: result.post.text, sourceTitle: result.post.title, sourceAuthor: author, tags: mediaTags(media.kind === 'gif' ? '动图' : '视频'),
        ...(typeof media.duration === 'number' ? { duration: media.duration } : {}),
        ...(media.thumbnailUrl && safeUrl(media.thumbnailUrl) ? { poster: media.thumbnailUrl } : {}),
        videoImport: { attemptId: uid(), url, originalText, status: 'queued', message: '正在保存 X 导入结果，保存后开始下载', mediaReady: false, createdAt: now, updatedAt: now },
      };
      incoming.push(node); videoNodeIds.push(node.id);
    } else throw new Error('X 返回了不支持的媒体类型，尚未添加卡片。');
  }

  const status = sourceStatus(result, availableImages, totalImages, now);
  if (newSource) source.data.sourceStatus = status;
  const freshMedia = incoming.filter(node => node.id !== source.id);
  for (const node of freshMedia) if (!node.data.sourceStatus) node.data.sourceStatus = status;
  // INSP-21: the moment these sources were collected into the board (the reading page's second meta line).
  for (const node of incoming) node.data.collectedAt = now;
  const edges: BoardEdge[] = [], edgePairs = new Set(board.edges.map(edge => `${edge.source}\0${edge.target}`));
  const associate = (from: string, to: string, label: string) => {
    const key = `${from}\0${to}`;
    if (from !== to && !edgePairs.has(key)) { edges.push({ id: uid(), source: from, target: to, label }); edgePairs.add(key); }
  };
  if (priorPreview) associate(priorPreview.id, source.id, '完整正文版本');
  for (const node of genericLinks) associate(node.id, source.id, '原帖正文');
  const replacements = new Map<string, BoardNode>();
  for (const node of matches.filter(node => node.data.kind === 'video' || node.data.kind === 'image')) {
    associate(source.id, node.id, node.data.kind === 'image' ? '原帖图片' : '原帖视频');
    const data = { ...node.data }; let changed = false;
    if (missingOriginalText(node, link.id)) {
      data.sourceOriginalText = result.post.text;
      data.sourceStatus = updatedCaptureStatus(node, status);
      changed = data.sourceOriginalText !== node.data.sourceOriginalText || data.sourceStatus !== node.data.sourceStatus;
    }
    for (const [key, value] of [['sourceTitle', result.post.title], ['sourceAuthor', author], ['sourceStatus', status]] as const) {
      if (typeof data[key] !== 'string' || !String(data[key]).trim()) { data[key] = value; changed = true; }
    }
    if (changed) replacements.set(node.id, { ...node, data });
  }
  for (const node of freshMedia) associate(source.id, node.id, node.data.kind === 'image' ? '原帖图片' : '原帖视频');
  // Refresh source status only for a changed batch; fetching the same post again
  // must not create a fake update just because its retrieval timestamp changed.
  if (!newSource && (source.data.sourceOriginalText ?? source.data.body) === result.post.text) {
    const data = { ...source.data }; let changed = false;
    for (const [key, value] of [['sourceTitle', result.post.title], ['sourceAuthor', author], ['sourceStatus', status]] as const) {
      if (typeof data[key] !== 'string' || !String(data[key]).trim()) { data[key] = value; changed = true; }
    }
    if (incoming.length) { data.sourceStatus = status; changed = true; }
    if (changed) replacements.set(source.id, { ...source, data });
  }
  if (!incoming.length && !edges.length && !replacements.size) {
    checkAbort(options.signal);
    return { board, nodes: [], videoNodeIds: [], mediaIds: [], warnings: uniqueWarnings(warnings), sourceNodeId: source.id, duplicate: true };
  }
  if (board.nodes.length + incoming.length > STORAGE_LIMITS.nodes) throw new Error(`这张画布最多容纳 ${STORAGE_LIMITS.nodes} 张卡片，请先整理再导入 X 链接。`);
  if (board.edges.length + edges.length > STORAGE_LIMITS.edges) throw new Error(`这张画布最多容纳 ${STORAGE_LIMITS.edges} 条连线，请先整理再导入 X 链接。`);
  const placed = placeCards(incoming, board.nodes, { origin: options.position, measurements: options.measurements });
  const nodes = [...board.nodes.map(node => replacements.get(node.id) ?? node), ...placed];
  const next = { ...board, nodes, edges: [...board.edges, ...edges], updatedAt: now };
  validateBoard(next);
  checkAbort(options.signal);
  const mediaIds: string[] = [], save = options.saveMedia ?? storeMedia, remove = options.removeMedia ?? deleteMedia;
  const existingMedia = new Set(board.nodes.flatMap(node => node.data.mediaId ? [node.data.mediaId] : []));
  try {
    for (const { node, image } of images) {
      checkAbort(options.signal);
      const record = await save(new Blob([new Uint8Array(image.data!)], { type: image.mime! }), image.name);
      // A faulty injected store must never make rollback delete an existing asset.
      if (existingMedia.has(record.id) || mediaIds.includes(record.id)) throw new Error('图片存储返回了重复媒体 ID，尚未添加卡片。');
      mediaIds.push(record.id);
      const saved = next.nodes.find(item => item.id === node.id)!;
      saved.data.mediaId = record.id;
      checkAbort(options.signal);
    }
    validateBoard(next);
    checkAbort(options.signal);
  } catch (error) {
    const failures: string[] = [];
    for (const id of mediaIds) try { await remove(id); } catch (cleanupError) { failures.push(reason(cleanupError)); }
    if (failures.length) throw new Error(`${reason(error)} 本次新增的临时图片清理失败：${failures.join('；')}。原有媒体未删除。`, { cause: error });
    throw error;
  }
  const addedIds = new Set(placed.map(node => node.id));
  return { board: next, nodes: next.nodes.filter(node => addedIds.has(node.id)), videoNodeIds, mediaIds, warnings: uniqueWarnings(warnings), sourceNodeId: source.id, duplicate: false };
}
