import { visibleFlowRect, visibleScreenRect, type CanvasSize, type FlowViewport, type Rect, type SafeInsets } from './safe-area';
import type { BoardNode } from '../model';
import type { CardMeasurements } from '../card-placement';
import type { CardLod } from '../cards/types';
import { getVisibleCardBounds } from '../app/caption-rules';

/** Main's viewport/selection adapters share the same raw-plus-caption geometry. */
export function visibleCardRects(nodes: readonly BoardNode[], measurements: CardMeasurements = {}, captionIds: ReadonlySet<string> = new Set(), lod: CardLod = 'full'): Rect[] {
  return nodes.map(node => getVisibleCardBounds(node, measurements, captionIds, lod));
}

export function unionVisibleCardBounds(nodes: readonly BoardNode[], measurements: CardMeasurements = {}, captionIds: ReadonlySet<string> = new Set(), lod: CardLod = 'full'): Rect | null {
  return unionRects(visibleCardRects(nodes, measurements, captionIds, lod));
}

/**
 * Viewport following (DESIGN_SYSTEM §5.5). Pure functions; App applies the result with
 * `flow.setViewport(next, { duration: cameraDuration(...), ease: cameraEase })`.
 *
 * - Pan only. The zoom drops only when the target does not fit at the current zoom, and never below
 *   `minZoom` (0.5, the overview tier starts below it). A view that is already below `minZoom` is lifted
 *   to it, so revealing a card never leaves it in the unreadable overview.
 * - A target that is completely inside the safe area (insets already include the 24px gap) does not move.
 * - Otherwise the target centre goes to the centre of the safe area, 10% above the middle. On an axis
 *   where the target is larger than the safe area its start edge (left / top) is aligned instead, so the
 *   header of a tall card or the first card of a large batch stays visible.
 */

export const REVEAL_MIN_ZOOM = .5;
export const CANVAS_MIN_ZOOM = .2;
export const CANVAS_MAX_ZOOM = 2;
const EPSILON = .5;

export interface RevealOptions {
  /** Lower bound for any zoom change made by the reveal (default 0.5). */
  minZoom?: number;
  /** Force this zoom (first open shows the start area at 100%). */
  zoom?: number;
  /** Upward bias of the centred target as a share of the safe-area height (default 0.1). */
  centerBias?: number;
}

