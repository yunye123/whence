import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { runProcess, toolPaths, type MediaOptions } from '../../electron/media';
import type { Source } from '../../shared/types';
import { normalizeXLink, type XMedia, type XPost } from '../shared/x-import';

/** X正文与用户粘贴的分享文案分别保存；旧来源记录没有这些可选字段。 */
export type XVideoSource = Source & {
  postText?: string;
  postTextStatus?: 'complete' | 'partial' | 'unavailable';
  postTextError?: string;
  postTextFetchedAt?: string;
};
export interface VideoInput { url: string; originalText: string; key: string; platform: string; xVideoIndex?: number }
export interface PublicVideo { mediaUrl: string; title?: string; author?: string; contentId?: string; referer?: string; durationSeconds?: number }
export interface DownloadOptions extends MediaOptions {
  resolvePublicVideo?: (input: VideoInput, options: MediaOptions) => Promise<PublicVideo>;
  resolveXPost?: (input: string, options: MediaOptions) => Promise<XPost>;
}
export function xPostSourceFields(post: XPost): Partial<XVideoSource> {
  return {
    title: post.title,
    author: post.author.name && post.author.handle ? `${post.author.name} (@${post.author.handle.replace(/^@/, '')})` : post.author.name || post.author.handle,
    contentId: post.id, postText: post.text, postTextStatus: post.completeness,
    postTextError: post.completeness === 'partial' ? (post.warnings.join('；') || '公开内容服务仅返回正文预览，原帖可能还有内容。').slice(0, 1024) : undefined,
    postTextFetchedAt: new Date().toISOString(),
  };
}
const MAX_BYTES = 2 * 1024 ** 3;
const directExtension = /\.(mp4|m4v|webm|mov|mkv)$/i;
const abortError = () => Object.assign(new Error('任务已取消'), { name: 'AbortError' });
const domainIs = (host: string, domain: string) => host === domain || host.endsWith('.' + domain);

/** Only public destinations are supported. The direct downloader also validates DNS and every redirect. */
export function isPublicAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b)));
  }
  if (isIP(host) === 6) return /^(2|3)[0-9a-f]{0,3}:/.test(host) && !host.startsWith('2001:db8:');
  return host.includes('.') && !host.endsWith('.local') && !host.endsWith('.localhost') && !host.endsWith('.internal') && host !== 'localhost';
}

function validatePublicUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('链接格式不正确，请粘贴完整的视频分享链接。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port)) || !isPublicAddress(url.hostname)) throw new Error('请使用公开的 HTTP 或 HTTPS 视频链接。');
  return url;
}

