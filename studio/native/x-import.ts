import { openXPublicResponse, type XPublicRequestOptions } from './x-public-request';
export { isPublicXAddress } from './x-public-request';
import { normalizeXLink, type XImportRequest, type XImportResult, type XLink, type XMedia, type XPost } from '../shared/x-import';

const MAX_JSON = 3 * 1024 ** 2;
export const X_IMAGE_MAX_BYTES = 16 * 1024 ** 2;
export const X_IMAGES_MAX_BYTES = 64 * 1024 ** 2;
export const X_IMAGES_MAX_COUNT = 20;
const abortError = () => Object.assign(new Error('X 导入已取消。'), { name: 'AbortError' });
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/\0/g, '') : '';
const positive = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
function publicLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
function mediaLink(value: unknown, kind: XMedia['kind']): string | undefined {
  const link = publicLink(value);
  if (!link) return undefined;
  const url = new URL(link);
  if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return undefined;
  if (kind === 'image' && url.hostname !== 'pbs.twimg.com') return undefined;
  if (kind !== 'image' && url.hostname !== 'video.twimg.com') return undefined;
  return url.href;
}
function warn(warnings: string[], message: string) { if (!warnings.includes(message)) warnings.push(message); }

function parseMedia(value: unknown, warnings: string[]): XMedia | undefined {
  const item = object(value), info = object(item.media_info), typename = text(info.__typename);
  const rawKind = text(item.type);
  const kind: XMedia['kind'] | undefined = rawKind === 'photo' || rawKind === 'image' || typename === 'ApiImage' ? 'image' : rawKind === 'gif' || rawKind === 'animated_gif' ? 'gif' : rawKind === 'video' || /Video/.test(typename) ? 'video' : undefined;
  if (!kind) { warn(warnings, '这条推文含有当前无法导入的媒体类型，请在原文中查看。'); return undefined; }
  let candidate = item.url || info.original_img_url;
  if (kind !== 'image') {
    const variants = [...array(item.formats), ...array(info.variants), ...array(object(info.video_info).variants)]
      .map(object).filter(format => text(format.container) === 'mp4' || text(format.content_type) === 'video/mp4' || /\.mp4(?:\?|$)/i.test(text(format.url)))
      .filter(format => mediaLink(format.url, kind))
      .sort((a, b) => (positive(b.bitrate || b.bit_rate) || 0) - (positive(a.bitrate || a.bit_rate) || 0));
    candidate = variants[0]?.url || candidate;
  }
  let url = mediaLink(candidate, kind);
  if (!url || (kind !== 'image' && !/\.mp4(?:\?|$)/i.test(url))) { warn(warnings, '一项媒体没有返回可用的公开图片或 MP4 地址，请在原文中查看。'); return undefined; }
  // Article original_img_url omits the CDN size parameter even when its dimensions
  // describe the original. Ask the already validated image CDN for those original bytes.
  if (kind === 'image') { const original = new URL(url); original.searchParams.set('name', 'orig'); url = original.href; }
  const thumbnailUrl = mediaLink(item.thumbnail_url || info.preview_image_url || info.poster_url, 'image');
  const duration = positive(item.duration) || (positive(object(info.video_info).duration_millis || info.duration_millis) ? Number(object(info.video_info).duration_millis || info.duration_millis) / 1000 : undefined);
  return { kind, url, ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(positive(item.width || info.original_img_width) ? { width: Number(item.width || info.original_img_width) } : {}),
    ...(positive(item.height || info.original_img_height) ? { height: Number(item.height || info.original_img_height) } : {}),
    ...(duration ? { duration } : {}), ...(text(item.alt_text || info.alt_text || item.ext_alt_text) ? { altText: text(item.alt_text || info.alt_text || item.ext_alt_text) } : {}) };
}

