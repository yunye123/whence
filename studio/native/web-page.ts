import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isPublicAddress } from './download';

const MAX_HTML = 2 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 15_000;

/** Public http(s) only. Private and credentialled URLs fail before any connection. */
export function assertPublicPageUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('链接格式不正确，无法抓取正文。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !isPublicAddress(url.hostname)) {
    throw new Error('这个地址不在公开网络上，无法抓取正文。');
  }
  return url;
}

/**
 * Fetch one public HTML page. Same public-address and DNS check as video download, at most 5 redirects,
 * HTML only, 2 MiB, about 15 seconds, no cookies and no hidden window. Anything else is "no page".
 */
export async function fetchWebPage(value: string, redirects = 0): Promise<{ html: string; url: string } | null> {
  if (redirects > 5) throw new Error('网页重定向次数过多，只保存链接。');
  const url = assertPublicPageUrl(value);
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('这个地址不在公开网络上，无法抓取正文。');
  const selected = addresses.find(item => item.family === 4) || addresses[0];
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 FIELD/0.1', Accept: 'text/html,application/xhtml+xml;q=0.9' },
      lookup: ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
        if (options.all) callback(null, [selected]);
        else callback(null, selected.address, selected.family);
      }) as never,
    }, resolve);
    request.setTimeout(PAGE_TIMEOUT_MS, () => request.destroy(new Error('网页响应超时，只保存链接。')));
    request.on('error', reject);
    request.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
    const next = new URL(response.headers.location, url).href;
    response.destroy();
    return fetchWebPage(next, redirects + 1);
  }
  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    response.destroy();
    return null;
  }
  const type = String(response.headers['content-type'] ?? '');
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
    response.destroy();
    return null;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_HTML) {
      response.destroy();
      return null;
    }
    chunks.push(buffer);
  }
  const html = Buffer.concat(chunks).toString('utf8').trim();
  return html ? { html, url: url.href } : null;
}
