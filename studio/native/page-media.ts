/**
 * Public media choice for Douyin and Xiaohongshu.
 * The page already asked for this data. We keep the same selection as the local
 * download plugin: one H.264 play address when a video exists, otherwise every image.
 * No account cookies are read or stored.
 */

export interface CapturedGear { h265?: boolean; h?: number; w?: number; size?: number; urls?: string[] }
export interface CapturedDouyin {
  id?: string;
  desc?: string;
  author?: string;
  duration?: number;
  gears?: CapturedGear[];
  images?: { urls?: string[] }[];
}
export interface CapturedXhsStream { url?: string; backups?: string[] }
export interface CapturedXhs {
  id?: string;
  type?: string;
  title?: string;
  desc?: string;
  author?: string;
  streams?: CapturedXhsStream[];
  images?: { url?: string }[];
}
export interface ChosenMedia {
  kind: 'video' | 'images';
  title: string;
  author?: string;
  description?: string;
  contentId: string;
  durationSeconds?: number;
  mediaUrl?: string;
  images?: { url: string }[];
}

const HOSTS: Record<string, string[]> = {
  '抖音': ['douyinvod.com', 'douyin.com', 'douyinpic.com', 'byteimg.com', 'ibyteimg.com'],
  '小红书': ['xhscdn.com', 'xiaohongshu.com'],
};
const domainIs = (host: string, domain: string) => host === domain || host.endsWith('.' + domain);

