import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { MiniMap, useReactFlow, useStore, useStoreApi, type MiniMapNodeProps, type Node as FlowNode, type ReactFlowState } from '@xyflow/react';
import { ChevronUp, Map as MapIcon, Minus, Plus, Scan } from 'lucide-react';
import { BoardContext } from '../board-context';
import type { CardData } from '../model';
import { CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM } from '../canvas/reveal';
import { getCanvasMetrics, useCanvasOverlay, visibleScreenRect } from '../canvas/safe-area';
import { TipHit, useHudTooltip, useRovingFocus } from '../components/Menu';
import { keyOf } from '../components/shortcut-keys';
import { motionDuration } from '../motion';

/** Navigation is the rail's right segment. Only the minimap popout covers the measured viewport.
 * Container queries fold the controls; JS owns interactions and the existing session minimap preference.
 * Must render inside the shared ReactFlowProvider, outside .flow-container.
 */
export interface ZoomControlsProps {
  /** Shown zoom. Optional: by default the navigator follows the canvas itself, so App does not re-render on every zoom frame. */
  zoom?: number;
  onZoomOut: () => void;
  /** Restores 100%. */
  onZoomReset: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  /** Smart snapping (K1 key `field.smart-snap.v1` stays in App). Passed directly by App. */
  smartSnap?: boolean;
  onToggleSnap?: () => void;
}

/* ------------------------------------------------------------------ minimap */
type MinimapMode = 'auto' | 'on' | 'off';
/** Session preference, kept across remounts (switching view or board) but not persisted. */
let sessionMinimapMode: MinimapMode = 'auto';
const MINIMAP_W = 208, MINIMAP_H = 132;
/** Above this many pictures the minimap paints them as plain blocks instead of decoding every image. */
const THUMBNAIL_LIMIT = 48;

const kindOf = (node: FlowNode) => (node.data as CardData | undefined)?.kind;
const MINIMAP_FILL: Record<string, string> = {
  video: 'var(--mm-source)', link: 'var(--mm-source)', image: 'var(--mm-source)',
  note: 'var(--mm-note)', quote: 'var(--mm-quote)', draft: 'var(--mm-draft)', frame: 'none',
};
const minimapNodeColor = (node: FlowNode) => MINIMAP_FILL[kindOf(node) ?? ''] ?? 'var(--mm-source)';
const minimapNodeClass = (node: FlowNode) => `mm-node mm-node--${kindOf(node) ?? 'card'}`;

const ThumbnailsContext = createContext(false);

function MinimapNode({ id, x, y, width, height, color, className, borderRadius, shapeRendering, selected }: MiniMapNodeProps) {
  const thumbnails = useContext(ThumbnailsContext);
  const board = useContext(BoardContext);
  const data = useStore(state => state.nodeLookup.get(id)?.internals.userNode.data as CardData | undefined);
  const url = thumbnails && data?.kind === 'image' ? (data.mediaId ? board?.getMediaUrl(data.mediaId) : data.poster) : undefined;
  const classes = `react-flow__minimap-node ${className}${selected ? ' selected' : ''}`;
  if (url) {
    return (
      <g className={classes}>
        <image href={url} x={x} y={y} width={width} height={height} preserveAspectRatio="xMidYMid slice" />
        {selected && <rect className="mm-node__ring" x={x} y={y} width={width} height={height} />}
      </g>
    );
  }
  return <rect className={classes} x={x} y={y} rx={borderRadius} ry={borderRadius} width={width} height={height} style={{ fill: color }} shapeRendering={shapeRendering} />;
}

