import { createElement, useCallback, useEffect, useLayoutEffect, useState, type ReactElement } from 'react';
import { useStore, useStoreApi, type ReactFlowState } from '@xyflow/react';
import { SelectionBounds } from '../cards/SelectionBounds';

/**
 * Level of detail (DESIGN_SYSTEM §6.16, §0 rules 3–4, K9-7).
 *
 * - Three tiers by zoom (C16): full ≥ 0.86, simple 0.5–0.86, far (overview) < 0.5. Cards and edges subscribe
 *   to the tier enum only, never to the continuous viewport.
 * - Two CSS variables on the `.react-flow` root, written by one store subscription (not by React):
 *   `--z` = zoom, for stroke-like paint only (selection ring, focus outline, thread knots), rewritten when the
 *   zoom changes; `--z-tier` = floor(zoom × 20) / 20, the only input of font and silhouette compensation,
 *   written when the tier enum changes and when the viewport settles (React Flow's move end), never per frame.
 * - While the viewport moves, `.flow-container` carries `.is-moving` (ambient paper shadows and the tier
 *   cross-fade pause); it is removed `MOVE_SETTLE_MS` after the last change, the same delay React Flow uses
 *   to end a wheel gesture.
 * - `.react-flow[data-lod]` mirrors the tier for canvas-wide rules; `[data-grid-off]` below 0.6 fades the
 *   24px dot grid (the overview never draws it).
 *
 * Until App mounts `<CanvasLod />` (docs/redesign/integration/lod.md) the first mounted card attaches the
 * writer through `useCanvasLod`; attaching is idempotent per React Flow store.
 */

export type CanvasLod = 'full' | 'simple' | 'far';

export const LOD_FULL_MIN = .86;
export const LOD_SIMPLE_MIN = .5;
/** Below this zoom the dot grid fades out (simple tier, §6.16). */
export const GRID_FADE_BELOW = .6;
/** A viewport unchanged for this long has stopped moving. */
export const MOVE_SETTLE_MS = 160;

export function lodForZoom(zoom: number): CanvasLod {
  return zoom >= LOD_FULL_MIN ? 'full' : zoom >= LOD_SIMPLE_MIN ? 'simple' : 'far';
}

/** `--z-tier`: zoom rounded **down** to 0.05 (§0 rule 4), so compensated text is never below its nominal screen size. */
export function zoomTier(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.max(.05, Math.floor(zoom * 20 + 1e-6) / 20);
}

export const selectLod = (state: ReactFlowState): CanvasLod => lodForZoom(state.transform[2]);

/** `--z` keeps four decimals: enough for a 1.5px ring at any zoom, short enough to compare cheaply. */
export const formatZoom = (zoom: number) => String(Math.round(zoom * 1e4) / 1e4);

// ── The writer: pure decisions, injectable output (unit-tested without a DOM) ──────────────────────────

export interface ZoomVariableTarget {
  setVariable(name: '--z' | '--z-tier', value: string): void;
  setLod(lod: CanvasLod): void;
  setGridOff(off: boolean): void;
  setMoving(moving: boolean): void;
}

export type Schedule = (callback: () => void, ms: number) => () => void;
const defaultSchedule: Schedule = (callback, ms) => {
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
};

export interface ZoomVariables {
  /** Write everything for this zoom (first attach, or a new `.react-flow` root after a board switch). */
  reset(zoom: number): void;
  /** A viewport change: `--z` when the zoom changed, `--z-tier` only when the tier enum changed. */
  update(zoom: number): void;
  /** The viewport settled: drop `.is-moving` and write the final `--z-tier`. */
  settle(): void;
  dispose(): void;
  readonly state: { zoom: number; tier: number; lod: CanvasLod; moving: boolean };
}

