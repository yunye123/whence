import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useStoreApi } from '@xyflow/react';
import { useCanvasLod, type CanvasLod } from './canvas/lod';
import { getVisibleCardBounds } from './app/caption-rules';
import {
  AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, AlignHorizontalSpaceBetween,
  AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, AlignVerticalSpaceBetween,
  BookOpen, ChevronDown, Copy, Download, ExternalLink, Focus, FolderPlus, Group, Image as ImageIcon,
  MonitorPlay, MoreHorizontal, MoveHorizontal, MoveVertical, Pause, PenLine, Play, SquarePen, Trash2,
} from 'lucide-react';
import type { BoardNode } from './model';
import { BoardContext } from './board-context';
import { frameContainsCard, getCardBounds, type CardMeasurements } from './card-placement';
import { getCardSizeLimits } from './card-size';
import { canDistributeCards, type CardAlignment } from './card-movement';
import { getCanvasSafeInsets, DEFAULT_SAFE_GAP, type Rect } from './canvas/safe-area';
import { citationLocationLabel, paragraphIndexAt, quoteDisplayTitle, timeRangeLabel } from './source-location';
import ProvenanceTag from './components/ProvenanceTag';
import { ActionMenu, cardMenuEntries, onCardCommand, type ActionMenuEntry, type CardCommand } from './cards/CardMenu';
import { isImportPending, kindDisplayName, webLink } from './cards/card-utils';
import InspectorDialog from './InspectorDialog';
import { GridLayoutIcon, MasonryLayoutIcon, RowsLayoutIcon, ThreadIcon } from './icons/field-icons';
import { connectionTracker } from './canvas/edges/label-edit';
import { getConnectPick, startConnectPick, stopConnectPick, useConnectPick } from './components/connect-pick';
import { dismissToast, showToast } from './shell/Toasts';
import { keyOf } from './components/shortcut-keys';

const alignmentActions = [
  { mode: 'left', label: '靠左对齐', Icon: AlignHorizontalJustifyStart },
  { mode: 'center-x', label: '水平居中', Icon: AlignHorizontalJustifyCenter },
  { mode: 'right', label: '靠右对齐', Icon: AlignHorizontalJustifyEnd },
  { mode: 'top', label: '顶部对齐', Icon: AlignVerticalJustifyStart },
  { mode: 'center-y', label: '垂直居中', Icon: AlignVerticalJustifyCenter },
  { mode: 'bottom', label: '底部对齐', Icon: AlignVerticalJustifyEnd },
] as const;
const arrangementActions = [
  { mode: 'horizontal', label: '横向排列', detail: '间隔 32 px', Icon: MoveHorizontal },
  { mode: 'vertical', label: '纵向排列', detail: '间隔 32 px', Icon: MoveVertical },
  { mode: 'distribute-horizontal', label: '横向等距', detail: '保持首尾位置', Icon: AlignHorizontalSpaceBetween },
  { mode: 'distribute-vertical', label: '纵向等距', detail: '保持首尾位置', Icon: AlignVerticalSpaceBetween },
] as const;

export type FrameArrangement = 'rows' | 'grid' | 'masonry';
/** The layout each tray was last arranged with, for this session only (nothing new is stored, K1). */
const frameArrangements = new Map<string, FrameArrangement>();

export interface CanvasSelectionToolsProps {
  nodes: BoardNode[];
  selectedIds: string[];
  readOnly: boolean;
  tool?: 'select' | 'hand';
  measurements?: CardMeasurements;
  captionIds?: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onConnect: (sourceId: string, targetId: string) => boolean | void;
  onResize: (id: string, width: number, height: number) => boolean | void;
  onViewSelected?: () => void;
  onAlign?: (mode: CardAlignment) => void;
  // Optional, wired by App after integration (docs/redesign/integration/selection.md). Absent → the action is hidden
  // or falls back to opening the card.
  /** Center one card (card “…” / right-click “查看这张卡片”). Falls back to onViewSelected. */
  onViewCard?: (id: string) => void;
  /** Remove every selected card as one undo step. Falls back to onDelete per card. */
  onDeleteMany?: (ids: string[]) => void;
  /** Wrap the selection in a group (Ctrl G). */
  onGroup?: (ids: string[]) => void;
  /** Return to the exact source position of a quote. Falls back to BoardContext.focusSource. */
  onRevealSource?: (quoteId: string) => void;
  /** Write a quote into the current draft. */
  onWriteToDraft?: (quoteId: string) => void;
  /** Open a draft in focus writing. Falls back to onOpen. */
  onFocusWriting?: (draftId: string) => void;
  onExportDraft?: (draftId: string) => void;
  /** Open the original image viewer. Falls back to onOpen. */
  onViewOriginal?: (imageId: string) => void;
  onAddToGroup?: (id: string) => void;
  onArrangeFrame?: (frameId: string, mode: FrameArrangement) => void;
  onExportMoodboard?: (frameId: string) => void;
}

/* ------------------------------------------------------------------------------------------------
 * Placement (§6.6): centred over the selection's bounding box, 10px above it; flips below when there
 * is less than 8px above, or when above would cover other cards while below is free (and stays out of
 * the bottom safe area). Clamped 8px inside the canvas. The arrow always points at the box centre.
 * HUD islands (toolbar, navigator, banners) are never covered and keep a clear margin; when neither side
 * has room the bar is pinned inside the selection, clear of the islands, where it hides the least of the
 * selection itself (polish round 4: a batch of pictures keeps its last row, a stack of notes its titles).
 * ---------------------------------------------------------------------------------------------- */

/** Something the bar should not cover, in canvas pixels. */
export interface PlacementObstacle extends Rect {
  /** Height of the band at its top that holds a title (covering it costs TITLE_WEIGHT×). */
  title?: number;
  /** Cost per covered pixel (default 1; HUD islands use HUD_WEIGHT). */
  weight?: number;
  /** A group label estimated from data; replaced by the measured label when it is rendered. */
  frameId?: string;
}
export interface SelectionToolsPlacementInput {
  /** Selection bounding box in canvas pixels (React Flow element coordinates). */
  selection: Rect;
  /**
   * The selected cards themselves, in canvas pixels, each with the title band at its top (a tray: its label; a picture:
   * none). Only used when the bar has to sit inside the selection. Absent → the whole box counts as one card with a
   * title band at its top, the cautious reading.
   */
  members?: PlacementObstacle[];
  /** Other cards, group labels, thread labels and HUD islands in canvas pixels. */
  obstacles: PlacementObstacle[];
  bar: { width: number; height: number };
  canvas: { width: number; height: number };
  /** Depth covered at the top edge (banners) and the bottom safe inset (toolbar + gap). */
  insets?: { top: number; bottom: number };
  gap?: number;
  edge?: number;
}
export interface SelectionToolsPlacement {
  left: number;
  top: number;
  side: 'above' | 'below' | 'pinned' | 'hidden';
  arrowX: number;
}