function articleText(article: JsonObject, media: XMedia[], warnings: string[]): { text: string; complete: boolean } {
  const content = object(article.content || article.content_state), blocks = array(content.blocks);
  if (!blocks.length) {
    warn(warnings, '内容服务仅返回文章预览，尚未取得全文。请打开原文核对，或稍后重试。');
    return { text: text(article.preview_text), complete: false };
  }
  if (blocks.length > 5000 || array(content.entityMap).length > 5000) throw new Error('X 文章结构超过当前可导入范围，请改为导入本机正文文件。');
  const entities = new Map<string, JsonObject>();
  if (Array.isArray(content.entityMap)) for (const entry of content.entityMap) { const row = object(entry); entities.set(String(row.key), object(row.value)); }
  else for (const [key, value] of Object.entries(object(content.entityMap))) entities.set(key, object(value));
  const articleMedia = new Map(array(article.media_entities).map(value => [text(object(value).media_id), value]));
  let complete = true, ordered = 0;
  const rendered: { text: string; type: string }[] = [];
  for (const value of blocks) {
    const block = object(value);
    if (typeof block.text !== 'string') { complete = false; warn(warnings, '文章中有一段内容缺少正文，已保留其他段落。'); continue; }
    let body = text(block.text), type = text(block.type);
    const ranges = array(block.entityRanges).map(object).sort((a, b) => Number(b.offset) - Number(a.offset));
    for (const range of ranges) {
      const offset = Number(range.offset), length = Number(range.length), entity = entities.get(String(range.key));
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > body.length || !entity) {
        complete = false; warn(warnings, '文章中有一项嵌入内容缺少来源，已保留原有占位文字。'); continue;
      }
      const data = object(entity.data), entityType = text(entity.type);
      let replacement: string | undefined;
      if (entityType === 'TWEET' && /^\d{1,25}$/.test(text(data.tweetId))) replacement = `[嵌入推文](https://x.com/i/web/status/${text(data.tweetId)})`;
      else if (entityType === 'MARKDOWN' && typeof data.markdown === 'string') replacement = text(data.markdown);
      else if (entityType === 'DIVIDER') replacement = '\n---\n';
      else if (entityType === 'LINK') {
        const href = publicLink(data.url);
        if (href) replacement = `[${body.slice(offset, offset + length).replace(/\]/g, '\\]')}](${href.replace(/\)/g, '%29')})`;
      } else if (entityType === 'MEDIA') {
        const links: string[] = [];
        for (const item of array(data.mediaItems).map(object)) {
          const rawMedia = articleMedia.get(text(item.mediaId));
          const parsed = rawMedia ? parseMedia(rawMedia, warnings) : undefined;
          if (parsed) { media.push(parsed); links.push(`[${parsed.altText || (parsed.kind === 'image' ? '文章图片' : '文章视频')} 来源](${parsed.url})`); }
          else { complete = false; warn(warnings, '文章中有一项媒体未取得公开来源，请在原文查看。'); }
        }
        if (links.length) replacement = links.join('\n');
      }
      if (replacement === undefined) { complete = false; warn(warnings, '文章中有一项嵌入内容暂不支持，已保留原有文字。'); }
      else body = body.slice(0, offset) + replacement + body.slice(offset + length);
    }
    const depth = Number.isInteger(block.depth) ? Math.max(0, Math.min(8, Number(block.depth))) : 0;
    if (type === 'ordered-list-item') { ordered++; body = `${'  '.repeat(depth)}${ordered}. ${body}`; }
    else { ordered = 0; if (type === 'unordered-list-item') body = `${'  '.repeat(depth)}- ${body}`; }
    if (/^header-(one|two|three|four|five|six)$/.test(type)) body = `${'#'.repeat(['one', 'two', 'three', 'four', 'five', 'six'].indexOf(type.slice(7)) + 1)} ${body}`;
    if (type === 'blockquote') body = body.split('\n').map(line => `> ${line}`).join('\n');
    if (type === 'code-block') { const fence = '`'.repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map(match => match[0].length + 1))); body = `${fence}\n${body}\n${fence}`; }
    rendered.push({ text: body, type });
  }
  return { text: rendered.map((block, index) => block.text + (index < rendered.length - 1 ? /list-item/.test(block.type) && /list-item/.test(rendered[index + 1].type) ? '\n' : '\n\n' : '')).join('').trim(), complete };
}