/** Whether every card already fits inside the canvas viewport (with a 1px tolerance). */
function everythingInView(state: ReactFlowState): boolean {
  const [tx, ty, zoom] = state.transform;
  if (!state.width || !state.height || !(zoom > 0)) return true;
  const view = { left: -tx / zoom, top: -ty / zoom, right: (state.width - tx) / zoom, bottom: (state.height - ty) / zoom };
  for (const node of state.nodeLookup.values()) {
    if (node.hidden) continue;
    const { x, y } = node.internals.positionAbsolute;
    const width = node.measured?.width ?? node.width ?? node.initialWidth ?? 0;
    const height = node.measured?.height ?? node.height ?? node.initialHeight ?? 0;
    if (x < view.left - 1 || y < view.top - 1 || x + width > view.right + 1 || y + height > view.bottom + 1) return false;
  }
  return true;
}

/** Minimap height plus its two 6px paddings and the 12px gap above the rail. */
const MAP_RISE = MINIMAP_H + 24;
/** A card just touching the minimap popout still counts as covered. */
const MAP_CLEARANCE = 8;
interface ScreenBox { left: number; top: number; right: number; bottom: number }

/** Screen box the minimap would take above the rail's navigation segment. */
function mapFootprint(root: Element | null | undefined): ScreenBox | null {
  const box = root?.getBoundingClientRect();
  if (!box || !(box.width > 0 && box.height > 0)) return null;
  // CSS moves the compact navigation row above the rail. Measure that lift without classifying widths in JS.
  const controls = root?.querySelector('.navigator__row')?.getBoundingClientRect();
  const lift = controls && controls.height > 0 ? Math.max(0, box.top - controls.top) : 0;
  const width = MINIMAP_W + 12;
  return { left: box.right - width - MAP_CLEARANCE, top: box.top - MAP_RISE - lift - MAP_CLEARANCE, right: box.right + MAP_CLEARANCE, bottom: box.top - lift };
}

/** Whether an ordinary card (group trays excepted) would sit under `area` on screen. */
function cardUnder(state: ReactFlowState, area: ScreenBox | null): boolean {
  const pane = state.domNode?.getBoundingClientRect();
  const [tx, ty, zoom] = state.transform;
  if (!area || !pane || !(zoom > 0)) return false;
  for (const node of state.nodeLookup.values()) {
    if (node.hidden || kindOf(node) === 'frame') continue;
    const { x, y } = node.internals.positionAbsolute;
    const left = pane.left + tx + x * zoom, top = pane.top + ty + y * zoom;
    const right = left + (node.measured?.width ?? node.width ?? node.initialWidth ?? 0) * zoom;
    const bottom = top + (node.measured?.height ?? node.height ?? node.initialHeight ?? 0) * zoom;
    if (left < area.right && right > area.left && top < area.bottom && bottom > area.top) return true;
  }
  return false;
}

const hasMaterialSelector = (state: ReactFlowState) => state.nodes.some(node => kindOf(node) !== 'frame');
const pictureCountSelector = (state: ReactFlowState) => { let count = 0; for (const node of state.nodes) if (kindOf(node) === 'image') count++; return count; };

/** Upright horseshoe (the prototype's magnet); lucide's tilted magnet reads as a different object at 16px. */
const MagnetGlyph = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M6 4.5v7a6 6 0 0 0 12 0v-7" /><path d="M6 8.5h3.5M14.5 8.5H18M9.5 4.5v7a2.5 2.5 0 0 0 5 0v-7" />
  </svg>
);

/** Zoom rounded to whole percent: the navigator re-renders only when the shown value changes. */
const selectZoomPercent = (state: ReactFlowState) => Math.round(state.transform[2] * 100) / 100;

