/** Browser-safe X import contract. Native networking lives in native/x-import.ts. */
export interface XLink { id: string; url: string; key: string }
export interface XMedia {
  kind: 'image' | 'video' | 'gif';
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  /** Seconds, as supplied by the provider. */
  duration?: number;
  altText?: string;
}
export interface XPost {
  id: string;
  url: string;
  title: string;
  author: { name: string; handle: string; url: string };
  text: string;
  publishedAt?: string;
  provider: 'fxtwitter' | 'x-syndication';
  contentKind: 'post' | 'long-post' | 'article';
  completeness: 'complete' | 'partial';
  warnings: string[];
  media: XMedia[];
}
export interface XImportResult {
  post: XPost;
  images: { source: XMedia; name: string; mime?: string; data?: Uint8Array; error?: string }[];
}
export interface XImportRequest {
  url: string;
  requestId: string;
  /** Resolve source text and media metadata without downloading image originals. */
  sourceOnly?: boolean;
}
const hosts = new Set(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
const articleMessage = '文章 ID 与推文 ID 不同。请打开这篇 X 文章，复制发布文章的推文链接后导入。';

function parseXUrl(value: string): XLink | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (!hosts.has(url.hostname.toLowerCase())) return undefined;
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && url.port !== '443' && url.port !== '80')) throw new Error('请使用公开的 X 推文链接。');
  if (/^\/i\/article\/\d+\/?$/.test(url.pathname)) throw new Error(articleMessage);
  const match = url.pathname.match(/^\/(?:([A-Za-z0-9_]{1,50})\/status|i\/web\/status)\/(\d{1,25})(?:\/(?:photo|video)\/\d+)?\/?$/);
  if (!match) return undefined;
  const id = match[2];
  return { id, url: `https://x.com/${match[1] || 'i/web'}/status/${id}`, key: `X:${id}` };
}

/** Extract and deduplicate public status links; tracking and media suffixes are removed. */
export function extractXLinks(input: string): XLink[] {
  if (typeof input !== 'string' || input.length > 12000 || input.includes('\0')) throw new Error('分享内容过长，请只粘贴 X 推文链接。');
  const links = new Map<string, XLink>();
  for (const match of input.matchAll(/https?:\/\/[^\s<>"'，。；！？）)【】]+/gi)) {
    const link = parseXUrl(match[0].replace(/[.,;!?)\]}]+$/, ''));
    if (link) links.set(link.id, link);
  }
  return [...links.values()];
}

/** A single status identity is required. Different posts are never silently merged. */
export function normalizeXLink(input: string): XLink {
  const links = extractXLinks(input);
  if (links.length > 1) throw new Error('检测到多条不同的 X 推文链接，请每次导入一条。');
  if (!links.length) throw new Error('请粘贴具体的 X 推文链接，例如 https://x.com/用户名/status/推文ID。');
  return links[0];
}