/** FxTwitter v2 is already a processed full-note response. Never use article preview as full content. */
export function parseFxTwitterResponse(payload: unknown, link: XLink | string): XPost {
  const normalized = typeof link === 'string' ? normalizeXLink(link) : link;
  const root = object(payload), status = object(root.status);
  if (root.code !== 200 || !Object.keys(status).length || (status.type && status.type !== 'status')) {
    const code = Number(root.code) || 0;
    throw new Error(code === 404 ? '找不到这条 X 推文，可能已删除或不可公开访问。' : code === 401 || code === 403 ? '这条 X 推文需要权限或登录，无法通过公开内容服务导入。' : code === 429 ? 'X 内容服务请求过于频繁，请稍后重试。' : 'X 内容服务未返回可导入的公开推文，请稍后重试。');
  }
  if (text(status.id) !== normalized.id) throw new Error('内容服务返回的推文 ID 与链接不一致，已停止导入。');
  const author = object(status.author), handle = text(author.screen_name);
  if (!/^[A-Za-z0-9_]{1,50}$/.test(handle) || !text(author.name)) throw new Error('内容服务未返回完整的作者来源，已停止导入。');
  if (author.protected === true) throw new Error('这条 X 推文来自受保护账号，无法通过公开内容服务导入。');
  const warnings: string[] = [], media: XMedia[] = [];
  const attachment = object(status.media);
  const ownMedia = Array.isArray(attachment.all) ? attachment.all : [...array(attachment.photos), ...array(attachment.videos)];
  for (const value of ownMedia) { const parsed = parseMedia(value, warnings); if (parsed) media.push(parsed); }
  let body = text(status.text), completeness: XPost['completeness'] = 'complete';
  const note = object(object(object(status.note_tweet).note_tweet_results).result);
  if (typeof note.text === 'string') body = text(note.text);
  let contentKind: XPost['contentKind'] = status.is_note_tweet === true || typeof note.text === 'string' || body.length > 280 ? 'long-post' : 'post';
  const article = object(status.article);
  if (Object.keys(article).length) {
    contentKind = 'article';
    const result = articleText(article, media, warnings);
    body = result.text;
    if (!result.complete) completeness = 'partial';
    if (Object.keys(object(article.cover_media)).length) { const cover = parseMedia(article.cover_media, warnings); if (cover) media.unshift({ ...cover, altText: cover.altText || `文章封面：${text(article.title)}` }); }
  } else if (status.truncated === true || (status.is_note_tweet === true && body.length <= 280 && /(?:…|\.\.\.)\s*$/.test(body))) {
    completeness = 'partial'; warn(warnings, '内容服务可能只返回了长推文的前一部分，请打开原文核对或稍后重试。');
  }
  const quote = object(status.quote);
  if (Object.keys(quote).length) {
    const quoteAuthor = object(quote.author), quoteId = text(quote.id), quoteHandle = text(quoteAuthor.screen_name);
    if (/^\d{1,25}$/.test(quoteId)) body += `\n\n引用${quoteHandle ? ` @${quoteHandle}` : '的推文'}：https://x.com/${quoteHandle || 'i/web'}/status/${quoteId}`;
    else warn(warnings, '引用的推文目前不可公开访问，请在原文中查看。');
  }
  if (status.reposted_by) { const reposter = object(status.reposted_by); warn(warnings, `此内容为转推，正文作者为 @${handle}${text(reposter.screen_name) ? `，转推者为 @${text(reposter.screen_name)}` : ''}。`); }
  const uniqueMedia = [...new Map(media.map(item => [`${item.kind}:${item.url}`, item])).values()];
  if (body.length > 300000) throw new Error('X 正文超过 30 万字符，请改为导入本机正文文件。');
  if (!body.trim() && !uniqueMedia.length) throw new Error('这条 X 推文没有返回可导入的正文或媒体。');
  const title = text(article.title).trim() || body.split('\n').find(line => line.trim())?.trim().slice(0, 120) || `${text(author.name)}的 X ${uniqueMedia.some(item => item.kind !== 'image') ? '视频' : '图文'}`;
  const timestamp = typeof status.created_timestamp === 'number' ? status.created_timestamp * 1000 : Date.parse(text(status.created_at));
  const publishedAt = Number.isFinite(timestamp) && timestamp > 0 && timestamp <= 8.64e15 ? new Date(timestamp).toISOString() : undefined;
  return { id: normalized.id, url: `https://x.com/${handle}/status/${normalized.id}`, title, author: { name: text(author.name), handle, url: `https://x.com/${handle}` }, text: body, ...(publishedAt ? { publishedAt } : {}), provider: 'fxtwitter', contentKind, completeness, warnings, media: uniqueMedia };
}