const ARROW = 7;
/** Height of the band at the top of a card that holds its title (flow units, 100% zoom). */
const TITLE_BAND = 56;
/** Height of a tray's label above its top edge (§6.15). */
const FRAME_LABEL_BAND = 26;
/** Covering a title costs this much more than covering the same area of a card body. */
export const TITLE_WEIGHT = 12;
/** Entering the bottom safe area (but not a HUD island) costs this much per pixel. */
const SAFE_AREA_WEIGHT = 2;
/** The toolbar, navigator and banners are never covered while any other choice exists. */
export const HUD_WEIGHT = 200;
/** Screen gap kept between the bar and a HUD island: closer than this the two read as one strip. */
export const HUD_CLEARANCE = 12;
/** Screen gap kept around thread labels and tray labels (text the bar must not touch). */
export const LABEL_CLEARANCE = 8;
/**
 * Pinning the bar inside a large selection costs this much per covered pixel of the selection: more than entering
 * the empty bottom safe area (2) or a neighbour's card body (1) — the selection is what is being worked on — and far
 * less than covering words (12). So a selection with clean room above or below keeps the bar outside; when the only
 * outside places cover a label (12 imported pictures fitted above a tray whose label hangs under the toolbar line),
 * the bar moves inside instead (polish1 CHROME-06 remainder).
 */
export const SELECTION_WEIGHT = 4;

function overlapArea(a: Rect, b: Rect) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}
const inflate = (rect: Rect, by: number): Rect => ({ x: rect.x - by, y: rect.y - by, width: rect.width + by * 2, height: rect.height + by * 2 });

/**
 * Pure placement. Candidates are “above” (needs 8px below the top edge) and “below” (needs 8px above the
 * canvas bottom), centred on the selection, plus horizontal slides that keep the arrow over the selection.
 * A candidate that comes within HUD_CLEARANCE of a HUD island is not a candidate at all. The rest cost what
 * they cover: card bodies 1, titles, thread labels and group labels 12, the empty part of the bottom safe
 * area 2 (per pixel). The cheapest wins; ties keep the spec order (centred above, then centred below). So
 * the bar flips below exactly when above would cover other cards and below is free, stays out of the bottom
 * safe area unless that is the only way to keep a title visible, and slides aside before it lands on
 * a title. With no candidate on either side (a selection as tall as the visible canvas) it is pinned inside
 * the selection: at its bottom, above the safe area, while the selection's top (its titles) is in view; at
 * the top edge otherwise. A selection large enough to hold the bar is also pinned (bottom row) when the cheapest
 * outside place covers more than the bar would cover of the selection at SELECTION_WEIGHT per pixel.
 */
export function computeSelectionToolsPlacement(input: SelectionToolsPlacementInput): SelectionToolsPlacement {
  const { selection, obstacles, bar, canvas } = input;
  const gap = input.gap ?? 10, edge = input.edge ?? 8;
  const insets = input.insets ?? { top: 0, bottom: 0 };
  const centerX = selection.x + selection.width / 2;
  const narrow = canvas.width < bar.width + edge * 2;
  const clampLeft = (value: number) => narrow ? edge : Math.max(edge, Math.min(canvas.width - bar.width - edge, value));
  // The arrow points at the box centre; a bar slid aside points at the nearest spot that is still ≥16px inside
  // the selection, never outside it.
  const arrowFor = (left: number) => {
    const low = Math.max(16, selection.x + 16 - left), high = Math.min(bar.width - 16, selection.x + selection.width - 16 - left);
    const target = centerX - left;
    return low <= high ? Math.max(low, Math.min(high, target)) : Math.max(16, Math.min(bar.width - 16, target));
  };
  const centred = clampLeft(centerX - bar.width / 2);
  const outside = selection.x + selection.width < 0 || selection.x > canvas.width || selection.y + selection.height < 0 || selection.y > canvas.height;
  if (outside) return { left: centred, top: -9999, side: 'hidden', arrowX: arrowFor(centred) };
  const topLimit = insets.top + edge;
  const safeBottom = canvas.height - insets.bottom;
  const tops = { above: selection.y - gap - bar.height, below: selection.y + selection.height + gap };
  const fits = { above: tops.above >= topLimit, below: tops.below + bar.height <= canvas.height - edge };
  const islands = obstacles.filter(rect => (rect.weight ?? 1) >= HUD_WEIGHT).map(rect => inflate(rect, HUD_CLEARANCE));
  const clearOfIslands = (box: Rect) => !islands.some(rect => overlapArea(box, rect) > 0);

  const boxFor = (left: number, top: number, side: 'above' | 'below' | 'pinned'): Rect => side === 'above'
    ? { x: left, y: top, width: bar.width, height: bar.height + ARROW }
    : side === 'below' ? { x: left, y: top - ARROW, width: bar.width, height: bar.height + ARROW }
      : { x: left, y: top, width: bar.width, height: bar.height };
  const cost = (box: Rect) => {
    let total = Math.max(0, Math.min(box.height, box.y + box.height - safeBottom)) * bar.width * SAFE_AREA_WEIGHT;
    for (const rect of obstacles) {
      const area = overlapArea(box, rect);
      if (!area) continue;
      const band = rect.title ? overlapArea(box, { x: rect.x, y: rect.y, width: rect.width, height: Math.min(rect.height, rect.title) }) : 0;
      total += area * (rect.weight ?? 1) + band * (TITLE_WEIGHT - 1);
    }
    return total;
  };

  // Candidates per row: centred, slides that keep the arrow on the centre, then off-centre positions (the bar
  // still overlaps the selection by ≥32px) and positions just clear of each obstacle in that row.
  const reach = Math.max(0, bar.width / 2 - 16);
  const minLeft = selection.x + 32 - bar.width, maxLeft = selection.x + selection.width - 32;
  const leftsFor = (rowTop: number, rowBottom: number) => {
    const lefts = new Set<number>();
    for (const slide of [0, -reach / 2, reach / 2, -reach, reach]) lefts.add(Math.round(clampLeft(centerX - bar.width / 2 + slide)));
    for (let step = 0; step <= 8; step++) lefts.add(Math.round(clampLeft(minLeft + (maxLeft - minLeft) * step / 8)));
    // Just clear of each card in the row — the selected ones too, so a bar held inside can sit beside a short row.
    for (const rect of [...obstacles, ...(input.members ?? [])]) {
      if (rect.y >= rowBottom || rect.y + rect.height <= rowTop) continue;
      lefts.add(Math.round(clampLeft(rect.x + rect.width + 4)));
      lefts.add(Math.round(clampLeft(rect.x - bar.width - 4)));
    }
    return [...lefts].filter(left => !(left + bar.width - 16 < selection.x + 16 || left + 16 > selection.x + selection.width - 16));
  };
  let best: { left: number; side: 'above' | 'below'; score: number; covered: number } | null = null;
  for (const side of ['above', 'below'] as const) {
    if (!fits[side]) continue;
    const row = boxFor(0, tops[side], side);
    for (const left of leftsFor(row.y, row.y + row.height)) {
      const box = boxFor(left, tops[side], side);
      if (!clearOfIslands(box)) continue;
      const deviation = Math.abs(arrowFor(left) - (centerX - left));
      // Covered area decides; then a centred arrow, then the shortest slide, then above before below (spec order).
      const covered = cost(box);
      const score = covered * 1000 + deviation * 10 + Math.abs(left - centred) * .1 + (side === 'below' ? 1 : 0);
      if (!best || score < best.score) best = { left, side, score, covered };
    }
  }
  // Pinned inside the selection, in one of two rows. The top row hugs the top of the visible canvas (the bar's bottom
  // edge just meets the selection when there is room for that, otherwise it overlaps the selection's first pixels);
  // the bottom row sits at the selection's bottom, above the bottom safe area. Which row wins is what it hides of the
  // selection: a title band costs TITLE_WEIGHT× its area (a stack of notes keeps its titles, the bar goes to the
  // bottom), a picture only its area (a batch of pictures loses a thin strip of its first row instead of a whole band
  // of its last one, which is where the eye goes next). Equal costs keep the top row, where a toolbar is looked for.
  const members = input.members ?? [{ ...selection, title: TITLE_BAND }];
  const memberCost = (box: Rect) => {
    let total = 0;
    for (const rect of members) {
      const area = overlapArea(box, rect);
      if (!area) continue;
      const band = rect.title ? overlapArea(box, { x: rect.x, y: rect.y, width: rect.width, height: Math.min(rect.height, rect.title) }) : 0;
      total += area + band * (TITLE_WEIGHT - 1);
    }
    return total;
  };
  const insideTop = Math.max(topLimit, selection.y + edge);
  const pinBottom = Math.min(safeBottom, selection.y + selection.height) - edge - bar.height;
  const pinnedBest = (inside: boolean) => {
    const first = Math.max(topLimit, selection.y - bar.height);
    const rows = pinBottom > first ? [first, pinBottom] : [first];
    let pinned = { left: centred, top: topLimit, score: Infinity, covered: 0, hidden: 0 };
    rows.forEach((top, preference) => {
      const clamped = Math.max(topLimit, Math.min(canvas.height - edge - bar.height, top));
      for (const left of [centred, ...leftsFor(clamped, clamped + bar.height)]) {
        const box = boxFor(left, clamped, 'pinned');
        if (inside && (box.x < selection.x || box.x + box.width > selection.x + selection.width || !clearOfIslands(box))) continue;
        // An island is the last thing to cover; then the cheapest (other cards and the selection's own words), then the
        // top row, then the shortest slide.
        const covered = cost(box), hidden = memberCost(box);
        const score = (clearOfIslands(box) ? 0 : 1e12) + (covered + hidden) * 1000 + preference * 100 + Math.abs(left - centred) * .1;
        if (score < pinned.score) pinned = { left, top: clamped, score, covered, hidden };
      }
    });
    return pinned;
  };
  if (best) {
    // A large selection (the bar fits inside it with room around) may hold the bar when every outside place covers
    // more than SELECTION_WEIGHT× what the bar would hide of the selected cards (an empty stretch of the box, beside a
    // short first row of pictures, hides nothing).
    const roomy = selection.width >= bar.width + 32 && selection.height >= bar.height * 3 && pinBottom >= insideTop;
    if (roomy) {
      const inside = pinnedBest(true);
      if (inside.score < 1e12 && inside.covered + inside.hidden * SELECTION_WEIGHT < best.covered) {
        return { left: inside.left, top: inside.top, side: 'pinned', arrowX: arrowFor(inside.left) };
      }
    }
    return { left: best.left, top: tops[best.side], side: best.side, arrowX: arrowFor(best.left) };
  }
  const pinned = pinnedBest(false);
  return { left: pinned.left, top: pinned.top, side: 'pinned', arrowX: arrowFor(pinned.left) };
}

