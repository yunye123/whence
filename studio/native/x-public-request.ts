import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';

export type XResourcePurpose = 'metadata' | 'image' | 'video';
export interface XPublicRequestOptions {
  purpose: XResourcePurpose;
  signal?: AbortSignal;
  timeoutMs?: number;
  lookup?: (host: string) => Promise<{ address: string; family: number }[]>;
  request?: (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
  /** Tests inject a proxy transport. Production obtains it only from Electron's configured session. */
  proxyTransport?: { fetch: (url: string, options: RequestInit) => Promise<Response> };
}
export interface XPublicResponse {
  body: AsyncIterable<Uint8Array>;
  mime: string;
  contentLength: number;
  transport: 'direct-dns-pinned' | 'electron-system-proxy';
  dispose(): void;
}
const abortError = () => Object.assign(new Error('X 导入已取消。'), { name: 'AbortError' });

export function isPublicXAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(ip) === 6) return /^[23][0-9a-f]{0,3}:/.test(ip) && !/^2001:(?:db8|0|10|20):/.test(ip) && !ip.startsWith('2002:');
  return false;
}
export function validateXResourceUrl(value: string, purpose: XResourcePurpose): URL {
  let url: URL; try { url = new URL(value); } catch { throw new Error('X 内容服务返回了无效地址。'); }
  const host = { metadata: 'api.fxtwitter.com', image: 'pbs.twimg.com', video: 'video.twimg.com' }[purpose];
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hostname !== host) throw new Error('X 内容地址不在允许的公开服务范围，已停止访问。');
  return url;
}
export function withXAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const aborted = () => reject(abortError()); signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
async function configuredProxy(url: URL, signal: AbortSignal): Promise<XPublicRequestOptions['proxyTransport']> {
  if (!process.versions.electron || process.type === 'renderer') return undefined;
  const { net, session } = await import('electron');
  const route = await withXAbort(session.defaultSession.resolveProxy(url.href), signal);
  if (!route || route === 'DIRECT') return undefined;
  return { fetch: (value, options) => net.fetch(value, { ...options, bypassCustomProtocolHandlers: true }) };
}

/** Public X-only transport. Direct sockets pin checked DNS; an existing system proxy is handled by Electron. */
export async function openXPublicResponse(value: string, options: XPublicRequestOptions): Promise<XPublicResponse> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? (options.purpose === 'video' ? 30 * 60000 : 25000));
  const disposed = new AbortController();
  const signal = AbortSignal.any([timeout, disposed.signal, ...(options.signal ? [options.signal] : [])]);
  const translateError = (error: unknown): never => {
    if (options.signal?.aborted || disposed.signal.aborted) throw abortError();
    if (timeout.aborted) throw new Error('X 内容获取超时，请检查网络后重试。');
    throw error;
  };
  try {
    let current = value;
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (signal.aborted) throw abortError();
      const url = validateXResourceUrl(current, options.purpose);
      const addresses = await withXAbort((options.lookup || (host => dnsLookup(host, { all: true })))(url.hostname), signal);
      if (!addresses.length || addresses.some(item => !isPublicXAddress(item.address) || ![4, 6].includes(item.family) || isIP(item.address) !== item.family)) throw new Error('X 内容地址指向非公开网络，已停止访问。');
      const proxy = options.proxyTransport || (!options.request ? await configuredProxy(url, signal) : undefined);
      const headers = { 'User-Agent': 'Mozilla/5.0 FIELD/0.1', Accept: options.purpose === 'metadata' ? 'application/json' : options.purpose === 'image' ? 'image/jpeg,image/png,image/gif,image/webp' : 'video/mp4,application/octet-stream', 'Accept-Encoding': 'identity' };
      let status: number, location: string | undefined, mime: string, encoding: string, contentLength: number;
      let rawBody: AsyncIterable<Uint8Array>, release: () => void;
      if (proxy) {
        const connecting = new AbortController(), timer = setTimeout(() => connecting.abort(), 25000);
        let response: Response;
        try { response = await withXAbort(proxy.fetch(url.href, { signal: AbortSignal.any([signal, connecting.signal]), credentials: 'omit', redirect: 'manual', headers }), signal); }
        catch (error) { if (connecting.signal.aborted) throw new Error('X 内容服务器响应超时，请稍后重试。'); throw error; }
        finally { clearTimeout(timer); }
        status = response.status; location = response.headers.get('location') || undefined; mime = response.headers.get('content-type') || ''; encoding = response.headers.get('content-encoding') || ''; contentLength = Number(response.headers.get('content-length') || 0);
        release = () => { void response.body?.cancel().catch(() => {}); };
        const responseBody = response.body;
        rawBody = (async function* () {
          if (!responseBody) throw new Error('X 内容服务器没有返回文件内容。');
          const reader = responseBody.getReader();
          try { while (true) { const chunk = await withXAbort(reader.read(), signal); if (chunk.done) break; yield chunk.value; } }
          finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        })();
      } else {
        const selected = addresses.find(item => item.family === 4) || addresses[0];
        const response = await new Promise<IncomingMessage>((resolve, reject) => {
          const request = (options.request || httpsRequest)(url, { signal, headers,
            lookup: ((_host: string, lookupOptions: { all?: boolean }, callback: (...args: unknown[]) => void) => lookupOptions.all ? callback(null, [selected]) : callback(null, selected.address, selected.family)) as never,
          }, response => {
            // A caller may reject by headers before consuming the body. Disposing that stream
            // must not emit an unhandled error; async iteration still receives body errors.
            response.on('error', () => {}); resolve(response);
          });
          request.setTimeout(25000, () => request.destroy(new Error('X 内容服务器响应超时，请稍后重试。'))); request.on('error', reject); request.end();
        });
        status = response.statusCode || 0; location = response.headers.location; mime = String(response.headers['content-type'] || ''); encoding = String(response.headers['content-encoding'] || ''); contentLength = Number(response.headers['content-length'] || 0);
        rawBody = response; release = () => { response.destroy(); };
      }
      if ([301, 302, 303, 307, 308].includes(status) && location) { release(); current = new URL(location, url).href; if (redirects === 5) throw new Error('X 内容地址重定向过多，请稍后重试。'); continue; }
      if (status < 200 || status >= 300) { release(); throw new Error(`X 内容服务器返回 ${status || '未知错误'}，推文可能不可公开访问，请稍后重试。`); }
      mime = mime.split(';')[0].trim().toLowerCase();
      const supported = options.purpose === 'metadata' ? mime === 'application/json' : options.purpose === 'image' ? ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime) : ['video/mp4', 'application/octet-stream', 'binary/octet-stream'].includes(mime);
      if (!supported) { release(); throw new Error('X 内容服务器未返回有效的正文或媒体格式。'); }
      if (encoding && encoding !== 'identity') { release(); throw new Error('X 内容服务返回了不支持的压缩格式，请稍后重试。'); }
      if (!Number.isSafeInteger(contentLength) || contentLength < 0) { release(); throw new Error('X 内容服务返回了无效的文件大小。'); }
      const body = (async function* () {
        try { for await (const chunk of rawBody) { if (signal.aborted) throw abortError(); yield chunk; } }
        catch (error) { translateError(error); }
        finally { release(); }
      })();
      return { body, mime, contentLength, transport: proxy ? 'electron-system-proxy' : 'direct-dns-pinned', dispose: () => { disposed.abort(); release(); } };
    }
    throw new Error('X 内容地址重定向过多。');
  } catch (error) { return translateError(error); }
}