export type XNetworkOptions = Omit<XPublicRequestOptions, 'purpose'>;
/** Bound the complete body in addition to the shared public transport's host/DNS/redirect checks. */
export async function fetchXResource(value: string, purpose: 'metadata' | 'image', maxBytes: number, options: XNetworkOptions = {}): Promise<{ data: Uint8Array; mime: string }> {
  const response = await openXPublicResponse(value, { ...options, purpose });
  try {
    if (response.contentLength > maxBytes) throw new Error(purpose === 'image' ? '单张 X 图片超过 16 MB，已保留图片来源。' : 'X 正文响应过大，无法导入。');
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk); bytes += buffer.length;
      if (bytes > maxBytes) throw new Error(purpose === 'image' ? 'X 图片超过可用导入大小，已保留图片来源。' : 'X 正文响应过大，无法导入。');
      chunks.push(buffer);
    }
    if (!bytes || (response.contentLength > 0 && response.contentLength !== bytes)) throw new Error('X 内容下载不完整，请稍后重试。');
    const data = Buffer.concat(chunks, bytes);
    if (purpose === 'image' && !isImageBytes(data, response.mime)) throw new Error('X 图片内容与文件格式不匹配，已保留图片来源。');
    return { data: new Uint8Array(data), mime: response.mime };
  } finally { response.dispose(); }
}
function isImageBytes(data: Uint8Array, mime: string): boolean {
  const head = Buffer.from(data.subarray(0, 16));
  if (mime === 'image/jpeg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === 'image/png') return head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/gif') return /^GIF8[79]a$/.test(head.subarray(0, 6).toString('ascii'));
  return head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP';
}

export async function resolveXPost(input: string, options: { signal?: AbortSignal } = {}): Promise<XPost> {
  const link = normalizeXLink(input);
  const response = await fetchXResource(`https://api.fxtwitter.com/2/status/${link.id}`, 'metadata', MAX_JSON, options);
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.data)); } catch { throw new Error('X 内容服务返回了无法解析的正文，请稍后重试。'); }
  return parseFxTwitterResponse(payload, link);
}