export function normalizeVideoInput(input: string): VideoInput {
  if (typeof input !== 'string' || input.length > 12000) throw new Error('分享内容过长，请只粘贴一条视频分享链接。');
  const originalText = input.trim();
  const matches = [...originalText.matchAll(/https?:\/\/[^\s<>"'，。；！？）)【】]+/gi)].map(match => match[0].replace(/[.,;!?)\]}]+$/, ''));
  if (!matches.length) throw new Error('没有找到视频链接。可以直接粘贴 X、抖音、小红书或 B 站的完整分享文案。');
  if (new Set(matches).size > 1) throw new Error('检测到多条链接，请每次导入一条视频。');
  const url = validatePublicUrl(matches[0]);
  const host = url.hostname.toLowerCase();
  let platform = '', identity = '', xVideoIndex: number | undefined;
  if (domainIs(host, 'x.com') || domainIs(host, 'twitter.com')) {
    if (/^\/i\/article\//.test(url.pathname)) throw new Error('这是 X 文章链接，请使用「X 素材导入」并粘贴发布文章的推文链接。');
    if (/\/photo\/\d+\/?$/.test(url.pathname)) throw new Error('这是 X 图片链接，请使用「X 素材导入」获取图文内容。');
    const selected = url.pathname.match(/\/video\/(\d+)\/?$/)?.[1];
    if (selected !== undefined) {
      xVideoIndex = Number(selected);
      if (!Number.isSafeInteger(xVideoIndex) || xVideoIndex < 1 || xVideoIndex > 100) throw new Error('X 视频序号无效，请使用「X 素材导入」选择视频。');
    }
    const link = normalizeXLink(url.href);
    return { url: link.url + (xVideoIndex ? `/video/${xVideoIndex}` : ''), originalText, platform: 'X',
      // Bare posts must resolve to exactly one video; never reuse a prior explicit first video before resolving that choice.
      key: `${link.key}:video:${xVideoIndex || 'single'}`, ...(xVideoIndex ? { xVideoIndex } : {}) };
  } else if (domainIs(host, 'douyin.com') || domainIs(host, 'iesdouyin.com')) {
    platform = '抖音'; identity = url.pathname.match(/\/(?:video|note)\/(\d+)/)?.[1] || url.searchParams.get('modal_id') || '';
    if (identity) { url.hostname = 'www.douyin.com'; url.pathname = `/video/${identity}`; url.search = ''; }
    else if (!domainIs(host, 'v.douyin.com')) throw new Error('请复制具体视频的分享链接，主页或直播链接暂不能导入。');
  } else if (domainIs(host, 'xiaohongshu.com') || domainIs(host, 'xhslink.com')) {
    platform = '小红书'; identity = url.pathname.match(/\/(?:explore|discovery\/item|search_result)\/([a-f\d]+)/i)?.[1] || '';
    if (identity) { url.hostname = 'www.xiaohongshu.com'; url.pathname = `/explore/${identity}`; }
    else if (!domainIs(host, 'xhslink.com')) throw new Error('请复制具体视频笔记的分享链接，主页链接暂不能导入。');
    // xsec_token and all share parameters must survive normalization.
  } else if (domainIs(host, 'bilibili.com') || domainIs(host, 'b23.tv')) {
    platform = 'B站'; identity = url.pathname.match(/\/video\/((?:BV|av)[a-z\d]+)/i)?.[1] || url.searchParams.get('bvid') || '';
    if (identity) {
      const page = url.searchParams.get('p'); url.hostname = 'www.bilibili.com'; url.pathname = `/video/${identity}`; url.search = '';
      if (page && /^\d+$/.test(page) && Number(page) > 1) url.searchParams.set('p', page);
      identity += `:p${page && /^\d+$/.test(page) ? Number(page) : 1}`;
    } else if (!domainIs(host, 'b23.tv')) throw new Error('请复制具体视频的分享链接，合集、主页或直播链接暂不能导入。');
  } else if (domainIs(host, 'youtube.com') || domainIs(host, 'youtu.be')) {
    platform = 'YouTube'; identity = domainIs(host, 'youtu.be') ? url.pathname.split('/')[1] : url.searchParams.get('v') || url.pathname.match(/\/(?:shorts|embed)\/([\w-]+)/)?.[1] || '';
    if (!identity || !/^[\w-]{11}$/.test(identity)) throw new Error('请复制具体 YouTube 视频的链接。');
    url.hostname = 'www.youtube.com'; url.pathname = '/watch'; url.search = ''; url.searchParams.set('v', identity);
  } else if (directExtension.test(url.pathname)) { platform = '视频直链'; }
  else throw new Error('当前可自动导入 X、抖音、小红书、B 站、YouTube，以及公开的 MP4 / WebM 视频直链。');
  url.hash = '';
  return { url: url.href, originalText, platform, key: `${platform}:${identity || url.href}` };
}

/** Select explicitly for multi-video posts; images and external link previews are never video substitutes. */
export function selectXVideo(post: XPost, input: VideoInput): XMedia {
  const link = normalizeXLink(input.url);
  if (post.id !== link.id) throw new Error('X 返回的推文与链接不一致，请重新复制推文链接后重试。');
  const videos = post.media.filter(media => media.kind === 'video' || media.kind === 'gif');
  if (!videos.length) throw new Error('这条 X 推文没有可用视频。请使用「X 素材导入」获取图文或长文。');
  if (videos.length > 1 && input.xVideoIndex === undefined) throw new Error(`这条 X 推文有 ${videos.length} 个视频。请使用「X 素材导入」选择视频后导入。`);
  const index = input.xVideoIndex || 1;
  const selected = videos[index - 1];
  if (!selected) throw new Error(`这条 X 推文只有 ${videos.length} 个视频，找不到第 ${index} 个。请使用「X 素材导入」重新选择。`);
  return selected;
}

async function openPublicUrl(value: string, options: MediaOptions, redirects = 0, referer?: string): Promise<IncomingMessage> {
  if (options.signal?.aborted) throw abortError();
  if (redirects > 5) throw new Error('视频链接重定向次数过多，请重新复制分享链接。');
  const url = validatePublicUrl(value);
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('视频链接指向非公开网络地址，无法导入。');
  const selected = addresses.find(item => item.family === 4) || addresses[0];
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      signal: options.signal, headers: { 'User-Agent': 'Mozilla/5.0 FIELD/0.1', Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.5', ...(referer ? { Referer: referer } : {}) },
      // Pin the validated address; do not resolve the host again in the socket connection.
      lookup: ((_host: string, lookupOptions: { all?: boolean }, callback: (...args: unknown[]) => void) => lookupOptions.all ? callback(null, [selected]) : callback(null, selected.address, selected.family)) as never,
    }, resolve);
    request.setTimeout(25_000, () => request.destroy(new Error('视频服务器响应超时，请稍后重试。')));
    request.on('error', reject); request.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
    const next = new URL(response.headers.location, url).href; response.destroy();
    return openPublicUrl(next, options, redirects + 1, referer);
  }
  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) { response.destroy(); throw new Error(`视频服务器返回 ${response.statusCode || '未知错误'}，链接可能已过期。`); }
  return response;
}

async function downloadDirect(url: string, tmp: string, options: MediaOptions, referer?: string, xMedia = false) {
  const xResponse = xMedia ? await (await import('./x-public-request')).openXPublicResponse(url, { purpose: 'video', signal: options.signal }) : undefined;
  const response = xResponse ? Readable.from(xResponse.body) : await openPublicUrl(url, options, 0, referer ? validatePublicUrl(referer).href : undefined);
  const size = xResponse ? xResponse.contentLength || 0 : Number((response as IncomingMessage).headers['content-length'] || 0);
  try {
    if (size > MAX_BYTES) { response.destroy(); throw new Error('单条视频超过 2 GB，当前无法自动导入。'); }
    const extension = new URL(url).pathname.match(directExtension)?.[0].toLowerCase() || '.mp4';
    const filePath = path.join(tmp, `source${extension}`);
    let bytes = 0, lastNotification = 0;
    const meter = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) return callback(new Error('单条视频超过 2 GB，当前无法自动导入。'));
      const now = Date.now();
      if (now - lastNotification >= 150 || bytes === size) {
        lastNotification = now;
        options.onProgress?.(size ? Math.min(90, 5 + 85 * bytes / size) : 25, `正在下载视频（${(bytes / 1024 ** 2).toFixed(1)} MB）`);
      }
      callback(null, chunk);
    } });
    await pipeline(response, meter, createWriteStream(filePath, { flags: 'wx' }), { signal: options.signal });
    return filePath;
  } finally { xResponse?.dispose(); }
}

