/**
 * A film's own ratio for its card (§6.9: the poster bleeds to the card edges at the film's ratio).
 *
 * A local film without a poster used to learn its ratio only when it played inside the card, so a portrait
 * film's card jumped from 16:9 to its real height mid-play, covered the card below and kept that height until
 * a reload put it back (FV-M1). The card now reads the ratio at rest: a detached `<video preload="metadata">`
 * probe that never enters the page, then a session cache keyed by the media, so remounts (cards off screen are
 * not rendered) and duplicates start at the right height.
 */

/** Ratios a card can take (portrait 9:16 up to 21:9). */
export const clampVideoRatio = (ratio: number) => Math.min(21 / 9, Math.max(9 / 16, ratio));

const known = new Map<string, number>();
const pending = new Map<string, Promise<number | undefined>>();
const waiting: Array<() => void> = [];
let running = 0;
/** Metadata reads in flight at once (a board opened with many films reads them a few at a time). */
const PROBE_LIMIT = 2;
const PROBE_TIMEOUT_MS = 15_000;

export function knownMediaRatio(key: string | undefined): number | undefined {
  return key ? known.get(key) : undefined;
}

export function rememberMediaRatio(key: string | undefined, ratio: number): number | undefined {
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined;
  const value = clampVideoRatio(ratio);
  if (key) known.set(key, value);
  return value;
}

/** Only sources that stay on this machine are probed at rest: local media, field-media and the shipped samples. */
export function isLocalVideoSource(source: string | undefined): boolean {
  if (!source) return false;
  return /^(?:blob:|field-media:|media:)/i.test(source) || source.startsWith('/assets/samples/');
}

function readRatio(source: string): Promise<number | undefined> {
  return new Promise(resolve => {
    const video = document.createElement('video');
    let settled = false;
    const finish = (ratio?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      resolve(ratio);
    };
    const timer = setTimeout(() => finish(undefined), PROBE_TIMEOUT_MS);
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => finish(video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : undefined);
    video.onerror = () => finish(undefined);
    video.src = source;
  });
}

function schedule(source: string): Promise<number | undefined> {
  return new Promise(resolve => {
    const start = () => {
      running++;
      readRatio(source).then(resolve, () => resolve(undefined)).finally(() => {
        running--;
        waiting.shift()?.();
      });
    };
    if (running < PROBE_LIMIT) start(); else waiting.push(start);
  });
}

/** The film's clamped ratio (cached per media key; one read per key at a time), or undefined when it cannot be read. */
export function probeVideoRatio(key: string, source: string): Promise<number | undefined> {
  const cached = known.get(key);
  if (cached) return Promise.resolve(cached);
  let task = pending.get(key);
  if (!task) {
    task = schedule(source).then(ratio => (ratio ? rememberMediaRatio(key, ratio) : undefined));
    pending.set(key, task);
    void task.finally(() => pending.delete(key));
  }
  return task;
}