export default function ZoomControls({ zoom: zoomProp, onZoomOut, onZoomReset, onZoomIn, onFit, smartSnap, onToggleSnap }: ZoomControlsProps) {
  const liveZoom = useStore(selectZoomPercent);
  const zoom = zoomProp ?? liveZoom;
  const mapOverlayRef = useCanvasOverlay<HTMLDivElement>('bottom');
  const rovingRef = useRovingFocus<HTMLDivElement>();
  const { ref: tipRootRef, tooltip } = useHudTooltip<HTMLDivElement>();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRoot = useCallback((element: HTMLDivElement | null) => { rootRef.current = element; rovingRef(element); tipRootRef(element); }, [rovingRef, tipRootRef]);
  const snapOn = smartSnap;
  const toggleSnap = onToggleSnap;
  const [unfolded, setUnfolded] = useState(false);
  // The same controls stay in DOM across CSS breakpoints. Keep a visible single Tab stop after resizing.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sync = () => {
      const all = [...root.querySelectorAll<HTMLButtonElement>('button')];
      const visible = all.filter(button => button.getClientRects().length > 0);
      const stop = visible.find(button => button === document.activeElement) ?? visible.find(button => button.tabIndex === 0) ?? visible[0];
      for (const button of all) button.tabIndex = button === stop ? 0 : -1;
    };
    sync();
    const sizes = new ResizeObserver(sync);
    sizes.observe(root);
    return () => sizes.disconnect();
  }, [unfolded]);
  useEffect(() => {
    if (!unfolded) return;
    const press = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node | null)) setUnfolded(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !rootRef.current?.contains(document.activeElement)) return;
      event.preventDefault(); event.stopPropagation(); setUnfolded(false);
      requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('.navigator__fold')?.focus());
    };
    document.addEventListener('pointerdown', press, true);
    window.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', press, true); window.removeEventListener('keydown', key, true); };
  }, [unfolded]);
  // Minimap: hidden on an empty canvas; “auto” folds it while everything is in view or while it would cover a card.
  const store = useStoreApi();
  const hasMaterial = useStore(hasMaterialSelector);
  const pictures = useStore(pictureCountSelector);
  const [mode, setModeState] = useState<MinimapMode>(sessionMinimapMode);
  const setMode = (next: MinimapMode) => { sessionMinimapMode = next; setModeState(next); };
  const [outOfView, setOutOfView] = useState(() => !everythingInView(store.getState()));
  // Measured once the row is laid out; until then the auto map stays folded rather than flash over cards.
  const [mapClear, setMapClear] = useState(false);
  useEffect(() => {
    let timer = 0, hovered = false;
    const evaluate = () => {
      if (hovered) return; // Never fold or unfold the auto map under the pointer (mid-drag on the map, or clicking zoom).
      const state = store.getState();
      setOutOfView(!everythingInView(state));
      setMapClear(!cardUnder(state, mapFootprint(rootRef.current)));
    };
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(evaluate, 160); };
    // Re-check after the viewport settles, not on every frame of a pan.
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.transform === previous.transform && state.nodes === previous.nodes && state.width === previous.width && state.height === previous.height) return;
      schedule();
    });
    const root = rootRef.current;
    const enter = () => { hovered = true; };
    const leave = () => { hovered = false; schedule(); };
    root?.addEventListener('pointerenter', enter);
    root?.addEventListener('pointerleave', leave);
    evaluate();
    return () => { window.clearTimeout(timer); unsubscribe(); root?.removeEventListener('pointerenter', enter); root?.removeEventListener('pointerleave', leave); };
  }, [store]);
  const mapVisible = hasMaterial && (mode === 'on' || (mode === 'auto' && outOfView && mapClear));
  const mapUnavailable = !hasMaterial ? '画布还是空的' : '';
  // Click the map to centre the safe area there; a drag (pan) is not a click.
  const flow = useReactFlow();
  const pressPoint = useRef<{ x: number; y: number } | null>(null);
  const jump = useCallback((event: ReactMouseEvent, point: { x: number; y: number }) => {
    const start = pressPoint.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 3) return;
    const metrics = getCanvasMetrics();
    if (!metrics) return;
    const current = flow.getViewport();
    const screen = visibleScreenRect(metrics, metrics.insets);
    void flow.setViewport({ x: screen.x + screen.width / 2 - point.x * current.zoom, y: screen.y + screen.height / 2 - point.y * current.zoom, zoom: current.zoom }, { duration: motionDuration(320) });
  }, [flow]);

  const percent = Math.round(zoom * 100);
  const atMin = zoom <= CANVAS_MIN_ZOOM + 1e-3, atMax = zoom >= CANVAS_MAX_ZOOM - 1e-3;
  const controls = (
    <>
      {mapVisible && (
        <div ref={mapOverlayRef} data-canvas-overlay="bottom" className="navigator__map" onPointerDownCapture={(event: ReactPointerEvent) => { pressPoint.current = { x: event.clientX, y: event.clientY }; }}>
          <ThumbnailsContext.Provider value={pictures <= THUMBNAIL_LIMIT}>
            <MiniMap
              pannable
              zoomable
              style={{ width: MINIMAP_W, height: MINIMAP_H }}
              nodeColor={minimapNodeColor}
              nodeClassName={minimapNodeClass}
              nodeBorderRadius={8}
              nodeComponent={MinimapNode}
              offsetScale={10}
              onClick={jump}
            />
          </ThumbnailsContext.Provider>
        </div>
      )}
      <div className="navigator__row">
        <div className="navigator__group" role="group" aria-label="画布缩放">
          <button type="button" className="navigator__btn" aria-label="缩小" aria-disabled={atMin || undefined} data-tip="缩小" onClick={() => { if (!atMin) onZoomOut(); }}><TipHit/><Minus size={16} strokeWidth={1.75} aria-hidden="true"/></button>
          <button type="button" className="zoom-value" aria-label={`当前缩放 ${percent}%，恢复 100%`} data-tip="恢复 100%" onClick={() => onZoomReset()}><TipHit/>{percent}%</button>
          <button type="button" className="navigator__btn" aria-label="放大" aria-disabled={atMax || undefined} data-tip="放大" onClick={() => { if (!atMax) onZoomIn(); }}><TipHit/><Plus size={16} strokeWidth={1.75} aria-hidden="true"/></button>
          <span className="navigator__rule" aria-hidden="true"/>
          <button type="button" className="navigator__btn" aria-label="查看全部" data-tip="查看全部" data-tip-kbd={keyOf('fit', 'F')} onClick={() => onFit()}><TipHit/><Scan size={16} strokeWidth={1.75} aria-hidden="true"/></button>
        </div>
        <div className="navigator__group" role="group" aria-label="画布设置">
          <button type="button" className="navigator__btn" aria-label="小地图" aria-pressed={mapVisible} aria-disabled={mapUnavailable ? true : undefined} data-tip={mapVisible ? '隐藏小地图' : '显示小地图'} data-tip-note={mapUnavailable || undefined} onClick={() => { if (!mapUnavailable) setMode(mapVisible ? 'off' : 'on'); }}><TipHit/><MapIcon size={16} strokeWidth={1.75} aria-hidden="true"/></button>
          <span className="navigator__rule" aria-hidden="true"/>
          {toggleSnap && <button type="button" className="navigator__btn navigator__snap" aria-label="智能贴齐" aria-pressed={!!snapOn} data-tip={snapOn ? '智能贴齐：开' : '智能贴齐：关'} data-tip-note="按住 Alt 临时不吸附" onClick={() => toggleSnap()}><TipHit/><MagnetGlyph/><span className="navigator__snap-label">贴齐</span><span className="navigator__snap-dot" aria-hidden="true"/></button>}
        </div>
      </div>
    </>
  );

  return (
    <div ref={setRoot} className={`zoom-controls navigator${unfolded ? ' is-unfolded' : ''}${mapVisible ? ' has-minimap' : ''}`} role="toolbar" aria-label="画布导航">
      <button type="button" className="navigator__fold" aria-label={`画布导航，当前缩放 ${percent}%`} aria-expanded={unfolded} data-tip={unfolded ? '收起导航' : '展开导航'} data-tip-note={unfolded ? undefined : '缩放、查看全部、小地图'} onClick={() => setUnfolded(value => !value)}>
        <TipHit/><span aria-hidden="true">{percent}%</span><ChevronUp size={12} strokeWidth={2} className="navigator__fold-chevron" aria-hidden="true"/>
      </button>
      {controls}
      {tooltip}
    </div>
  );
}
