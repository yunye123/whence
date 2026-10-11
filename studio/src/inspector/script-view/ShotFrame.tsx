import { useEffect, useRef, useState } from 'react';
import type { BoardNode } from '../../model';
import { useBoard } from '../../board-context';
import { VideoIcon } from '../../icons/field-icons';
import { directVideoUrl } from '../shared';

/**
 * The picture of one script line (§6.29): the frame at the excerpt's start, taken from the film itself, so the line
 * shows the shot it is tied to. Until that frame is ready (or when the film cannot be read here) the source card's
 * poster stands in; without either, a quiet film placeholder. Frames are drawn once, off screen, in a muted video that
 * never plays (playback still only goes through board.playVideo, K9), and kept for the session.
 */

const FRAME_WIDTH = 480;
const CACHE_LIMIT = 160;
const frames = new Map<string, string | 'live' | 'failed'>();
const waiting = new Map<string, Promise<string | 'live' | 'failed'>>();
const queue: (() => void)[] = [];
let running = 0;

/** A URL a <video> element can read: local blobs, the desktop media protocols, bundled samples, direct files. */
export function playableUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (/^(?:blob:|data:video\/|media:\/\/|field-media:\/\/)/i.test(url)) return url;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return directVideoUrl(url);
}

const frameKey = (url: string, time: number, end?: number) => `${url}#${time}-${end ?? ''}`;

function remember(key: string, value: string | 'live' | 'failed') {
  if (frames.size >= CACHE_LIMIT) frames.delete(frames.keys().next().value!);
  frames.set(key, value);
}

/** Below this mean brightness (0–255) a frame reads as black on the page: a fade from black, a cut on a dark frame. */
const DARK = 12;

/**
 * Where to look for a line's picture: its first frame, then a little further into the excerpt when that frame is
 * (nearly) black — films often open on black, and a thumbnail of nothing reads as broken.
 */
export function frameTimes(start: number, end?: number): number[] {
  const span = end !== undefined && end > start ? end - start : 2;
  const times = [start + 0.04, start + Math.min(1, span * 0.3), start + Math.min(2, span * 0.5)];
  return times.filter((value, index) => index === 0 || value > times[index - 1] + 0.1);
}

/** Mean brightness of the video's current frame from a 16×9 copy; throws when the film is from another origin. */
function brightness(video: HTMLVideoElement): number {
  const probe = document.createElement('canvas');
  probe.width = 16;
  probe.height = 9;
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return 255;
  context.drawImage(video, 0, 0, 16, 9);
  const data = context.getImageData(0, 0, 16, 9).data;
  let sum = 0;
  for (let index = 0; index < data.length; index += 4) sum += data[index] * .2126 + data[index + 1] * .7152 + data[index + 2] * .0722;
  return sum / (data.length / 4);
}

/**
 * The desktop's media protocols grant the app's own origin a CORS read: asked for with crossOrigin, their frames can be
 * copied (black-frame skipping, PDF thumbnails). Where the grant is missing the film is loaded again without it.
 */
const corsCapable = (url: string) => /^(?:media|field-media):\/\//i.test(url);

function drawFrame(url: string, time: number, end?: number, cors = corsCapable(url)): Promise<string | 'live' | 'failed'> {
  if (cors) return drawFrameOnce(url, time, end, true).then(value => value === 'failed' ? drawFrameOnce(url, time, end, false) : value);
  return drawFrameOnce(url, time, end, false);
}

function drawFrameOnce(url: string, time: number, end: number | undefined, cors: boolean): Promise<string | 'live' | 'failed'> {
  return new Promise(resolve => {
    const video = document.createElement('video');
    if (cors) video.crossOrigin = 'anonymous';
    let settled = false;
    const finish = (value: string | 'live' | 'failed') => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(best?.frame ?? 'failed'), 10000);
    const times = frameTimes(time, end);
    let attempt = 0;
    let best: { frame: string; light: number } | undefined;
    const seek = () => {
      const last = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : times[attempt];
      const target = Math.min(Math.max(0, times[attempt]), last);
      if (Math.abs(video.currentTime - target) < 0.01) video.dispatchEvent(new Event('seeked'));
      else video.currentTime = target;
    };
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.addEventListener('error', () => finish(best?.frame ?? 'failed'));
    video.addEventListener('loadeddata', seek, { once: true });
    video.addEventListener('seeked', () => {
      requestAnimationFrame(() => {
        if (settled) return;
        if (!video.videoWidth || !video.videoHeight) { finish(best?.frame ?? 'failed'); return; }
        let light: number;
        let frame: string;
        try {
          light = brightness(video);
          const canvas = document.createElement('canvas');
          canvas.width = FRAME_WIDTH;
          canvas.height = Math.round(FRAME_WIDTH * video.videoHeight / video.videoWidth);
          canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
          frame = canvas.toDataURL('image/webp', 0.82);
        } catch {
          // A film from another origin (the desktop media protocol) cannot be copied: show the paused film itself.
          finish('live');
          return;
        }
        if (!best || light > best.light) best = { frame, light };
        if (light >= DARK || ++attempt >= times.length) { finish(best.frame); return; }
        seek();
      });
    });
    video.src = url;
  });
}