/** Selection bounding box, the selected cards and the obstacles, in flow coordinates. */
export function selectionGeometry(nodes: BoardNode[], selectedIds: string[], measurements?: CardMeasurements, captionIds?: ReadonlySet<string>, lod: CanvasLod = 'full'): { selection: Rect | null; members: PlacementObstacle[]; obstacles: PlacementObstacle[] } {
  const chosen = new Set(selectedIds);
  // A tray carries raw members. Include their visible captions in its display
  // envelope without changing the persisted selection or containment rule.
  if (captionIds) {
    const frames = nodes.filter(node => chosen.has(node.id) && node.data.kind === 'frame');
    for (const node of nodes) if (frames.some(frame => frameContainsCard(frame, node, measurements))) chosen.add(node.id);
  }
  const selected = nodes.filter(node => chosen.has(node.id));
  if (!selected.length) return { selection: null, members: [], obstacles: [] };
  // A selected tray's label sits outside its top edge (§6.15, 26 high): it belongs to the selection, the bar must not cover it.
  const boxes = selected.map(node => { const box = getVisibleCardBounds(node, measurements, captionIds, lod); return node.data.kind === 'frame' ? { ...box, y: box.y - FRAME_LABEL_BAND, height: box.height + FRAME_LABEL_BAND } : box; });
  const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
  const selection = { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y };
  // What the bar would hide of the selection itself: a picture has no title (its caption only shows on hover), a tray
  // only its label (the ground under it is not content), every other card its title band.
  const members: PlacementObstacle[] = selected.map((node, index) => {
    const box = boxes[index];
    if (node.data.kind === 'frame') return { x: box.x, y: box.y, width: Math.min(box.width, 320), height: FRAME_LABEL_BAND, title: FRAME_LABEL_BAND, frameId: node.id };
    return node.data.kind === 'image' ? { ...box } : { ...box, title: TITLE_BAND };
  });
  const obstacles: PlacementObstacle[] = [];
  for (const node of nodes) {
    if (chosen.has(node.id)) continue;
    const box = getVisibleCardBounds(node, measurements, captionIds, lod);
    if (node.data.kind === 'frame') {
      // A tray is the ground, not an obstacle (even more so the one under the selection); its label band is.
      obstacles.push({ x: box.x, y: box.y - 32, width: Math.min(box.width, 320), height: 64, title: 64, frameId: node.id });
    } else obstacles.push({ x: box.x, y: box.y, width: box.width, height: box.height, title: TITLE_BAND });
  }
  return { selection, members, obstacles };
}

/** Group labels as rendered (they sit above the tray and are as wide as their text), in flow units. */
function measureFrameLabels(flow: HTMLElement, flowRect: DOMRect, [tx, ty, zoom]: [number, number, number]): Map<string, Rect> {
  const labels = new Map<string, Rect>();
  for (const header of flow.querySelectorAll<HTMLElement>('.field-card--frame .field-card__header')) {
    const id = header.closest<HTMLElement>('.react-flow__node')?.dataset.id;
    if (!id || !header.getClientRects().length) continue;
    const rect = header.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    // The clearance is a screen distance: divide by the zoom so it stays 8px on screen.
    const pad = LABEL_CLEARANCE / zoom;
    labels.set(id, { x: (rect.left - flowRect.left - tx) / zoom - pad, y: (rect.top - flowRect.top - ty) / zoom - pad, width: rect.width / zoom + pad * 2, height: rect.height / zoom + pad * 2 });
  }
  return labels;
}

/** Thread labels as rendered (EdgeLabelRenderer), in flow units, with the label clearance around them. */
function measureEdgeLabels(flow: HTMLElement, flowRect: DOMRect, [tx, ty, zoom]: [number, number, number]): Rect[] {
  const labels: Rect[] = [];
  const pad = LABEL_CLEARANCE / zoom;
  for (const label of flow.querySelectorAll<HTMLElement>('.field-edge-label')) {
    const rect = label.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    labels.push({ x: (rect.left - flowRect.left - tx) / zoom - pad, y: (rect.top - flowRect.top - ty) / zoom - pad, width: rect.width / zoom + pad * 2, height: rect.height / zoom + pad * 2 });
  }
  return labels;
}

/* ------------------------------------------------------------------------------------------------ */