export function downloadErrorMessage(error: unknown, platform: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/任务已取消|abort/i.test(message)) return '任务已取消';
  if (/No module named yt_dlp|ENOENT|EPERM|EACCES/.test(message)) return '本机视频下载工具未能启动，请检查本机处理工具后重试。';
  if (/max.filesize|larger than|2 GB/.test(message)) return '单条视频超过 2 GB，当前无法自动导入。';
  if (/Fresh cookies|sign.in|login|cookies|captcha|HTTP Error 403|HTTP Error 412|HTTP Error 429|verify|验证/i.test(message)) return `${platform}暂未允许自动获取该视频。请在原平台确认视频可播放后重新复制完整分享链接，再点重试。`;
  if (/No video formats|Unsupported URL|not available|not found|HTTP Error 404|initial state|视频画面/.test(message)) return `${platform}链接没有返回可用视频，可能已失效、需要登录或是图文内容。请重新复制视频的完整分享链接后重试。`;
  if (/timeout|timed out|网络|ECONN|ENOTFOUND|响应超时/i.test(message)) return '视频下载连接超时或网络不可用，请检查网络后重试。';
  return message.startsWith('python') ? `${platform}暂时无法下载该视频，请保留链接并稍后重试。` : message;
}

/** Downloads only. The caller imports filePath and removes its unique parent directory on success. */
/** Description text from yt-dlp's info.json. Not stored on the SQLite source. */
export function infoDescription(info: unknown): string | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const value = (info as { description?: unknown }).description;
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\u0000/g, '').trim().slice(0, 20_000);
  return text || undefined;
}