/** A public CDN address the page itself exposed. Private hosts and odd ports are dropped. */
export function publicMediaUrl(platform: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 8000) return undefined;
  const hosts = HOSTS[platform];
  if (!hosts) return undefined;
  let url: URL;
  try { url = new URL(value.trim().replace(/^http:\/\//i, 'https://')); } catch { return undefined; }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return undefined;
  if (!hosts.some(domain => domainIs(url.hostname, domain))) return undefined;
  return url.href;
}

function allowed(platform: string, urls: unknown): string[] {
  const found: string[] = [];
  for (const value of Array.isArray(urls) ? urls : []) {
    const next = publicMediaUrl(platform, value);
    if (next && !found.includes(next)) found.push(next);
  }
  return found;
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, limit) : '';
}

function seconds(duration: unknown): number | undefined {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return undefined;
  return duration >= 1000 ? duration / 1000 : duration;
}

/** Highest picture first. At the same height, H.264 comes before H.265. */
function bestGear(gears: CapturedGear[] | undefined): CapturedGear | undefined {
  const sorted = [...(gears || [])].filter(gear => allowed('抖音', gear.urls).length).sort((a, b) =>
    (b.h || 0) - (a.h || 0) || (a.h265 ? 1 : 0) - (b.h265 ? 1 : 0) || (b.size || 0) - (a.size || 0));
  const seen = new Set<string>();
  return sorted.find(gear => {
    const key = `${gear.h || 0}-${gear.h265 ? 1 : 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function chooseDouyin(item: CapturedDouyin | null | undefined, contentId: string): ChosenMedia | undefined {
  if (!item || String(item.id || '') !== contentId) return undefined;
  const title = text(item.desc, 500) || '抖音';
  const author = text(item.author, 500);
  const gear = bestGear(item.gears);
  const videoUrls = allowed('抖音', gear?.urls);
  if (videoUrls.length) {
    return { kind: 'video', title, ...(author ? { author } : {}), contentId, ...(seconds(item.duration) ? { durationSeconds: seconds(item.duration) } : {}), mediaUrl: videoUrls[0] };
  }
  const images = (item.images || []).map(image => allowed('抖音', image.urls)[0]).filter((url): url is string => !!url);
  if (!images.length) return undefined;
  return { kind: 'images', title, ...(author ? { author } : {}), description: text(item.desc, 20_000) || undefined, contentId, images: images.map(url => ({ url })) };
}

export function chooseXhs(note: CapturedXhs | null | undefined, contentId: string): ChosenMedia | undefined {
  if (!note || String(note.id || '') !== contentId) return undefined;
  const title = text(note.title, 500) || text(note.desc, 500) || '小红书笔记';
  const author = text(note.author, 500);
  const description = text(note.desc, 20_000);
  const caption = description && description !== title ? description : undefined;
  if (note.type === 'video') {
    for (const stream of note.streams || []) {
      const urls = allowed('小红书', [stream.url, ...(stream.backups || [])]);
      if (urls.length) return { kind: 'video', title, ...(author ? { author } : {}), ...(caption ? { description: caption } : {}), contentId, mediaUrl: urls[0] };
    }
  }
  const images = (note.images || []).map(image => publicMediaUrl('小红书', image.url)).filter((url): url is string => !!url);
  if (!images.length) return undefined;
  return { kind: 'images', title, ...(author ? { author } : {}), ...(caption ? { description: caption } : {}), contentId, images: images.map(url => ({ url })) };
}

export function choosePageMedia(platform: string, contentId: string | undefined, douyin: CapturedDouyin | null | undefined, xhs: CapturedXhs | null | undefined): ChosenMedia | undefined {
  if (!contentId) return undefined;
  if (platform === '抖音') return chooseDouyin(douyin, contentId);
  if (platform === '小红书') return chooseXhs(xhs, contentId);
  return undefined;
}

/** The note loaded, but it has neither a playable video nor a picture we can save. */
export function emptyPageMedia(platform: string, contentId: string | undefined, douyin: CapturedDouyin | null | undefined, xhs: CapturedXhs | null | undefined): boolean {
  if (!contentId) return false;
  if (platform === '抖音') return !!douyin && String(douyin.id || '') === contentId && !chooseDouyin(douyin, contentId);
  if (platform === '小红书') return !!xhs && String(xhs.id || '') === contentId && !chooseXhs(xhs, contentId);
  return false;
}

/** Drop map-decoration noise, then join wrapped lines into paragraphs. */
export function tidyImageText(value: string): string {
  const lines = value.split(/\n/).map(line => line.trim()).filter(line => line && (line.length > 4 || /[\u4e00-\u9fff]/.test(line)));
  const blocks: string[] = [];
  let current = '';
  const heading = /^(?:[一二三四五六七八九十]+、|理想[:：]|代表作|诗作代表|路线[:：]|课内代表作|\d+[.、])/;
  const openWrap = /[，、：；。！？—\-（(《]$/;
  for (const line of lines) {
    if (current && heading.test(line)) { blocks.push(current); current = line; continue; }
    if (current && current.length <= 24 && !openWrap.test(current) && line.length > 8 && !heading.test(line)) {
      blocks.push(current);
      current = line;
      if (/[。！？]$/.test(line)) { blocks.push(current); current = ''; }
      continue;
    }
    current += line;
    if (/[。！？]$/.test(line)) { blocks.push(current); current = ''; }
  }
  if (current) blocks.push(current);
  return blocks.join('\n\n').slice(0, 20_000);
}
export function imageNoteText(input: { author?: string; description?: string; pages: string[] }): string {
  const parts: string[] = [];
  const author = text(input.author, 500);
  const description = text(input.description, 20_000);
  if (author) parts.push(author);
  if (description) parts.push(description);
  if (input.pages.length) {
    const pages = input.pages.map((page, index) => `【${index + 1}】\n${text(page, 20_000) || '这一张没有识别到文字。'}`);
    parts.push(['图片上的文字', ...pages].join('\n\n'));
  }
  return parts.join('\n\n').slice(0, 300_000);
}

/** Runs in the page before its own scripts, and keeps only the fields we download. */
export const douyinBootstrap = `(() => {
  if (window.__fieldDouyinHook) return;
  window.__fieldDouyinHook = true;
  const cap = {};
  const interesting = /\\/aweme\\/v\\d\\/web\\/(aweme\\/detail|aweme\\/post|module\\/feed|tab\\/feed)/;
  const trim = (it) => {
    const video = it.video || {};
    const gears = [];
    for (const item of video.bit_rate || []) {
      const play = item.play_addr || {};
      if (!play.url_list || !play.url_list.length) continue;
      gears.push({ h265: !!item.is_h265, h: play.height, w: play.width, size: play.data_size, urls: play.url_list.slice(0, 4) });
    }
    if (!gears.length && video.play_addr && video.play_addr.url_list && video.play_addr.url_list.length) {
      gears.push({ h265: false, h: video.play_addr.height, w: video.play_addr.width, size: video.play_addr.data_size, urls: video.play_addr.url_list.slice(0, 4) });
    }
    const images = (it.images || []).map(image => ({ urls: (image.url_list || []).slice(0, 4) })).filter(image => image.urls.length);
    return { id: String(it.aweme_id), desc: it.item_title || it.desc || '', author: (it.author && it.author.nickname) || '', duration: it.duration || 0, gears, images };
  };
  const remember = (item) => {
    if (!item || !item.aweme_id || (!item.video && !(item.images && item.images.length))) return;
    cap[String(item.aweme_id)] = trim(item);
  };
  const harvest = (json) => {
    if (!json || typeof json !== 'object') return;
    if (json.aweme_detail) remember(json.aweme_detail);
    for (const key of ['aweme_list', 'data']) {
      const list = json[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) remember(item && (item.aweme_info || item.aweme || item));
    }
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__fieldUrl = url; return originalOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    if (interesting.test(String(this.__fieldUrl))) this.addEventListener('load', () => { try { harvest(JSON.parse(this.responseText)); } catch (e) {} });
    return originalSend.apply(this, arguments);
  };
  const originalFetch = window.fetch;
  window.fetch = function (input) {
    const response = originalFetch.apply(this, arguments);
    try {
      const address = typeof input === 'string' ? input : input && input.url;
      if (interesting.test(String(address))) response.then(value => value.clone().json().then(harvest).catch(() => {})).catch(() => {});
    } catch (e) {}
    return response;
  };
  window.__fieldDouyin = cap;
})();`;

/** Read from inside the loaded page. Douyin comes from the hook; Xiaohongshu is already on the page. */
export const pageCaptureScript = `
  const unwrap = (value) => value && typeof value === 'object' && ('_rawValue' in value || '_value' in value) ? (value._rawValue || value._value) : value;
  const pageId = (location.pathname.match(/\\/(?:video|note|explore|discovery\\/item|search_result)\\/([\\w-]+)/) || [])[1] || new URL(location.href).searchParams.get('modal_id') || '';
  const readXhs = (id) => {
    const state = window.__INITIAL_STATE__;
    if (!state || !id) return null;
    const map = unwrap(state.note && state.note.noteDetailMap) || {};
    const entry = unwrap(map[id]);
    if (!entry) return null;
    const note = unwrap(entry.note) || entry;
    if (!note || !note.noteId) return null;
    const streams = [];
    const stream = note.video && note.video.media && note.video.media.stream;
    if (stream) {
      for (const key of Object.keys(stream)) {
        for (const item of stream[key] || []) {
          if (!item || !item.masterUrl) continue;
          streams.push({ url: item.masterUrl, backups: item.backupUrls || [] });
        }
      }
    }
    const images = [];
    for (const image of note.imageList || []) {
      if (!image) continue;
      const preferred = (image.infoList || []).find(item => item && item.imageScene === 'WB_DFT');
      const address = (preferred && preferred.url) || image.urlDefault || image.url;
      if (address) images.push({ url: address });
    }
    return { id: String(note.noteId), type: note.type || '', title: note.title || '', desc: note.desc || '', author: (note.user && note.user.nickname) || '', streams, images };
  };
  const douyin = (window.__fieldDouyin && window.__fieldDouyin[pageId]) || null;
  const xhs = readXhs(pageId);
`;