interface ToolAction {
  key: string;
  label: string;
  ariaLabel?: string;
  icon?: ReactNode;
  tag?: { label: string; gone?: boolean };
  onActivate?: () => void;
  disabled?: boolean;
  title?: string;
  menu?: 'align' | 'arrange';
  /** A choice in a set (a tray's layout): announced and drawn as pressed. */
  pressed?: boolean;
}

type MenuKind = 'more' | 'align' | 'arrange';
type DialogState = { kind: 'connect' | 'resize'; id: string } | null;

const READ_ONLY = '当前窗口只读';
const ICON = 16;

function isTextSource(node: BoardNode) {
  return node.data.kind === 'note' && !!node.data.tags?.includes('文字资料');
}

/** The title a person recognises: a quote's sentence, otherwise the card title, otherwise its kind. */
function displayTitle(node: BoardNode): string {
  return (node.data.kind === 'quote' ? quoteDisplayTitle(node.data) : node.data.title.trim()) || kindDisplayName(node.data);
}

/** Connect targets grouped by kind (视频, 摘录, 图片…) so a board with many pictures is still a short scan. */
function connectGroups(nodes: BoardNode[]): [string, BoardNode[]][] {
  const groups = new Map<string, BoardNode[]>();
  for (const node of nodes) { const kind = kindDisplayName(node.data); groups.set(kind, [...(groups.get(kind) ?? []), node]); }
  return [...groups];
}