export function createZoomVariables(target: ZoomVariableTarget, schedule: Schedule = defaultSchedule, onTier?: (tier: number) => void): ZoomVariables {
  const state = { zoom: NaN, tier: NaN, lod: 'full' as CanvasLod, moving: false, gridOff: false };
  let cancel: (() => void) | undefined;

  const writeTier = (tier: number) => {
    if (tier === state.tier) return;
    state.tier = tier;
    target.setVariable('--z-tier', String(tier));
    onTier?.(tier);
  };
  const writeZoom = (zoom: number) => {
    state.zoom = zoom;
    target.setVariable('--z', formatZoom(zoom));
    const lod = lodForZoom(zoom);
    if (lod !== state.lod) {
      state.lod = lod;
      target.setLod(lod);
      writeTier(zoomTier(zoom));
    }
    const gridOff = zoom < GRID_FADE_BELOW;
    if (gridOff !== state.gridOff) {
      state.gridOff = gridOff;
      target.setGridOff(gridOff);
    }
  };
  const settle = () => {
    cancel?.();
    cancel = undefined;
    if (state.moving) {
      state.moving = false;
      target.setMoving(false);
    }
    if (Number.isFinite(state.zoom)) writeTier(zoomTier(state.zoom));
  };

  return {
    state,
    reset(zoom) {
      cancel?.();
      cancel = undefined;
      state.zoom = zoom;
      state.lod = lodForZoom(zoom);
      state.tier = zoomTier(zoom);
      state.gridOff = zoom < GRID_FADE_BELOW;
      state.moving = false;
      target.setVariable('--z', formatZoom(zoom));
      target.setVariable('--z-tier', String(state.tier));
      target.setLod(state.lod);
      target.setGridOff(state.gridOff);
      target.setMoving(false);
      onTier?.(state.tier);
    },
    update(zoom) {
      if (!Number.isFinite(zoom) || zoom <= 0) return;
      if (zoom !== state.zoom) writeZoom(zoom);
      if (!state.moving) {
        state.moving = true;
        target.setMoving(true);
      }
      cancel?.();
      cancel = schedule(settle, MOVE_SETTLE_MS);
    },
    settle,
    dispose() { cancel?.(); cancel = undefined; },
  };
}

// ── The last written tier, for JS consumers (e.g. edge anchors that depend on compensated geometry) ────

let publishedTier = 1;
const tierListeners = new Set<() => void>();
function publishTier(tier: number) {
  if (tier === publishedTier) return;
  publishedTier = tier;
  for (const listener of [...tierListeners]) listener();
}
/** `useSyncExternalStore(subscribeZoomTier, getZoomTier)`: changes only at tier switches and move ends. */
export const getZoomTier = () => publishedTier;
export function subscribeZoomTier(listener: () => void): () => void {
  tierListeners.add(listener);
  return () => { tierListeners.delete(listener); };
}

// ── Binding to a React Flow store ─────────────────────────────────────────────────────────────────────

type FlowStore = ReturnType<typeof useStoreApi>;
/** Keyed by the store's `subscribe` (stable per store; `useStoreApi` returns a new wrapper per component). */
const attached = new WeakMap<object, ZoomVariables>();

export function attachZoomVariables(store: FlowStore): void {
  if (attached.has(store.subscribe)) return;
  let root: HTMLElement | null = null;
  /** `.flow-container` (App) or, without it, the React Flow root: carries `.is-moving`. */
  let container: HTMLElement | null = null;
  let transform: ReactFlowState['transform'] | undefined;
  const target: ZoomVariableTarget = {
    // React never removes these: the root's `style` prop does not name the variables, and data attributes
    // are not rendered by React Flow.
    setVariable: (name, value) => root?.style.setProperty(name, value),
    setLod: lod => { if (root) root.dataset.lod = lod; },
    setGridOff: off => root?.toggleAttribute('data-grid-off', off),
    setMoving: moving => container?.classList.toggle('is-moving', moving),
  };
  const variables = createZoomVariables(target, defaultSchedule, publishTier);
  attached.set(store.subscribe, variables);
  const sync = (state: ReactFlowState) => {
    const dom = (state.domNode as HTMLElement | null | undefined) ?? null;
    if (dom !== root) {
      container?.classList.remove('is-moving');
      root = dom;
      container = root?.closest<HTMLElement>('.flow-container') ?? root;
      transform = state.transform;
      if (root) variables.reset(state.transform[2]);
      return;
    }
    if (!root || state.transform === transform) return;
    transform = state.transform;
    variables.update(state.transform[2]);
    // App rewrites `.flow-container`'s className when the tool changes (holding Space to pan sets
    // `.is-panning` mid-gesture), which drops the flag: put it back while the viewport is still moving.
    if (variables.state.moving && container && !container.classList.contains('is-moving')) container.classList.add('is-moving');
  };
  sync(store.getState());
  store.subscribe(sync);
}