export function unionRects(rects: Rect[]): Rect | null {
  const valid = rects.filter(rect => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite));
  if (!valid.length) return null;
  const left = Math.min(...valid.map(rect => rect.x)), top = Math.min(...valid.map(rect => rect.y));
  const right = Math.max(...valid.map(rect => rect.x + rect.width)), bottom = Math.max(...valid.map(rect => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function rectContains(outer: Rect, inner: Rect, epsilon = EPSILON): boolean {
  return inner.x >= outer.x - epsilon && inner.y >= outer.y - epsilon
    && inner.x + inner.width <= outer.x + outer.width + epsilon
    && inner.y + inner.height <= outer.y + outer.height + epsilon;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Whether `target` fits inside the safe area at `zoom`. */
export function fitsAtZoom(target: Rect, zoom: number, size: CanvasSize, insets: SafeInsets): boolean {
  const screen = visibleScreenRect(size, insets);
  return target.width * zoom <= screen.width + EPSILON && target.height * zoom <= screen.height + EPSILON;
}

/** The viewport that reveals `target`, or null when it is already completely visible. */
export function computeRevealViewport(target: Rect, viewport: FlowViewport, size: CanvasSize, insets: SafeInsets, options: RevealOptions = {}): FlowViewport | null {
  const screen = visibleScreenRect(size, insets);
  if (!(screen.width > 0 && screen.height > 0) || ![target.x, target.y, target.width, target.height].every(Number.isFinite)) return null;
  const minZoom = clamp(options.minZoom ?? REVEAL_MIN_ZOOM, CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM);
  let zoom = options.zoom ?? viewport.zoom;
  if (options.zoom === undefined) {
    if (!(zoom > 0)) zoom = 1;
    if (zoom < minZoom) zoom = minZoom;
    const width = Math.max(1, target.width), height = Math.max(1, target.height);
    const fit = Math.min(screen.width / width, screen.height / height);
    if (fit < zoom) zoom = Math.max(minZoom, fit);
  }
  zoom = clamp(zoom, CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM);
  if (Math.abs(zoom - viewport.zoom) < 1e-6 && rectContains(visibleFlowRect(viewport, size, insets), target)) return null;
  const width = target.width * zoom, height = target.height * zoom;
  const left = width <= screen.width + EPSILON ? screen.x + (screen.width - width) / 2 : screen.x;
  let top = screen.y;
  if (height <= screen.height + EPSILON) {
    const centred = screen.y + (screen.height - height) / 2 - (options.centerBias ?? .1) * screen.height;
    top = clamp(centred, screen.y, Math.max(screen.y, screen.y + screen.height - height));
  }
  return { x: left - target.x * zoom, y: top - target.y * zoom, zoom };
}

/** The first open of a board stays in the full card tier (lod.ts: full ≥ 0.86). */
export const START_MIN_ZOOM = .86;
/** A start zoom at or above this is shown at 100%. */
export const START_SNAP = .98;

/**
 * Zoom for the first open of a board (§5.5, W-M3): 100% when the start area fits the safe area; otherwise as low as
 * 86% to show all of it. Shrinking for the height pays off only when it shows the whole start area (its last
 * pixels may use the 24px comfort gap at the bottom, `slack`); when even 86% cannot, only the width decides —
 * shrinking further would cost legibility without making it complete — so no column is cut off at the right edge,
 * and the caller aligns the top to the safe area.
 */
export function startAreaZoom(target: Rect, size: CanvasSize, insets: SafeInsets, minZoom = START_MIN_ZOOM, slack = 24): number {
  const screen = visibleScreenRect(size, insets);
  if (!(screen.width > 0 && screen.height > 0) || ![target.width, target.height].every(Number.isFinite)) return 1;
  const width = Math.max(1, target.width), height = Math.max(1, target.height);
  const fitWidth = screen.width / width, fitHeight = screen.height / height;
  const wholeHeight = (screen.height + Math.max(0, slack)) / height >= minZoom;
  const zoom = clamp(wholeHeight ? Math.min(fitWidth, fitHeight) : fitWidth, minZoom, 1);
  // CORE-37: a hair under 100% (0.9957) resamples every picture and puts cards on fractional pixels while the zoom
  // control still reads 100%: from 98% on take 100% (a few pixels of the bottom gap at most); otherwise whole percents.
  return zoom >= START_SNAP ? 1 : Math.max(minZoom, Math.floor(zoom * 100) / 100);
}

/** Whether the whole start area shows at `minZoom` or above (its last pixels may use the bottom comfort gap). */
export function startAreaFits(target: Rect, size: CanvasSize, insets: SafeInsets, minZoom = START_MIN_ZOOM, slack = 24): boolean {
  const screen = visibleScreenRect(size, insets);
  return target.width * minZoom <= screen.width + EPSILON && target.height * minZoom <= screen.height + Math.max(0, slack) + EPSILON;
}

/**
 * Lowest first-open zoom for a tray of pictures only (CORE-22, round 4). Below 86% cards switch to the simple tier, which
 * changes text cards (body clamped, hover tools off) but not pictures; a tray label keeps its screen size there (§6.16).
 * 60% keeps a picture gallery readable on the plain desk.
 */
export const GALLERY_MIN_ZOOM = .6;

export interface FramedStartOptions {
  minZoom?: number;
  /** The bottom comfort gap the target's last pixels may use (24, as `startAreaZoom`). */
  slack?: number;
  /** Air at the bottom of the target (a tray's padding) that may pass the slack line when only `minZoom` is left. */
  give?: number;
  /** Screen pixels of the top comfort gap the band (a tray label) may use when only `minZoom` is left. */
  headroom?: number;
  /** Extra height above the target at a zoom (a tray label: 30 at 86% and up, its constant screen size below). */
  band?: (zoom: number) => number;
}

/** Zoom and the flow y to put at the top of the safe area. */
export interface FramedStart { zoom: number; top: number }

/**
 * CORE-22 (round 4): how to show `target` (a gallery's first tray) whole on a first open — the largest whole percent up
 * to 100% at which it and its band fit the safe area (100% from 98% on, START_SNAP), never under `minZoom`; at
 * `minZoom` the target's bottom air (`give`) may pass the slack line and the band may use `headroom` of the top gap.
 * Null when it cannot be shown whole even then. Pure.
 */
export function framedStart(target: Rect, size: CanvasSize, insets: SafeInsets, options: FramedStartOptions = {}): FramedStart | null {
  const screen = visibleScreenRect(size, insets);
  if (!(screen.width > 0 && screen.height > 0) || ![target.y, target.width, target.height].every(value => Number.isFinite(value)) || !(target.width > 0 && target.height > 0)) return null;
  const minZoom = clamp(options.minZoom ?? START_MIN_ZOOM, CANVAS_MIN_ZOOM, 1);
  const slack = Math.max(0, options.slack ?? 24), give = Math.max(0, options.give ?? 0);
  const headroom = Math.min(Math.max(0, options.headroom ?? 0), insets.top);
  const band = (zoom: number) => Math.max(0, options.band?.(zoom) ?? 0);
  const fits = (zoom: number, air = 0, room = 0) => target.width * zoom <= screen.width + EPSILON
    && (target.height + band(zoom) - air) * zoom <= screen.height + slack + room + EPSILON;
  const lowest = Math.ceil(minZoom * 100 - 1e-9);
  for (let percent = 100; percent >= lowest; percent--) {
    const zoom = percent / 100;
    if (!fits(zoom)) continue;
    const shown = zoom >= START_SNAP ? 1 : zoom;
    return { zoom: shown, top: target.y - band(shown) };
  }
  const zoom = lowest / 100;
  if (!fits(zoom, give, headroom)) return null;
  // Use only as much of the top gap as the band needs.
  const over = Math.max(0, (target.height + band(zoom) - give) * zoom - screen.height - slack);
  return { zoom, top: target.y - band(zoom) + Math.min(headroom, over) / zoom };
}

export interface StartCompositionOptions {
  minZoom?: number;
  /** The bottom comfort gap a card may use (the safe area's last 24 px above the toolbar). */
  slack?: number;
  /** Floating layers (toolbar, navigator) in canvas-local screen pixels: a card showing beneath one costs a little. */
  overlays?: Rect[];
}

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * First open of a board whose start area does not fit even at 86% (CORE-22: a 1000–1100 px window, or 1366×768 at
 * 125%). Instead of framing one block and cutting whatever falls on the edges, choose the view — a whole-percent zoom
 * between `minZoom` and 100%, a horizontal position, the top of the start area at the top of the safe area — that
 * reads best: every card wholly in the safe area counts (the finished work, `focus`, a little more), a card cut at the
 * left, right or top edge costs a whole card, a card that only continues below the bottom edge costs less the more of
 * it shows, and a sliver of under a fifth of a card costs nearly a whole one; a card showing only in the margins or
 * beneath the toolbar costs a little; a larger zoom wins ties. Pure; returns a whole-pixel viewport.
 */
export function composeStartViewport(cards: Rect[], focus: readonly number[], size: CanvasSize, insets: SafeInsets, options: StartCompositionOptions = {}): FlowViewport | null {
  const screen = visibleScreenRect(size, insets);
  const valid = cards.filter(rect => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite));
  const whole = unionRects(valid);
  if (!whole || !(screen.width > 0 && screen.height > 0)) return null;
  const minZoom = clamp(options.minZoom ?? START_MIN_ZOOM, CANVAS_MIN_ZOOM, 1);
  const slack = Math.max(0, options.slack ?? 24);
  const focused = new Set(focus.filter(index => index >= 0 && index < cards.length));
  const focusRect = unionRects([...focused].map(index => cards[index])) ?? whole;
  const overlays = options.overlays ?? [];
  let best: { viewport: FlowViewport; score: number; offset: number } | null = null;
  for (let percent = 100; percent >= Math.ceil(minZoom * 100 - 1e-9); percent--) {
    const zoom = percent / 100;
    const width = screen.width / zoom, height = (screen.height + slack) / zoom;
    const top = whole.y;
    const centred = whole.x - (width - whole.width) / 2;
    let lefts: number[];
    if (whole.width <= width + EPSILON) lefts = [centred];
    else {
      const low = whole.x, high = whole.x + whole.width - width;
      const raw = [focusRect.x - (width - focusRect.width) / 2, low, high];
      for (const card of valid) raw.push(card.x, card.x + card.width - width, card.x + card.width + 1, card.x - width - 1);
      lefts = [...new Set(raw.map(value => Math.round(clamp(value, Math.min(low, high), Math.max(low, high)))))];
    }
    for (const left of lefts) {
      const view = { x: left, y: top, width, height };
      const x = Math.round(screen.x - left * zoom), y = Math.round(screen.y - top * zoom);
      const canvas = { x: -x / zoom, y: -y / zoom, width: size.width / zoom, height: size.height / zoom };
      let score = 2 * (zoom - minZoom);
      valid.forEach((card, index) => {
        const onScreen = { x: x + card.x * zoom, y: y + card.y * zoom, width: card.width * zoom, height: card.height * zoom };
        const underOverlay = overlays.some(rect => intersects(rect, onScreen));
        if (rectContains(view, card)) { score += focused.has(index) ? 1.5 : 1; if (underOverlay) score -= .2; return; }
        if (!intersects(canvas, card)) return;
        if (!intersects(view, card)) { score -= underOverlay ? .3 : .15; return; }
        const cutSide = card.x < view.x - EPSILON || card.x + card.width > view.x + view.width + EPSILON || card.y < view.y - EPSILON;
        if (cutSide) { score -= focused.has(index) ? 1.5 : 1; return; }
        const shown = (view.y + view.height - card.y) / Math.max(1, card.height);
        score -= (shown < .2 ? .9 : .25 + .5 * (1 - shown)) + (underOverlay ? .2 : 0);
      });
      const offset = Math.abs(left - (whole.width <= width ? centred : focusRect.x - (width - focusRect.width) / 2));
      if (!best || score > best.score + 1e-6 || (Math.abs(score - best.score) <= 1e-6 && offset < best.offset)) best = { viewport: { x, y, zoom }, score, offset };
    }
  }
  return best?.viewport ?? null;
}

/** "查看全部": fit `target` inside the safe area, centred, between `minZoom` and `maxZoom` (default 0.2–1). */
export function fitViewportToRect(target: Rect, size: CanvasSize, insets: SafeInsets, options: { minZoom?: number; maxZoom?: number } = {}): FlowViewport | null {
  const screen = visibleScreenRect(size, insets);
  if (!(screen.width > 0 && screen.height > 0) || ![target.x, target.y, target.width, target.height].every(Number.isFinite)) return null;
  const zoom = clamp(Math.min(screen.width / Math.max(1, target.width), screen.height / Math.max(1, target.height)), options.minZoom ?? CANVAS_MIN_ZOOM, options.maxZoom ?? 1);
  return {
    x: screen.x + (screen.width - target.width * zoom) / 2 - target.x * zoom,
    y: screen.y + (screen.height - target.height * zoom) / 2 - target.y * zoom,
    zoom,
  };
}

function readDuration(name: string, fallback: number): number {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;
  return raw.endsWith('ms') ? value : raw.endsWith('s') ? value * 1000 : value;
}

/**
 * Camera move length: `--dur-camera` (320ms), 480ms when the move is longer than 1.5 canvas widths.
 * Reduced motion returns 0 (jump). `reduced` is injectable for tests.
 */
export function cameraDuration(from: FlowViewport, to: FlowViewport, size: CanvasSize, reduced = prefersReducedMotion()): number {
  if (reduced) return 0;
  const base = readDuration('--dur-camera', 320);
  if (base <= 0) return 0;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return distance > 1.5 * Math.max(1, size.width) ? Math.max(base, 480) : base;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** `--ease-in-out`: cubic-bezier(.65, 0, .35, 1). */
export const cameraEase = cubicBezier(.65, 0, .35, 1);

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const sample = (a: number, b: number, t: number) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
  const slope = (a: number, b: number, t: number) => 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
  return (progress: number) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let t = progress;
    for (let index = 0; index < 8; index++) {
      const error = sample(x1, x2, t) - progress;
      if (Math.abs(error) < 1e-6) break;
      const derivative = slope(x1, x2, t);
      if (Math.abs(derivative) < 1e-6) break;
      t -= error / derivative;
    }
    if (t < 0 || t > 1 || Math.abs(sample(x1, x2, t) - progress) > 1e-4) {
      let low = 0, high = 1; t = progress;
      for (let index = 0; index < 30; index++) {
        const value = sample(x1, x2, t);
        if (Math.abs(value - progress) < 1e-6) break;
        if (value < progress) low = t; else high = t;
        t = (low + high) / 2;
      }
    }
    return sample(y1, y2, t);
  };
}