/** Sits outside React Flow's transformed layer so actions stay readable at every zoom (K8). */
export default function CanvasSelectionTools(props: CanvasSelectionToolsProps) {
  const {
    nodes, selectedIds, readOnly, tool = 'select', measurements, captionIds, onOpen, onDelete, onDuplicate, onConnect, onResize, onViewSelected, onAlign,
    onViewCard, onDeleteMany, onGroup, onRevealSource, onWriteToDraft, onFocusWriting, onExportDraft, onViewOriginal, onAddToGroup, onArrangeFrame, onExportMoodboard,
  } = props;
  const board = useContext(BoardContext);
  const store = useStoreApi();
  const lod = useCanvasLod();
  const selected = useMemo(() => nodes.filter(node => selectedIds.includes(node.id)), [nodes, selectedIds]);
  const single = selected.length === 1 ? selected[0] : undefined;
  const canArrange = selected.length > 1 && !readOnly && selected.every(node => node.data.kind !== 'frame');
  const [menuOpen, setMenuOpen] = useState<MenuKind | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [target, setTarget] = useState('');
  const [dimensions, setDimensions] = useState({ width: '', height: '' });
  const [error, setError] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [, setArranged] = useState(0);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const alignRef = useRef<HTMLButtonElement>(null);
  const arrangeRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const selectionKey = selectedIds.join('\0');
  const dialogNode = dialog ? nodes.find(node => node.id === dialog.id) : undefined;
  const candidates = nodes.filter(node => node.id !== (dialogNode ?? single)?.id && node.data.kind !== 'frame');

  // Latest values for the card-command bus and the placement loop.
  const latest = useRef({ nodes, selectedIds, readOnly, measurements, onViewCard, onViewSelected });
  latest.current = { nodes, selectedIds, readOnly, measurements, onViewCard, onViewSelected };

  useEffect(() => { setMenuOpen(null); setDialog(null); setError(''); setActiveKey(null); }, [selectionKey, readOnly, tool]);

  /* ---------------------------------------------------------------- connect mode (§6.4 连线 C, §6.6 连线) */
  const pick = useConnectPick();
  const connectRef = useRef(onConnect);
  connectRef.current = onConnect;
  /** Connect like a dragged thread: the new thread offers its label box (connectionTracker, EG-M2). */
  const connectWithLabel = useCallback((source: string, target: string) => {
    connectionTracker.start(source, store.getState().edges.map(edge => edge.id));
    try { return connectRef.current(source, target); } finally { connectionTracker.end(); }
  }, [store]);
  // Leaving the start card (another selection, Esc, the empty canvas) leaves the mode.
  useEffect(() => {
    const current = getConnectPick();
    if (current?.source && !selectedIds.includes(current.source)) stopConnectPick();
  }, [selectionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopConnectPick(), []);
  useEffect(() => {
    if (!pick) return;
    if (readOnly || tool === 'hand') { stopConnectPick(); return; }
    const flow = store.getState().domNode;
    if (!flow) return;
    document.body.dataset.connectPicking = pick.source ? 'target' : 'source';
    let swallow = false;
    // The press already picked; its click (which would select the card) is swallowed even when the mode ends on
    // this press and these listeners are gone by the time the button comes up.
    const swallowClick = () => {
      const block = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); };
      window.addEventListener('click', block, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', block, true), 800);
    };
    // Capture on the canvas: the press picks a card instead of selecting or dragging it.
    const press = (event: PointerEvent | MouseEvent) => {
      if (event.button !== 0) return;
      const element = event.target as Element | null;
      const card = element?.closest<HTMLElement>('.react-flow__node');
      if (!card) { if (event.type === 'pointerdown' && element?.closest('.react-flow__pane')) stopConnectPick(); return; }
      event.preventDefault();
      event.stopPropagation();
      swallow = true;
      if (event.type !== 'pointerdown') return;
      const node = latest.current.nodes.find(item => item.id === card.dataset.id);
      const current = getConnectPick();
      if (!node || node.data.kind === 'frame' || !current) return;
      swallow = false;
      swallowClick();
      if (!current.source) { startConnectPick(node.id); store.getState().addSelectedNodes([node.id]); return; }
      if (node.id === current.source) return;
      // A refused connection (already connected) keeps the mode: App says why, another card can be chosen.
      if (connectWithLabel(current.source, node.id) !== false) stopConnectPick();
    };
    const click = (event: MouseEvent) => { if (!swallow) return; swallow = false; event.preventDefault(); event.stopPropagation(); };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || document.querySelector('dialog[open], [role="menu"]')) return;
      event.preventDefault();
      event.stopPropagation();
      stopConnectPick();
    };
    flow.addEventListener('pointerdown', press, true);
    flow.addEventListener('mousedown', press, true);
    flow.addEventListener('click', click, true);
    window.addEventListener('keydown', key, true);
    return () => {
      delete document.body.dataset.connectPicking;
      flow.removeEventListener('pointerdown', press, true);
      flow.removeEventListener('mousedown', press, true);
      flow.removeEventListener('click', click, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [pick, readOnly, tool, store, connectWithLabel]);
  // No start card yet (the toolbar's “连线” with nothing selected): the hint is a toast, the bar is not there.
  const choosingStart = !!pick && !pick.source;
  useEffect(() => {
    if (!choosingStart) return;
    const id = showToast('点按起点卡片，再点按要连到的卡片', { key: 'connect-pick', duration: null, action: { label: '取消', ariaLabel: '取消连线', onAction: stopConnectPick } });
    return () => dismissToast(id);
  }, [choosingStart]);

  const openDialog = useCallback((kind: 'connect' | 'resize', id: string) => {
    const node = latest.current.nodes.find(item => item.id === id);
    if (!node || latest.current.readOnly) return;
    setMenuOpen(null);
    setError('');
    if (kind === 'resize') {
      const box = getCardBounds(node, latest.current.measurements);
      const range = getCardSizeLimits(node.data);
      setDimensions({ width: String(Math.min(range.maxWidth, Math.max(range.minWidth, Math.round(box.width)))), height: String(Math.min(range.maxHeight, Math.max(range.minHeight, Math.round(box.height)))) });
    } else setTarget(latest.current.nodes.find(item => item.id !== id && item.data.kind !== 'frame')?.id ?? '');
    setDialog({ kind, id });
  }, []);

  // Card “…” and right-click menus run “查看 / 连接 / 调整尺寸” through the dialogs owned here.
  useEffect(() => onCardCommand((id: string, command: CardCommand) => {
    const current = latest.current;
    if (!current.nodes.some(node => node.id === id)) return false;
    if (command === 'view') {
      if (current.onViewCard) current.onViewCard(id);
      else if (current.onViewSelected && current.selectedIds.length === 1 && current.selectedIds[0] === id) current.onViewSelected();
      else return false;
      return true;
    }
    openDialog(command, id);
    return true;
  }), [openDialog]);

  /* ---------------------------------------------------------------- placement */
  const geometry = useMemo(() => selectionGeometry(nodes, selectedIds, measurements, captionIds, lod), [nodes, selectedIds, measurements, captionIds, lod]);
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const frameCache = useRef<{ offsetX: number; offsetY: number; width: number; height: number; insets: { top: number; bottom: number }; overlays: PlacementObstacle[]; frameLabels: Map<string, Rect>; edgeLabels: Rect[]; barWidth: number; barHeight: number } | null>(null);

  const place = useCallback(() => {
    const bar = toolbarRef.current;
    const cache = frameCache.current;
    const { selection, members, obstacles } = geometryRef.current;
    if (!bar || !cache || !selection) return;
    const [tx, ty, zoom] = store.getState().transform;
    const toScreen = (rect: PlacementObstacle): PlacementObstacle => ({ ...rect, x: rect.x * zoom + tx, y: rect.y * zoom + ty, width: rect.width * zoom, height: rect.height * zoom, title: rect.title === undefined ? undefined : rect.title * zoom });
    // Below full, tray tabs keep their screen height. Account for that band on
    // every pure placement pass; DOM label measurement still waits for settle.
    const labels = members.filter(member => member.frameId).map(member => {
      const height = FRAME_LABEL_BAND / Math.min(1, zoom);
      return { ...member, y: member.y + FRAME_LABEL_BAND - height, height, title: height };
    });
    const boxes = [selection, ...labels];
    const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
    const envelope = { x: left, y: top, width: Math.max(...boxes.map(box => box.x + box.width)) - left, height: Math.max(...boxes.map(box => box.y + box.height)) - top };
    const result = computeSelectionToolsPlacement({
      selection: toScreen(envelope),
      members: members.map(rect => toScreen(rect.frameId ? labels.find(label => label.frameId === rect.frameId)! : rect)),
      obstacles: [...obstacles.map(rect => {
        const label = rect.frameId ? cache.frameLabels.get(rect.frameId) : undefined;
        return toScreen(label ? { ...rect, ...label, title: label.height } : rect);
      }), ...cache.edgeLabels.map(label => toScreen({ ...label, title: label.height })), ...cache.overlays],
      bar: { width: cache.barWidth, height: cache.barHeight },
      canvas: { width: cache.width, height: cache.height },
      insets: cache.insets,
    });
    bar.style.transform = `translate(${Math.round(result.left + cache.offsetX)}px, ${Math.round(result.top + cache.offsetY)}px)`;
    bar.style.setProperty('--arrow-x', `${Math.round(result.arrowX)}px`);
    if (bar.dataset.placement !== result.side) bar.dataset.placement = result.side;
  }, [store]);

  /** Re-read the few DOM sizes the placement needs (not on every pan frame). */
  const measure = useCallback(() => {
    const bar = toolbarRef.current;
    const flow = store.getState().domNode;
    const host = bar?.offsetParent as HTMLElement | null;
    if (!bar || !flow || !host) { frameCache.current = null; return; }
    const flowRect = flow.getBoundingClientRect(), hostRect = host.getBoundingClientRect();
    const safe = getCanvasSafeInsets();
    const gap = Number.parseFloat(getComputedStyle(flow.closest('.flow-container') ?? flow).getPropertyValue('--safe-gap')) || DEFAULT_SAFE_GAP;
    frameCache.current = {
      offsetX: flowRect.left - hostRect.left + host.clientLeft,
      offsetY: flowRect.top - hostRect.top + host.clientTop,
      width: flowRect.width,
      height: flowRect.height,
      insets: { top: Math.max(0, safe.top - gap), bottom: safe.bottom },
      // Rendered group labels, in flow units (the data estimate above is only a fallback).
      frameLabels: measureFrameLabels(flow, flowRect, store.getState().transform),
      // Thread labels (§6.17): text that the bar must not cover, the selected card's own threads included.
      edgeLabels: measureEdgeLabels(flow, flowRect, store.getState().transform),
      // HUD islands (toolbar, navigator, minimap, banners) are never covered, wherever they sit.
      overlays: Array.from(host.querySelectorAll<HTMLElement>('[data-canvas-overlay]')).filter(element => element.getClientRects().length).map(element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.left - flowRect.left, y: rect.top - flowRect.top, width: rect.width, height: rect.height, weight: HUD_WEIGHT };
      }),
      barWidth: bar.offsetWidth,
      barHeight: bar.offsetHeight,
    };
  }, [store]);

  const visible = selected.length > 0;
  const measuredFor = useRef('');
  // Before paint after every render. DOM sizes are re-read only when the bar's content changed (App re-renders on
  // every zoom frame; reading layout there would force a reflow per frame). Pure placement runs every time.
  useLayoutEffect(() => {
    if (!visible) { measuredFor.current = ''; return; }
    const signature = `${selectionKey}|${readOnly}|${tool}|${toolbarRef.current?.querySelectorAll('.selection-tools__btn').length ?? 0}|${toolbarRef.current?.textContent ?? ''}`;
    if (signature !== measuredFor.current || !frameCache.current) { measuredFor.current = signature; measure(); }
    place();
  });

  // Same-frame following of pan and zoom; resizes of the bar, the canvas or the window re-measure.
  useEffect(() => {
    if (!visible) return;
    // Tray and thread labels keep their screen size below 100%, so their size in flow units changes with the zoom:
    // read them again once a zoom settles (a reveal that zooms to 74% made a stale label look 30% smaller).
    let settle = 0;
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.transform !== previous.transform) {
        place();
        if (state.transform[2] !== previous.transform[2]) { window.clearTimeout(settle); settle = window.setTimeout(() => { measure(); place(); }, 120); }
      } else if (state.width !== previous.width || state.height !== previous.height) { measure(); place(); }
    });
    const bar = toolbarRef.current;
    const flow = store.getState().domNode;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { measure(); place(); }) : null;
    if (bar) observer?.observe(bar);
    if (flow) observer?.observe(flow);
    (bar?.offsetParent as HTMLElement | null)?.querySelectorAll<HTMLElement>('[data-canvas-overlay]').forEach(element => observer?.observe(element));
    const onResize = () => { measure(); place(); };
    window.addEventListener('resize', onResize);
    // Thread labels re-lay out in their own effects after a new selection lights its threads: read them again.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(onResize); });
    return () => { unsubscribe(); window.clearTimeout(settle); observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); };
  }, [visible, selectionKey, store, measure, place]);

  // Fade out while a drag, pan or marquee gesture is in progress; come back when it ends (§6.6).
  useEffect(() => {
    if (!visible) return;
    const flow = store.getState().domNode;
    if (!flow) return;
    let start: { x: number; y: number } | null = null;
    const setGesture = (value: boolean) => { const bar = toolbarRef.current; if (bar && (bar.dataset.gesture === 'true') !== value) bar.dataset.gesture = String(value); };
    const move = (event: PointerEvent) => { if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) setGesture(true); };
    const end = () => {
      start = null;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      setGesture(false);
      requestAnimationFrame(() => { measure(); place(); });
    };
    const down = (event: PointerEvent) => {
      start = { x: event.clientX, y: event.clientY };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', end, true);
      window.addEventListener('pointercancel', end, true);
    };
    flow.addEventListener('pointerdown', down, true);
    return () => { flow.removeEventListener('pointerdown', down, true); end(); };
  }, [visible, store]);

  /* ---------------------------------------------------------------- actions */
  const view = (id: string) => { if (onViewCard) onViewCard(id); else onViewSelected?.(); };
  const startConnect = (id: string) => startConnectPick(id);

  function primaryActions(node: BoardNode): ToolAction[] {
    const { data } = node;
    const actions: ToolAction[] = [];
    const connect: ToolAction | null = readOnly || data.kind === 'frame' ? null : {
      key: 'connect', label: '连线', icon: <ThreadIcon size={ICON} />, onActivate: () => startConnect(node.id),
      disabled: !nodes.some(item => item.id !== node.id && item.data.kind !== 'frame'), title: '从这张卡片连到另一张',
    };
    switch (data.kind) {
      case 'quote': {
        const citation = data.citation;
        const source = citation ? nodes.find(item => item.id === citation.nodeId) : undefined;
        const timed = citation?.start !== undefined;
        const paragraph = !timed && citation?.textAnchor && source ? paragraphIndexAt(source.data.body, citation.textAnchor.from) : undefined;
        const location = timed ? timeRangeLabel(citation?.start) : citationLocationLabel(citation, paragraph);
        if (citation && location) {
          const verb = timed ? '回到原片' : '回到原文';
          const reveal = onRevealSource ? () => onRevealSource(node.id) : board ? () => board.focusSource(citation.nodeId, citation.start, false, node.id) : undefined;
          actions.push({
            key: 'source', label: verb, tag: { label: location, gone: !source }, ariaLabel: `${verb} ${location}`,
            onActivate: reveal, disabled: !source || !reveal, title: source ? `${verb} ${location}` : '来源卡片已不在当前画布',
          });
        }
        if (onWriteToDraft && !readOnly) actions.push({ key: 'write', label: '写进文稿', icon: <PenLine size={ICON} />, onActivate: () => onWriteToDraft(node.id) });
        if (connect) actions.push(connect);
        break;
      }
      case 'video': {
        const source = board?.getMediaUrl(data.mediaId) || data.url;
        const playable = !!board && !data.demo && !!source && !isImportPending(data.videoImport);
        if (playable) {
          const playing = board.activeVideo === node.id;
          actions.push(playing
            ? { key: 'play', label: '暂停', icon: <Pause size={ICON} />, onActivate: () => board.playVideo(null) }
            : { key: 'play', label: '播放', icon: <Play size={ICON} />, onActivate: () => board.playVideo(node.id) });
        }
        actions.push({ key: 'open', label: '观看', ariaLabel: '打开观看', icon: <MonitorPlay size={ICON} />, onActivate: () => onOpen(node.id) });
        if (connect) actions.push(connect);
        break;
      }
      case 'image':
        actions.push({ key: 'open', label: '查看原图', icon: <ImageIcon size={ICON} />, onActivate: () => (onViewOriginal ?? onOpen)(node.id) });
        if (onAddToGroup && !readOnly) actions.push({ key: 'group', label: '加入分组', icon: <FolderPlus size={ICON} />, onActivate: () => onAddToGroup(node.id) });
        break;
      case 'note':
        // “打开阅读”: the reading panel has its own “阅读” view switch; the two buttons must not share a name.
        if (isTextSource(node)) actions.push({ key: 'open', label: '阅读', ariaLabel: '打开阅读', icon: <BookOpen size={ICON} />, onActivate: () => onOpen(node.id) });
        else actions.push(readOnly
          ? { key: 'open', label: '阅读', ariaLabel: '打开阅读', icon: <BookOpen size={ICON} />, onActivate: () => onOpen(node.id) }
          : { key: 'open', label: '编辑', ariaLabel: '打开编辑', icon: <SquarePen size={ICON} />, onActivate: () => onOpen(node.id) });
        if (connect) actions.push(connect);
        break;
      case 'draft':
        actions.push(readOnly
          ? { key: 'open', label: '阅读', ariaLabel: '打开阅读', icon: <BookOpen size={ICON} />, onActivate: () => onOpen(node.id) }
          : { key: 'open', label: '专注写作', icon: <SquarePen size={ICON} />, onActivate: () => (onFocusWriting ?? onOpen)(node.id) });
        if (onExportDraft) actions.push({ key: 'export', label: '导出', icon: <Download size={ICON} />, onActivate: () => onExportDraft(node.id) });
        if (connect && actions.length < 2) actions.push(connect);
        break;
      case 'link': {
        const link = webLink(data.url);
        if (link) actions.push({ key: 'web', label: '打开网页', icon: <ExternalLink size={ICON} />, onActivate: () => { window.open(link.href, '_blank', 'noopener,noreferrer'); } });
        if (data.body.trim()) actions.push({ key: 'open', label: '阅读全文并摘录', icon: <BookOpen size={ICON} />, onActivate: () => onOpen(node.id) });
        else if (!link) actions.push({ key: 'open', label: readOnly ? '阅读' : '编辑', ariaLabel: readOnly ? '打开阅读' : '打开编辑', icon: <SquarePen size={ICON} />, onActivate: () => onOpen(node.id) });
        break;
      }
      case 'frame':
        if (onArrangeFrame && !readOnly) {
          // One choice among three: the layout this tray was last arranged with is pressed.
          const current = frameArrangements.get(node.id);
          const arrange = (mode: FrameArrangement) => () => { frameArrangements.set(node.id, mode); setArranged(value => value + 1); onArrangeFrame(node.id, mode); };
          actions.push({ key: 'rows', label: '按比例成行', icon: <RowsLayoutIcon size={ICON} />, onActivate: arrange('rows'), pressed: current === 'rows', title: '图片保持原比例，排成等高的行' });
          actions.push({ key: 'grid', label: '网格', icon: <GridLayoutIcon size={ICON} />, onActivate: arrange('grid'), pressed: current === 'grid', title: '等大的方格' });
          actions.push({ key: 'masonry', label: '瀑布', icon: <MasonryLayoutIcon size={ICON} />, onActivate: arrange('masonry'), pressed: current === 'masonry', title: '等宽的列，高低错落' });
        } else if (onViewSelected || onViewCard) actions.push({ key: 'view', label: '查看这组', icon: <Focus size={ICON} />, onActivate: () => view(node.id) });
        break;
    }
    return actions.slice(0, 4);
  }

  function secondaryActions(node: BoardNode): ToolAction[] {
    if (node.data.kind === 'frame' && onExportMoodboard) return [{ key: 'moodboard', label: '导出灵感板', icon: <Download size={ICON} />, onActivate: () => onExportMoodboard(node.id) }];
    return [];
  }

  function multiActions(): ToolAction[] {
    const reason = !canArrange ? readOnly ? READ_ONLY : '请选择至少两张普通卡片' : undefined;
    const actions: ToolAction[] = [];
    if (onAlign) {
      actions.push({ key: 'align', label: '对齐', ariaLabel: '对齐选中卡片', icon: <AlignHorizontalJustifyStart size={ICON} />, menu: 'align', disabled: !canArrange, title: reason ?? '对齐边缘或中心' });
      actions.push({ key: 'arrange', label: '排列', ariaLabel: '排列选中卡片', icon: <MoveHorizontal size={ICON} />, menu: 'arrange', disabled: !canArrange, title: reason ?? '整齐排列或调整间距' });
    }
    if (onGroup && !readOnly) actions.push({ key: 'group', label: '分组', icon: <Group size={ICON} />, onActivate: () => onGroup(selectedIds), title: '把选中卡片放进一个分组 (Ctrl+G)' });
    return actions;
  }

  // A group's cards (what “删除分组和 N 张图片” removes with it).
  const contained = single?.data.kind === 'frame' ? nodes.filter(node => frameContainsCard(single, node, measurements)) : [];
  const moreEntries: ActionMenuEntry[] = single
    ? cardMenuEntries(single.data, {
      readOnly, tool,
      canConnect: candidates.length > 0,
      onView: onViewSelected || onViewCard ? () => view(single.id) : undefined,
      onConnect: () => openDialog('connect', single.id),
      onResize: () => openDialog('resize', single.id),
      onDuplicate: () => onDuplicate(single.id),
      onDelete: () => onDelete(single.id),
      frameContents: contained.length ? { count: contained.length, pictures: contained.every(node => node.data.kind === 'image') } : undefined,
      onDeleteWithContents: onDeleteMany && contained.length ? () => onDeleteMany([single.id, ...contained.map(node => node.id)]) : undefined,
    })
    : [
      ...(onViewSelected ? [{ id: 'view', label: '查看所选', icon: <Focus size={ICON} />, onSelect: onViewSelected }] : []),
      { id: 'duplicate', label: '复制所选', icon: <Copy size={ICON} />, onSelect: () => selectedIds.forEach(onDuplicate), shortcut: keyOf('duplicate', 'Ctrl D'), ...(readOnly ? { disabled: true, reason: '只读窗口', title: READ_ONLY } : {}) },
      { kind: 'separator', id: 'sep-delete' },
      { id: 'delete', label: `移除 ${selected.length} 张卡片`, icon: <Trash2 size={ICON} />, danger: true, shortcut: keyOf('delete', 'Delete'), onSelect: () => (onDeleteMany ? onDeleteMany(selectedIds) : selectedIds.forEach(onDelete)), ...(readOnly ? { disabled: true, reason: '只读窗口', title: READ_ONLY } : {}) },
    ];

  const alignEntries: ActionMenuEntry[] = onAlign ? [
    { kind: 'heading', id: 'align-help', label: '以选中卡片的整体外框为准' },
    ...alignmentActions.map(({ mode, label, Icon }) => ({ id: mode, label, icon: <Icon size={ICON} />, onSelect: () => onAlign(mode) })),
  ] : [];
  const arrangeEntries: ActionMenuEntry[] = onAlign ? arrangementActions.map(({ mode, label, detail, Icon }) => {
    const distribute = mode === 'distribute-horizontal' || mode === 'distribute-vertical';
    const allowed = !distribute || canDistributeCards(nodes, selectedIds, mode === 'distribute-horizontal' ? 'horizontal' : 'vertical', measurements);
    const reason = selected.length < 3 ? '至少选择 3 张卡片' : '首尾空间不足，请先排列';
    return { id: mode, label, detail: allowed ? detail : reason, icon: <Icon size={ICON} />, onSelect: () => onAlign(mode), disabled: !allowed, title: allowed ? detail : reason };
  }) : [];

  const primary = single ? primaryActions(single) : multiActions();
  const secondary = single ? secondaryActions(single) : [];
  // Connect mode with this card as the start: the bar becomes the mode's hint (Esc or “取消” leaves it).
  const picking = !!pick?.source && single?.id === pick.source;
  const allKeys = picking ? ['pick-list', 'pick-cancel'] : [...primary, ...secondary].map(action => action.key).concat('more');
  const currentKey = activeKey && allKeys.includes(activeKey) ? activeKey : allKeys[0];
  const dialogLimits = dialogNode ? getCardSizeLimits(dialogNode.data) : undefined;
  const label = single ? (single.data.kind === 'quote' ? quoteDisplayTitle(single.data) : single.data.title) || kindDisplayName(single.data) : '';

  // The “连线” button that started the mode is gone: keep the keyboard on the bar (its first button).
  useLayoutEffect(() => {
    if (!picking) return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) toolbarRef.current?.querySelector<HTMLButtonElement>('[data-key="pick-list"]')?.focus({ preventScroll: true });
  }, [picking]);

  function toolbarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget && !(event.target as Element).closest('.selection-tools__btn')) return;
    const buttons = Array.from(toolbarRef.current?.querySelectorAll<HTMLButtonElement>('.selection-tools__btn') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (next: number) => { const button = buttons[(next + buttons.length) % buttons.length]; button?.focus(); setActiveKey(button?.dataset.key ?? null); };
    if (event.key === 'ArrowRight') { event.preventDefault(); focus(index + 1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); focus(index - 1); }
    else if (event.key === 'Home') { event.preventDefault(); focus(0); }
    else if (event.key === 'End') { event.preventDefault(); focus(buttons.length - 1); }
    else if (event.key === 'Escape' && !menuOpen) {
      // Leave the bar: focus returns to the (first) selected card.
      const id = selectedIds[0];
      const node = id ? document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`) : null;
      if (node) { event.preventDefault(); event.stopPropagation(); node.focus({ preventScroll: true }); }
    }
  }

  function renderAction(action: ToolAction) {
    const menuRef: RefObject<HTMLButtonElement | null> | undefined = action.menu === 'align' ? alignRef : action.menu === 'arrange' ? arrangeRef : undefined;
    const expanded = action.menu ? menuOpen === action.menu : undefined;
    return (
      <button
        key={action.key}
        ref={menuRef}
        type="button"
        data-key={action.key}
        className={['selection-tools__btn', action.tag && 'selection-tools__btn--lead', action.menu && 'selection-tools__btn--menu'].filter(Boolean).join(' ')}
        tabIndex={currentKey === action.key ? 0 : -1}
        aria-label={action.ariaLabel}
        aria-disabled={action.disabled || undefined}
        aria-haspopup={action.menu ? 'menu' : undefined}
        aria-expanded={expanded}
        aria-pressed={action.pressed}
        aria-controls={action.menu && expanded ? menuId : undefined}
        title={action.title}
        onFocus={() => setActiveKey(action.key)}
        onClick={() => {
          if (action.disabled) return;
          if (action.menu) setMenuOpen(value => value === action.menu ? null : action.menu!);
          else action.onActivate?.();
        }}
        onKeyDown={event => {
          if (action.menu && !action.disabled && event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); setMenuOpen(action.menu); }
        }}
      >
        {action.tag ? <ProvenanceTag variant="stamp-mini" label={action.tag.label} gone={action.tag.gone} /> : action.icon && <span className="selection-tools__icon" aria-hidden="true">{action.icon}</span>}
        <span className="selection-tools__label">{action.label}</span>
        {action.menu && <ChevronDown size={14} className="selection-tools__chevron" aria-hidden="true" />}
      </button>
    );
  }

  return <>
    {visible && (
      <div
        ref={toolbarRef}
        key={selectionKey}
        className={`selection-tools field-selection-tools ${single ? 'is-single' : 'is-multiple'}`}
        role="toolbar"
        aria-label={single ? '选中卡片操作' : '整理选中卡片'}
        aria-description={single ? `${kindDisplayName(single.data)}：${label}` : undefined}
        data-placement="above"
        data-kind={single?.data.kind}
        onPointerDown={event => event.stopPropagation()}
        onKeyDown={toolbarKeyDown}
      >
        <div className="selection-tools__row">
          {picking && single ? <>
            <span className="selection-tools__hint" aria-live="polite"><span className="selection-tools__icon" aria-hidden="true"><ThreadIcon size={ICON} /></span>点按要连到的卡片</span>
            <span className="selection-tools__rule" aria-hidden="true" />
            <button type="button" data-key="pick-list" className="selection-tools__btn selection-tools__btn--pick" tabIndex={currentKey === 'pick-list' ? 0 : -1} title="用键盘从列表里选一张卡片" onFocus={() => setActiveKey('pick-list')} onClick={() => { stopConnectPick(); openDialog('connect', single.id); }}>
              <span className="selection-tools__label">从列表选择…</span>
            </button>
            <button type="button" data-key="pick-cancel" className="selection-tools__btn" tabIndex={currentKey === 'pick-cancel' ? 0 : -1} aria-label="取消连线" title="取消连线 (Esc)" onFocus={() => setActiveKey('pick-cancel')} onClick={() => stopConnectPick()}>
              <span className="selection-tools__label">取消</span>
            </button>
          </> : <>
            {!single && <span className="selection-tools__count" aria-live="polite">已选 {selected.length} 张</span>}
            {!single && primary.length > 0 && <span className="selection-tools__rule" aria-hidden="true" />}
            {primary.map(renderAction)}
            {secondary.length > 0 && <span className="selection-tools__rule" aria-hidden="true" />}
            {secondary.map(renderAction)}
            {(primary.length > 0 || secondary.length > 0) && <span className="selection-tools__rule" aria-hidden="true" />}
            <button
              ref={moreRef}
              type="button"
              data-key="more"
              className="selection-tools__btn selection-tools__btn--icon"
              tabIndex={currentKey === 'more' ? 0 : -1}
              aria-label="更多选中卡片操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen === 'more'}
              aria-controls={menuOpen === 'more' ? menuId : undefined}
              title={readOnly ? READ_ONLY : '更多操作'}
              onFocus={() => setActiveKey('more')}
              onClick={() => setMenuOpen(value => value === 'more' ? null : 'more')}
              onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); setMenuOpen('more'); } }}
            >
              <MoreHorizontal size={18} aria-hidden="true" />
            </button>
          </>}
        </div>
      </div>
    )}

    <ActionMenu
      open={visible && menuOpen === 'more'}
      anchor={moreRef}
      id={menuId}
      label="卡片操作"
      entries={moreEntries}
      placement="bottom-end"
      onClose={() => setMenuOpen(null)}
    />
    <ActionMenu
      open={visible && menuOpen === 'align'}
      anchor={alignRef}
      id={menuId}
      label="对齐选中卡片"
      entries={alignEntries}
      placement="bottom-start"
      onClose={() => setMenuOpen(null)}
    />
    <ActionMenu
      open={visible && menuOpen === 'arrange'}
      anchor={arrangeRef}
      id={menuId}
      label="排列选中卡片"
      entries={arrangeEntries}
      placement="bottom-start"
      onClose={() => setMenuOpen(null)}
    />

    {dialog && dialogNode && <InspectorDialog title={dialog.kind === 'connect' ? '连接到卡片' : dialogNode.data.kind === 'frame' ? '调整分组大小' : '调整卡片尺寸'} closeLabel="取消并关闭卡片操作" className="field-card-dialog" onCancel={() => setDialog(null)}>
      <form onSubmit={event => {
        event.preventDefault();
        if (readOnly) { setDialog(null); return; }
        if (dialog.kind === 'connect') {
          if (!candidates.some(node => node.id === target)) { setError('请选择当前画布中的另一张卡片。'); return; }
          if (connectWithLabel(dialogNode.id, target) === false) { setError('这条连接未添加，请检查是否已经连接或画布已满。'); return; }
        } else {
          const width = Number(dimensions.width), height = Number(dimensions.height);
          if (!dialogLimits || !dimensions.width.trim() || !dimensions.height.trim() || !Number.isFinite(width) || !Number.isFinite(height) || width < dialogLimits.minWidth || width > dialogLimits.maxWidth || height < dialogLimits.minHeight || height > dialogLimits.maxHeight) { setError('请输入提示范围内的宽度和高度。'); return; }
          if (onResize(dialogNode.id, width, height) === false) { setError('尺寸未保存，请检查画布是否仍可编辑。'); return; }
        }
        setDialog(null);
      }}>
        <p className="field-card-dialog__source">{dialog.kind === 'connect' ? `从“${displayTitle(dialogNode)}”连出一条线。` : displayTitle(dialogNode)}</p>
        {dialog.kind === 'connect' ? <label className="field-card-dialog__label">连到<select data-autofocus value={target} onChange={event => { setTarget(event.target.value); setError(''); }} aria-describedby="field-card-connect-help">{connectGroups(candidates).map(([kind, items]) => <optgroup key={kind} label={kind}>{items.map(node => <option key={node.id} value={node.id}>{displayTitle(node)}</option>)}</optgroup>)}</select><small id="field-card-connect-help">连好后可以给这条线写一句标签。</small></label> : <div className="field-card-dialog__dimensions">
          <label className="field-card-dialog__label">宽度（px）<input data-autofocus type="number" required min={dialogLimits?.minWidth} max={dialogLimits?.maxWidth} step="any" value={dimensions.width} onChange={event => { setDimensions(value => ({ ...value, width: event.target.value })); setError(''); }} /><small>{dialogLimits?.minWidth}–{dialogLimits?.maxWidth} px</small></label>
          <label className="field-card-dialog__label">高度（px）<input type="number" required min={dialogLimits?.minHeight} max={dialogLimits?.maxHeight} step="any" value={dimensions.height} onChange={event => { setDimensions(value => ({ ...value, height: event.target.value })); setError(''); }} /><small>{dialogLimits?.minHeight}–{dialogLimits?.maxHeight} px</small></label>
        </div>}
        {error && <p className="field-card-dialog__error" role="alert">{error}</p>}
        <footer className="field-card-dialog__actions"><button type="button" className="btn btn--line" onClick={() => setDialog(null)}>取消</button><button type="submit" className="btn btn--primary">{dialog.kind === 'connect' ? '添加连接' : '应用尺寸'}</button></footer>
      </form>
    </InspectorDialog>}
  </>;
}