export interface XImportServiceOptions {
  resolvePost?: typeof resolveXPost;
  fetchImage?: (url: string, maxBytes: number, signal: AbortSignal) => Promise<{ data: Uint8Array; mime: string }>;
  maxConcurrent?: number;
}
interface Waiter { signal: AbortSignal; start: () => void; reject: (error: Error) => void; abort: () => void }
/** Bounded in-memory content queue. Videos are handed to the existing durable video service. */
export class XImportService {
  private controllers = new Map<string, AbortController>();
  private waiting: Waiter[] = [];
  private active = 0;
  private closed = false;
  private readonly concurrency: number;
  constructor(private readonly options: XImportServiceOptions = {}) { this.concurrency = Math.max(1, Math.min(4, Math.floor(options.maxConcurrent || 3))); }
  async resolve(input: XImportRequest): Promise<XImportResult> {
    if (this.closed) throw new Error('应用正在退出，请重新打开后导入。');
    if (!input || typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId.length > 200 || input.requestId.includes('\0')) throw new Error('X 导入请求标识无效。');
    if (input.sourceOnly !== undefined && typeof input.sourceOnly !== 'boolean') throw new Error('X 来源补全请求参数无效。');
    normalizeXLink(input.url);
    if (this.controllers.has(input.requestId)) throw new Error('这项 X 导入正在进行，请等待或取消后重试。');
    if (this.controllers.size >= 16) throw new Error('已有 16 项 X 导入，请等待部分任务完成。');
    const controller = new AbortController(); this.controllers.set(input.requestId, controller);
    let acquired = false;
    try {
      await this.acquire(controller.signal); acquired = true;
      const post = await (this.options.resolvePost || resolveXPost)(input.url, { signal: controller.signal });
      if (controller.signal.aborted) throw abortError();
      const images: XImportResult['images'] = [], sources = post.media.filter(item => item.kind === 'image');
      if (input.sourceOnly === true) return { post, images: sources.map((source, index) => ({ source, name: `X-${post.id}-${index + 1}` })) };
      let totalBytes = 0;
      for (let index = 0; index < sources.length; index++) {
        const source = sources[index];
        const image: XImportResult['images'][number] = { source, name: `X-${post.id}-${index + 1}` };
        try {
          if (controller.signal.aborted) throw abortError();
          if (index >= X_IMAGES_MAX_COUNT) throw new Error('单条 X 内容最多导入 20 张图片，已保留这张图片的来源。');
          if (totalBytes >= X_IMAGES_MAX_BYTES) throw new Error('本条 X 图片合计超过 64 MB，已保留这张图片的来源。');
          const maxBytes = Math.min(X_IMAGE_MAX_BYTES, X_IMAGES_MAX_BYTES - totalBytes);
          const result = await (this.options.fetchImage || ((url, max, signal) => fetchXResource(url, 'image', max, { signal })))(source.url, maxBytes, controller.signal);
          if (controller.signal.aborted) throw abortError();
          if (!result.data.length || result.data.length > maxBytes) throw new Error('X 图片超过当前可用导入大小，已保留图片来源。');
          totalBytes += result.data.length; image.data = result.data; image.mime = result.mime;
          image.name += `.${({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[result.mime] || 'img'}`;
        } catch (error) {
          if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw abortError();
          image.error = error instanceof Error ? error.message : '这张 X 图片未能下载，已保留来源。';
          warn(post.warnings, `第 ${index + 1} 张图片未存入本机：${image.error}`);
        }
        images.push(image);
      }
      return { post, images };
    } finally { this.controllers.delete(input.requestId); if (acquired) { this.active--; this.next(); } }
  }
  cancel(requestId: string): void { this.controllers.get(requestId)?.abort(); }
  close(): void { this.closed = true; for (const controller of this.controllers.values()) controller.abort(); }
  private acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError());
    if (this.active < this.concurrency) { this.active++; return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { signal, start: () => { signal.removeEventListener('abort', waiter.abort); this.active++; resolve(); }, reject, abort: () => { this.waiting = this.waiting.filter(item => item !== waiter); reject(abortError()); } };
      signal.addEventListener('abort', waiter.abort, { once: true }); this.waiting.push(waiter);
    });
  }
  private next() { while (this.waiting.length && this.active < this.concurrency) { const waiter = this.waiting.shift()!; if (waiter.signal.aborted) waiter.reject(abortError()); else waiter.start(); } }
}
