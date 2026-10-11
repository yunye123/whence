/**
 * What a local picture or film looks like before the canvas renders it (FC-04, FV-M7). Browser-only helpers used by
 * the file import: they never throw, and a file the browser cannot decode simply gets no preview (the card falls
 * back to its placeholder, exactly as before).
 */

/** Default width of an imported picture or film card (createNode). */
export const IMPORTED_CARD_WIDTH = 290;

/** The image card's own clamp (ImageCardBody): ratios outside 1:4–4:1 are covered, not stretched. */
export function imageCardHeight(width: number, height: number, cardWidth = IMPORTED_CARD_WIDTH): number | undefined {
  if (!(width > 0 && height > 0)) return undefined;
  return Math.round(cardWidth / Math.min(4, Math.max(.25, width / height)));
}

/** Natural size of the picture at `url`, EXIF orientation applied (as the card shows it); null when it cannot be decoded. */
export async function readImageSizeAt(url: string): Promise<{ width: number; height: number } | null> {
  if (typeof Image === 'undefined') return null;
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : null;
  } catch { return null; }
}

/** Natural size of a picture file. */
export async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof URL.createObjectURL !== 'function') return null;
  const url = URL.createObjectURL(file);
  try { return await readImageSizeAt(url); } finally { URL.revokeObjectURL(url); }
}

/**
 * Pictures read at rest, before their card is on screen (FC-01): only sources that stay on this machine — stored
 * media (blob:), embedded data, the shipped assets and desktop media. A web picture is fetched only when its card shows.
 */
export function isLocalPictureSource(source: string | undefined): source is string {
  return !!source && (/^(?:blob:|data:image\/|field-media:|media:)/i.test(source) || source.startsWith('/assets/'));
}

function once(target: HTMLMediaElement, event: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeout);
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('media error')); };
    const cleanup = () => { window.clearTimeout(timer); target.removeEventListener(event, done); target.removeEventListener('error', fail); };
    target.addEventListener(event, done, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}

/**
 * Duration and a poster frame of a local film: one frame at 10% of the running time (at most 30 s in, so a black
 * opening is skipped), as a JPEG at most 640 wide. The poster carries the film's own ratio, so a portrait film reads
 * as portrait on the canvas from the start.
 */
export async function readVideoPreview(file: Blob): Promise<{ duration?: number; poster?: string; undecodable?: boolean }> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return {};
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const result: { duration?: number; poster?: string; undecodable?: boolean } = {};
  try {
    const metadata = once(video, 'loadedmetadata', 10_000);
    video.src = url;
    await metadata;
    if (Number.isFinite(video.duration) && video.duration > 0) result.duration = Math.round(video.duration * 100) / 100;
    if (!video.videoWidth || !video.videoHeight) return result;
    const at = result.duration ? Math.min(result.duration * .1, 30) : 0;
    const ready = at > 0 ? once(video, 'seeked', 10_000) : video.readyState >= 2 ? Promise.resolve() : once(video, 'loadeddata', 10_000);
    if (at > 0) video.currentTime = at;
    await ready;
    const scale = Math.min(1, 640 / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return result;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const poster = canvas.toDataURL('image/jpeg', .82);
    if (poster.startsWith('data:image/jpeg;base64,') && poster.length < 2 * 1024 * 1024) result.poster = poster;
    return result;
  } catch (error) {
    // CORE-08: the browser refused the file outright (not a slow read): it cannot be played here either.
    if (result.duration === undefined && error instanceof Error && error.message === 'media error') result.undecodable = true;
    return result;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