/** The frame of a film at a time, drawn once per session: a data URL, 'live' (another origin), or 'failed'. */
export function frameFor(url: string, time: number, end?: number): Promise<string | 'live' | 'failed'> {
  const key = frameKey(url, time, end);
  const known = frames.get(key);
  if (known) return Promise.resolve(known);
  const pending = waiting.get(key);
  if (pending) return pending;
  const promise = new Promise<string | 'live' | 'failed'>(resolve => {
    const run = () => {
      running++;
      drawFrame(url, time, end).then(value => {
        remember(key, value);
        waiting.delete(key);
        resolve(value);
      }).finally(() => { running--; queue.shift()?.(); });
    };
    // Two films decode at a time: a long script does not start dozens of decoders at once.
    if (running < 2) run(); else queue.push(run);
  });
  waiting.set(key, promise);
  return promise;
}

/**
 * The paused film shown when its frames cannot be copied (another origin): brightness cannot be read there, so an
 * excerpt from the film's very first second, where films usually fade in from black, is shown a little further in.
 */
function liveTime(time: number, end?: number): number {
  const times = frameTimes(time, end);
  return time < 0.5 && times.length > 1 ? times[1] : times[0];
}

export default function ShotFrame({ source, time, end, className }: { source?: BoardNode; time?: number; end?: number; className?: string }) {
  const board = useBoard();
  const url = source ? playableUrl(board.getMediaUrl(source.data.mediaId) || source.data.url) : undefined;
  const key = url && time !== undefined ? frameKey(url, time, end) : '';
  const [frame, setFrame] = useState(() => (key ? frames.get(key) : undefined));
  const [portrait, setPortrait] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const hostRef = useRef<HTMLSpanElement>(null);
  const poster = !posterFailed ? source?.data.poster : undefined;

  // Rows are keyed by place: swapping a shot can reuse this component. A failed poster from
  // the previous source must not hide the next source's poster, nor carry over portrait fit.
  useEffect(() => { setPosterFailed(false); setPortrait(false); }, [url, source?.data.poster]);

  useEffect(() => {
    if (!key || !url || time === undefined) { setFrame(undefined); return; }
    const known = frames.get(key);
    if (known) { setFrame(known); return; }
    setFrame(undefined);
    let cancelled = false;
    const start = () => { void frameFor(url, time, end).then(value => { if (!cancelled) setFrame(value); }); };
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === 'undefined') { start(); return () => { cancelled = true; }; }
    // Only frames that come near the screen are drawn.
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      start();
    }, { rootMargin: '480px 0px' });
    observer.observe(host);
    return () => { cancelled = true; observer.disconnect(); };
  }, [key, url, time, end]);

  const image = typeof frame === 'string' && frame !== 'live' && frame !== 'failed' ? frame : poster;
  const onImage = (element: HTMLImageElement) => setPortrait(element.naturalHeight > element.naturalWidth * 1.05);
  return <span ref={hostRef} className={['draft-shot', portrait ? 'is-portrait' : '', className].filter(Boolean).join(' ')} aria-hidden="true">
    {frame === 'live' && url && time !== undefined
      ? <video className="draft-shot__media" src={url} muted playsInline preload="auto" tabIndex={-1}
        onLoadedMetadata={event => { const video = event.currentTarget; setPortrait(video.videoHeight > video.videoWidth * 1.05); video.currentTime = liveTime(time, end); }} />
      : image
        ? <img className="draft-shot__media" src={image} alt="" draggable={false} decoding="async" onLoad={event => onImage(event.currentTarget)} onError={() => { if (image === poster) setPosterFailed(true); }} />
        : <span className="draft-shot__blank"><VideoIcon size={18} aria-hidden="true" /></span>}
  </span>;
}