/**
 * Optional exact move end: App may call this from React Flow's `onMoveEnd` (docs/redesign/integration/lod.md)
 * so `--z-tier` is written on the move end itself instead of `MOVE_SETTLE_MS` after the last change.
 */
export function settleCanvasZoom(store: FlowStore): void {
  attached.get(store.subscribe)?.settle();
}

/**
 * The card's tier (K9-7: one enum). Also attaches the variable writer to this canvas before the first
 * paint, so the compensation is right on the very first frame even before App mounts `<CanvasLod />`.
 */
export function useCanvasLod(): CanvasLod {
  const store = useStoreApi();
  useLayoutEffect(() => attachZoomVariables(store), [store]);
  return useStore(selectLod);
}

/**
 * Mount once inside `<ReactFlow>` (App, next to `<CanvasLayers>`): keeps the variables written with no card on
 * screen, and draws the canvas-wide card state that belongs to no single card — the multiselection outline
 * (§6.8), which reads `--z` from these same variables.
 */
export function CanvasLod(): ReactElement {
  const store = useStoreApi();
  useLayoutEffect(() => attachZoomVariables(store), [store]);
  return createElement(SelectionBounds);
}

// ── Holding the card box while the simple tier re-lays its content (K9-7) ─────────────────────────────

/**
 * `-1`: the node has an explicit height (the box cannot change); `0`: nothing to hold (full or far tier,
 * a held state, or a box never measured yet); `> 0`: the measured height to hold.
 */
export function heldHeight(state: Pick<ReactFlowState, 'nodeLookup'>, id: string): number {
  const node = state.nodeLookup.get(id);
  if (!node) return 0;
  const style = node.style as { height?: unknown } | undefined;
  if (node.height !== undefined || (style?.height !== undefined && style.height !== 'auto')) return -1;
  return node.measured?.height ?? 0;
}

/**
 * The simple tier enlarges titles, tags and two body lines (§6.16), which would change the height of a
 * card whose height follows its content. While simple, such a card keeps the height it was last measured
 * at (always a full-layout measurement: far keeps the full layout under its overview layer, and a card
 * with no measurement yet renders the full layout until React Flow measures it). `hold` (note editing,
 * an in-card player) keeps the full layout and the natural height.
 *
 * Returns `{ fixed, height }`: `fixed` gates the simple-tier layout rules (`data-lod-frame`), `height`
 * is the inline height to set on `.field-card` (undefined when the node height is explicit).
 *
 * A held height belongs to the content it was measured with. `contentKey` names what sizes the content by
 * itself (a film's ratio, learnt after the first measurement): when it changes, the hold lets go for two
 * frames so React Flow measures the new natural box, then holds that one (FC-03, FV-M1). Without this the
 * first measurement, taken before the media's ratio was known, stayed frozen for the whole simple tier.
 */
export function useLodFrame(id: string, lod: CanvasLod, hold: boolean, contentKey?: string | number): { fixed: boolean; height?: number } {
  const [heldKey, setHeldKey] = useState(contentKey);
  const remeasure = heldKey !== contentKey;
  useEffect(() => {
    if (!remeasure) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setHeldKey(contentKey)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [remeasure, contentKey]);
  const value = useStore(useCallback((state: ReactFlowState) => (lod === 'simple' && !hold && !remeasure ? heldHeight(state, id) : 0), [id, lod, hold, remeasure]));
  return value === 0 ? { fixed: false } : value < 0 ? { fixed: true } : { fixed: true, height: value };
}