export async function downloadVideo(input: string, projectDir: string, options: DownloadOptions = {}): Promise<{ filePath: string; source: Partial<XVideoSource>; description?: string }> {
  const normalized = normalizeVideoInput(input);
  if (options.signal?.aborted) throw abortError();
  const tmp = path.join(path.resolve(projectDir), 'cache', 'downloads', randomUUID());
  await mkdir(tmp, { recursive: true });
  const source: Partial<XVideoSource> = { url: normalized.url, originalText: normalized.originalText, platform: normalized.platform, title: `${normalized.platform}视频`, author: '', status: 'pending' };
  const tools = toolPaths();
  const deadline = AbortSignal.timeout(30 * 60_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const timedOptions = { ...options, signal };
  try {
    options.onProgress?.(2, `正在解析${normalized.platform}视频链接`);
    let filePath = '';
    let description: string | undefined;
    if (normalized.platform === '视频直链') {
      filePath = await downloadDirect(normalized.url, tmp, timedOptions);
      const title = new URL(normalized.url).pathname.split('/').pop() || '视频';
      try { source.title = decodeURIComponent(title); } catch { source.title = title; }
    } else if (normalized.platform === 'X') {
      const resolve = options.resolveXPost || (await import('./x-import')).resolveXPost;
      const post = await resolve(normalized.url, timedOptions);
      const media = selectXVideo(post, normalized);
      Object.assign(source, xPostSourceFields(post));
      filePath = await downloadDirect(media.url, tmp, timedOptions, post.url, true);
    } else {
      let lastDownloadProgress = 5;
      try { await runProcess(tools.python, ['-m', 'yt_dlp', '--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--no-playlist', '--no-colors', '--newline', '--progress', '--socket-timeout', '25', '--retries', '1', '--extractor-retries', '1', '--max-filesize', '2G', '--ffmpeg-location', path.dirname(tools.ffmpeg), '-f', 'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b', '--merge-output-format', 'mp4', '-o', path.join(tmp, 'source.%(ext)s'), '--print', 'after_move:FIELD_FILE:%(filepath)s', '--progress-template', 'download:FIELD_PROGRESS:%(progress._percent_str)s', '--write-info-json', '--', normalized.url], {
        ...timedOptions, onLine(line) {
          if (line.startsWith('FIELD_FILE:')) filePath = line.slice('FIELD_FILE:'.length).trim();
          const percentage = line.match(/FIELD_PROGRESS:\s*([\d.]+)%/);
          if (percentage) {
            lastDownloadProgress = Math.max(lastDownloadProgress, 5 + Math.min(100, Number(percentage[1])) * 0.85);
            options.onProgress?.(lastDownloadProgress, `正在下载${normalized.platform}视频`);
          }
        },
      }); } catch (error) {
        if (signal.aborted || !options.resolvePublicVideo || !['抖音', '小红书'].includes(normalized.platform)) throw error;
        options.onProgress?.(5, `正在通过${normalized.platform}公开网页获取视频`);
        const publicVideo = await options.resolvePublicVideo(normalized, timedOptions);
        // The browser returns a normally playable public CDN URL; no cookies are exported.
        filePath = await downloadDirect(publicVideo.mediaUrl, tmp, timedOptions, publicVideo.referer);
        if (publicVideo.title) source.title = publicVideo.title;
        if (publicVideo.author) source.author = publicVideo.author;
        if (publicVideo.contentId) source.contentId = publicVideo.contentId;
      }
      const infoFile = (await readdir(tmp)).find(name => name.endsWith('.info.json'));
      if (infoFile) {
        const info = JSON.parse(await readFile(path.join(tmp, infoFile), 'utf8'));
        source.title = typeof info.title === 'string' ? info.title : source.title;
        source.author = typeof info.uploader === 'string' ? info.uploader : typeof info.creator === 'string' ? info.creator : '';
        source.contentId = typeof info.id === 'string' ? info.id : undefined;
        description = infoDescription(info);
        // Keep the user's original URL including share credentials; the ID is the stable provenance.
      }
    }
    if (!filePath || !path.resolve(filePath).startsWith(path.resolve(tmp) + path.sep) || !existsSync(filePath) || !(await stat(filePath)).size) throw new Error('链接没有返回可用的视频画面。');
    const metadata = JSON.parse(await runProcess(tools.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath], timedOptions));
    if (!Array.isArray(metadata.streams) || !metadata.streams.some((stream: { codec_type?: string }) => stream.codec_type === 'video')) throw new Error('链接没有返回可用的视频画面。');
    // Silent videos remain valid canvas assets; ASR is skipped by the service.
    source.status = 'resolved'; options.onProgress?.(95, '视频已下载，正在加入画布');
    return { filePath, source, ...(description ? { description } : {}) };
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    if (options.signal?.aborted) throw abortError();
    const message = deadline.aborted ? '视频下载超过 30 分钟，已停止。请检查网络后重试。' : downloadErrorMessage(error, normalized.platform);
    throw Object.assign(new Error(message, { cause: error }), { meta: { ...source, status: 'failed', error: message } });
  }
}
