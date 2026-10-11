import { useCallback, useRef } from 'react';

/**
 * Visible-canvas safe area (DESIGN_SYSTEM §5.2, root cause R1).
 *
 * Floating HUD layers that sit on top of the canvas (popped minimap, banners) register
 * themselves here and carry `data-canvas-overlay="<edge>"` in the DOM. Every viewport and placement
 * calculation (fit, center, reveal, open card, new-card placement) asks this module where the canvas is
 * actually visible instead of querying class names.
 *
 * Inset of one edge = deepest intrusion of the overlays registered on that edge + `--safe-gap` (24px).
 * Overlays that follow the selection (selection tools), short-lived toasts and modal menus are not
 * registered. The docked inspector takes layout width; the rail takes layout height. Both are already excluded
 * from the measured .flow-container rectangle. Neither is registered or subtracted again.
 *
 * Rects are measured on demand with getBoundingClientRect (a handful of elements, read-only), which is
 * always current even while an overlay moves without resizing.
 */

export type OverlayEdge = 'top' | 'right' | 'bottom' | 'left';
export interface SafeInsets { top: number; right: number; bottom: number; left: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface FlowViewport { x: number; y: number; zoom: number }
export interface CanvasSize { width: number; height: number }
export interface CanvasMetrics extends CanvasSize { insets: SafeInsets }

export const DEFAULT_SAFE_GAP = 24;
/** The visible area never shrinks below this share of the canvas, even when overlays crowd a tiny window. */
const MIN_VISIBLE_SHARE = .25;

const overlays = new Map<HTMLElement, OverlayEdge>();
let canvasContainer: HTMLElement | null = null;

/** The element the overlays are measured against (`.flow-container`). App registers it through a ref. */
export function registerCanvasContainer(element: HTMLElement | null): void { canvasContainer = element; }

function currentContainer(): HTMLElement | null {
  if (canvasContainer?.isConnected) return canvasContainer;
  return typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.flow-container');
}

/** Register a floating layer that covers part of the canvas. Returns the unregister function. */
export function registerCanvasOverlay(element: HTMLElement, edge: OverlayEdge): () => void {
  overlays.set(element, edge);
  if (element.dataset.canvasOverlay !== edge) element.dataset.canvasOverlay = edge;
  return () => { if (overlays.get(element) === edge) overlays.delete(element); };
}

/** Ref callback for React components: registers on mount, unregisters on unmount or edge change. */
export function useCanvasOverlay<T extends HTMLElement = HTMLElement>(edge: OverlayEdge): (element: T | null) => void {
  const release = useRef<(() => void) | null>(null);
  return useCallback((element: T | null) => {
    release.current?.();
    release.current = element ? registerCanvasOverlay(element, edge) : null;
  }, [edge]);
}

/** Number of registered overlays (diagnostics and tests). */
export function registeredCanvasOverlayCount(): number { return overlays.size; }

function toRect(box: { left: number; top: number; width: number; height: number }): Rect {
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

/** Pure: insets of the canvas `area` covered by `items` (all in the same screen coordinates). */
export function computeSafeInsets(area: Rect, items: { edge: OverlayEdge; rect: Rect }[], gap = DEFAULT_SAFE_GAP): SafeInsets {
  const depth: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  const right = area.x + area.width, bottom = area.y + area.height;
  for (const { edge, rect } of items) {
    if (!(rect.width > 0 && rect.height > 0)) continue;
    const overlapX = Math.min(right, rect.x + rect.width) - Math.max(area.x, rect.x);
    const overlapY = Math.min(bottom, rect.y + rect.height) - Math.max(area.y, rect.y);
    if (overlapX <= 0 || overlapY <= 0) continue; // Outside the canvas: covers nothing.
    const intrusion = edge === 'top' ? rect.y + rect.height - area.y
      : edge === 'bottom' ? bottom - rect.y
        : edge === 'left' ? rect.x + rect.width - area.x
          : right - rect.x;
    const limit = edge === 'top' || edge === 'bottom' ? area.height : area.width;
    depth[edge] = Math.max(depth[edge], Math.min(limit, Math.max(0, intrusion)));
  }
  const safeGap = Number.isFinite(gap) && gap >= 0 ? gap : DEFAULT_SAFE_GAP;
  return { top: depth.top + safeGap, right: depth.right + safeGap, bottom: depth.bottom + safeGap, left: depth.left + safeGap };
}

/** Pure: the safe area inside a canvas of `size`, in canvas-local screen pixels. */
export function visibleScreenRect(size: CanvasSize, insets: SafeInsets): Rect {
  const width = Math.max(0, size.width), height = Math.max(0, size.height);
  let { left, right, top, bottom } = insets;
  const maxX = width * (1 - MIN_VISIBLE_SHARE), maxY = height * (1 - MIN_VISIBLE_SHARE);
  if (left + right > maxX && left + right > 0) { const scale = maxX / (left + right); left *= scale; right *= scale; }
  if (top + bottom > maxY && top + bottom > 0) { const scale = maxY / (top + bottom); top *= scale; bottom *= scale; }
  return { x: left, y: top, width: Math.max(0, width - left - right), height: Math.max(0, height - top - bottom) };
}

/** Pure: the safe area expressed in flow coordinates for a React Flow viewport. */
export function visibleFlowRect(viewport: FlowViewport, size: CanvasSize, insets: SafeInsets): Rect {
  const screen = visibleScreenRect(size, insets);
  const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
  return { x: (screen.x - viewport.x) / zoom, y: (screen.y - viewport.y) / zoom, width: screen.width / zoom, height: screen.height / zoom };
}

function readSafeGap(element: Element): number {
  if (typeof getComputedStyle !== 'function') return DEFAULT_SAFE_GAP;
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue('--safe-gap'));
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SAFE_GAP;
}

function isRendered(element: HTMLElement): boolean {
  if (!element.isConnected || !element.getClientRects().length) return false;
  return typeof getComputedStyle !== 'function' || getComputedStyle(element).visibility !== 'hidden';
}

/** Current insets of the canvas container, measured now. */
export function getCanvasSafeInsets(): SafeInsets {
  const container = currentContainer();
  if (!container) return { top: DEFAULT_SAFE_GAP, right: DEFAULT_SAFE_GAP, bottom: DEFAULT_SAFE_GAP, left: DEFAULT_SAFE_GAP };
  const area = toRect(container.getBoundingClientRect());
  const items = [...overlays].filter(([element]) => isRendered(element)).map(([element, edge]) => ({ edge, rect: toRect(element.getBoundingClientRect()) }));
  return computeSafeInsets(area, items, readSafeGap(container));
}

/** Container size plus insets; null when the canvas is not laid out (hidden, zero-size, not mounted). */
export function getCanvasMetrics(): CanvasMetrics | null {
  const container = currentContainer();
  if (!container) return null;
  const box = container.getBoundingClientRect();
  if (!(box.width > 0 && box.height > 0)) return null;
  return { width: box.width, height: box.height, insets: getCanvasSafeInsets() };
}

/** The visible, unobstructed part of the canvas in flow coordinates. */
export function getVisibleFlowRect(viewport: FlowViewport): Rect {
  const metrics = getCanvasMetrics();
  const size = metrics ?? { width: typeof window === 'undefined' ? 0 : window.innerWidth, height: typeof window === 'undefined' ? 0 : window.innerHeight };
  return visibleFlowRect(viewport, size, metrics?.insets ?? { top: DEFAULT_SAFE_GAP, right: DEFAULT_SAFE_GAP, bottom: DEFAULT_SAFE_GAP, left: DEFAULT_SAFE_GAP });
}

/** The registered floating layers (popped minimap, banners) as rects in canvas-local screen pixels (CORE-22 composition). */
export function getCanvasOverlayRects(): Rect[] {
  const container = currentContainer();
  if (!container) return [];
  const area = container.getBoundingClientRect();
  return [...overlays.keys()].filter(isRendered).map(element => {
    const box = element.getBoundingClientRect();
    return { x: box.left - area.left, y: box.top - area.top, width: box.width, height: box.height };
  }).filter(rect => rect.width > 0 && rect.height > 0);
}
