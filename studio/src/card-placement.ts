import type { BoardNode } from './model';
import { captionRules, getVisibleCardBounds } from './app/caption-rules';

export type CardMeasurements = Record<string, { width: number; height: number }>;
export interface CardBounds { x: number; y: number; width: number; height: number }
/** Placement-only boxes, in node order. Never use these as measurements or stored sizes. */
export type CardPlacementBounds = (nodes: readonly BoardNode[], measurements: CardMeasurements) => readonly CardBounds[];
export interface CardPlacementOptions {
  origin: { x: number; y: number };
  measurements?: CardMeasurements;
  preserveFirst?: boolean;
  bounds?: CardPlacementBounds;
}

/** Snapshot stationary captions before inserting anything: an incoming card cannot hide a caption to claim its space.
 * Incoming captions depend on their own proposed layout (including tight 12px picture rows), not on the camera.
 * This factory is called only by active commands. The caption module's raw-bound import is used lazily, after init. */
export function captionPlacementBounds(existing: readonly BoardNode[], measurements: CardMeasurements = {}): CardPlacementBounds {
  const stationary = captionRules(existing, measurements).captionIds;
  const existingIds = new Set(existing.map(node => node.id));
  return (nodes, rawMeasurements) => {
    const incoming = nodes.filter(node => !existingIds.has(node.id));
    const captions = new Set([...stationary, ...captionRules(incoming, rawMeasurements).captionIds]);
    return nodes.map(node => getVisibleCardBounds(node, rawMeasurements, captions, 'full'));
  };
}

const placementBounds = (nodes: readonly BoardNode[], measurements: CardMeasurements, bounds?: CardPlacementBounds): CardBounds[] =>
  bounds ? [...bounds(nodes, measurements)] : nodes.map(node => getCardBounds(node, measurements));

const CARD_GAP = 32;

function positiveSize(...values: (number | undefined)[]): number {
  return values.find(value => typeof value === 'number' && Number.isFinite(value) && value > 0)!;
}

/**
 * Natural picture ratios learned in this session (FC-01). Image cards saved by earlier versions store only a width;
 * on the canvas they follow their picture's ratio, but a card that was never rendered with its picture loaded (off
 * screen since the board opened) has no true measurement, and the default 480 height used to push it out of its
 * tray in the label count, the sidebar and the moodboard. The app reads the ratio of every such picture when the
 * board opens and records it here; nothing is written to the board.
 */
const imageRatios = new Map<string, number>();
/** The image card's own clamp (ImageCardBody): ratios outside 1:4–4:1 are covered, not stretched. */
const clampImageRatio = (ratio: number) => Math.min(4, Math.max(.25, ratio));

/** Which picture an image card shows: its stored media, else its URL or poster (as the card picks it). */
export function imageRatioKey(node: BoardNode): string | undefined {
  if (node.data.kind !== 'image') return undefined;
  return node.data.mediaId ? `media:${node.data.mediaId}` : node.data.url || node.data.poster || undefined;
}

/** An image card whose height follows its picture: no stored height. */
export function followsPictureRatio(node: BoardNode): boolean {
  return node.data.kind === 'image' && !(typeof node.style?.height === 'number' && node.style.height > 0);
}

/** Record a picture's natural size; true when this changed what is known. */
export function rememberImageRatio(key: string, width: number, height: number): boolean {
  if (!key || !(width > 0 && height > 0) || !Number.isFinite(width / height)) return false;
  const ratio = clampImageRatio(width / height);
  if (imageRatios.get(key) === ratio) return false;
  imageRatios.set(key, ratio);
  return true;
}

export function knownImageRatio(node: BoardNode): number | undefined {
  const key = imageRatioKey(node);
  return key ? imageRatios.get(key) : undefined;
}

/** Use the rendered size whenever available, including naturally tall cards. */
export function getCardBounds(node: BoardNode, measurements: CardMeasurements = {}): CardBounds {
  const measured = measurements[node.id];
  const kind = node.data.kind;
  const fallbackWidth = kind === 'frame' ? 660 : kind === 'draft' ? 340 : 290;
  const fallbackHeight = kind === 'frame' ? 450 : kind === 'video' ? 520 : kind === 'image' ? 480 : kind === 'quote' ? 500 : 440;
  const width = positiveSize(measured?.width, node.style?.width, fallbackWidth);
  // A picture-ratio card is exactly width / ratio once its picture shows; the known ratio also wins over a
  // measurement taken while the picture was still loading (the 4:3 placeholder box).
  const ratio = followsPictureRatio(node) ? knownImageRatio(node) : undefined;
  return {
    ...node.position,
    width,
    height: ratio ? Math.round(width / ratio) : positiveSize(measured?.height, node.style?.height, fallbackHeight),
  };
}

/** Frames contain only whole ordinary cards; intersecting a card is not enough. */
export function frameContainsCard(frame: BoardNode, node: BoardNode, measurements: CardMeasurements = {}): boolean {
  if (frame.data.kind !== 'frame' || node.data.kind === 'frame' || frame.id === node.id) return false;
  const outer = getCardBounds(frame, measurements), inner = getCardBounds(node, measurements);
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function conflicts(candidate: CardBounds, occupied: CardBounds[]): boolean {
  return occupied.some(box => candidate.x < box.x + box.width + CARD_GAP
    && candidate.x + candidate.width + CARD_GAP > box.x
    && candidate.y < box.y + box.height + CARD_GAP
    && candidate.y + candidate.height + CARD_GAP > box.y);
}

/** A last row at least this full is justified like the others; one emptier than LAST_ROW_SPARSE is penalised. */
const LAST_ROW_JUSTIFY = .8;
const LAST_ROW_SPARSE = .5;

/** One card in a justified row: its width ÷ height and the smallest box it may take (getCardSizeLimits). */
export interface RowItem { ratio: number; minWidth: number; minHeight: number }
export interface RowBox { x: number; y: number; width: number; height: number }

/**
 * Pictures in justified rows at their own ratio (DESIGN_SYSTEM §5.4 import rows of 184, §6.15 trays of 200–240), shared
 * by the import and the tray's “按比例成行” (CORE-03, CORE-04). Break points are chosen for the whole set (dynamic
 * programming) so row heights stay as close to `target` as they can; a row that would squeeze a card under its smallest
 * width is never chosen — that row gets fewer cards and grows taller instead, so no ratio is ever changed. A full row
 * fills `width` exactly; the last row (unless it is nearly full) and any row that cannot be filled without passing
 * `maxHeight` keep the target height and stay left-aligned; a mostly empty last row is avoided where the rows above can
 * take its cards. Offsets are relative to the block's top-left corner, whole units.
 */
export function justifiedRows(items: readonly RowItem[], width: number, target: number, gap: number, maxHeight = target * 1.5): { boxes: RowBox[]; width: number; height: number } {
  const count = items.length;
  if (!count) return { boxes: [], width: 0, height: 0 };
  const ratio = items.map(item => Math.min(4, Math.max(.25, Number.isFinite(item.ratio) && item.ratio > 0 ? item.ratio : 1)));
  const floor = items.map((item, index) => Math.max(item.minHeight, item.minWidth / ratio[index]));
  const prefix = [0];
  ratio.forEach(value => prefix.push(prefix[prefix.length - 1] + value));
  const best = new Float64Array(count + 1).fill(Infinity);
  const from = new Int32Array(count + 1);
  const heights = new Float64Array(count + 1);
  best[0] = 0;
  const MAX_ROW = 40;
  for (let end = 1; end <= count; end++) {
    let lowest = 0;
    for (let start = end - 1; start >= Math.max(0, end - MAX_ROW); start--) {
      lowest = Math.max(lowest, floor[start]);
      const cards = end - start;
      const fill = (width - gap * (cards - 1)) / (prefix[end] - prefix[start]);
      let height: number, cost: number;
      if (fill < lowest) {
        // Too many cards for this row: one would drop under its smallest size. A lone, very wide card still has to go somewhere.
        if (cards > 1) break;
        height = lowest; cost = 1e9;
      } else if (end === count && fill >= target) {
        // The last row keeps the target height, left-aligned. Nearly full (≥ 80% of the width) it is justified like the
        // others; mostly empty (< 50%), it costs what the air beside it costs, so a lone narrow picture is fitted into
        // the rows above instead of standing by itself at the bottom (polish1 gate).
        height = Math.min(fill, Math.max(target, lowest));
        const share = (height * (prefix[end] - prefix[start]) + gap * (cards - 1)) / width;
        if (share >= LAST_ROW_JUSTIFY && fill <= Math.max(maxHeight, lowest)) { height = fill; cost = (fill - target) ** 2; }
        else cost = share < LAST_ROW_SPARSE ? ((LAST_ROW_SPARSE - share) * target) ** 2 : 0;
      }
      else if (fill <= Math.max(maxHeight, lowest)) { height = fill; cost = (fill - target) ** 2; }
      else { height = Math.min(fill, Math.max(target, lowest)); cost = (fill - target) ** 2; }
      if (best[start] + cost < best[end]) { best[end] = best[start] + cost; from[end] = start; heights[end] = height; }
    }
  }
  const rows: { start: number; end: number; height: number }[] = [];
  for (let end = count; end > 0; end = from[end]) rows.unshift({ start: from[end], end, height: heights[end] });
  const boxes: RowBox[] = new Array(count);
  let top = 0, right = 0;
  for (const row of rows) {
    const height = Math.round(row.height);
    const filled = Math.abs((width - gap * (row.end - row.start - 1)) / (prefix[row.end] - prefix[row.start]) - row.height) < .5;
    for (let index = row.start; index < row.end; index++) {
      // Cumulative rounding: the gaps stay exact and a full row ends exactly at `width`.
      const left = Math.round(row.height * (prefix[index] - prefix[row.start]) + gap * (index - row.start));
      const next = filled && index === row.end - 1 ? width + gap : Math.round(row.height * (prefix[index + 1] - prefix[row.start]) + gap * (index + 1 - row.start));
      const cardWidth = Math.max(items[index].minWidth, next - gap - left);
      boxes[index] = { x: left, y: top, width: cardWidth, height: Math.max(items[index].minHeight, height) };
      right = Math.max(right, left + cardWidth);
    }
    top += height + gap;
  }
  return { boxes, width: right, height: Math.max(0, top - gap) };
}

/** Placement grid for the visible-canvas rules (DESIGN_SYSTEM §5.4). */
export const PLACEMENT_GRID = 32;
const MAX_SPIRAL_RINGS = 60;
const spiralCache = new Map<number, { x: number; y: number }[]>();

/** Grid offsets around the origin, nearest first; ties read right, down, left, up. */
function spiralOffsets(rings: number): { x: number; y: number }[] {
  const radius = Math.max(1, Math.min(MAX_SPIRAL_RINGS, Math.ceil(rings)));
  let offsets = spiralCache.get(radius);
  if (!offsets) {
    offsets = [];
    for (let row = -radius; row <= radius; row++) for (let column = -radius; column <= radius; column++) offsets.push({ x: column * PLACEMENT_GRID, y: row * PLACEMENT_GRID });
    const angle = (offset: { x: number; y: number }) => (Math.atan2(offset.y, offset.x) + Math.PI * 2) % (Math.PI * 2);
    offsets.sort((a, b) => a.x * a.x + a.y * a.y - b.x * b.x - b.y * b.y || angle(a) - angle(b));
    spiralCache.set(radius, offsets);
  }
  return offsets;
}

/** A tray label hangs above its tray (§6.15): new cards keep off that band, though the tray itself stays a background. */
const LABEL_BAND = 30;
/** Inside a tray a card keeps the tray's 16 padding from its edges (frame-layout TRAY_PADDING). */
const TRAY_INSET = 16;

function occupiedBounds(existing: BoardNode[], incoming: BoardNode[], measurements: CardMeasurements, bounds?: CardPlacementBounds): CardBounds[] {
  const incomingIds = new Set(incoming.map(node => node.id));
  const cards = placementBounds(existing.filter(node => node.data.kind !== 'frame' && !incomingIds.has(node.id)), measurements, bounds);
  const labels = existing.filter(node => node.data.kind === 'frame' && !incomingIds.has(node.id)).map(node => { const box = getCardBounds(node, measurements); return { x: box.x, y: box.y - LABEL_BAND, width: box.width, height: LABEL_BAND }; });
  return [...cards, ...labels];
}

/**
 * How new cards treat the trays already on the board (polish1 gate: an imported card straddling a tray's edge reads as
 * neither in nor out of the group). `block`: a tray and its label band are taken space, so an import never joins a group
 * by accident. `straddle`: a card may sit wholly inside a tray (a note added while looking into a group) or wholly
 * outside it, 32 clear of its edges and label, never across its edge.
 */
export type TrayRule = 'block' | 'straddle';

function trayBounds(existing: BoardNode[], incoming: BoardNode[], measurements: CardMeasurements): CardBounds[] {
  const incomingIds = new Set(incoming.map(node => node.id));
  return existing.filter(node => node.data.kind === 'frame' && !incomingIds.has(node.id)).map(node => getCardBounds(node, measurements));
}

/** Trays as taken space: the tray with its label band above it. */
const blockedTrays = (trays: CardBounds[]) => trays.map(box => ({ x: box.x, y: box.y - LABEL_BAND, width: box.width, height: box.height + LABEL_BAND }));

/** True when `candidate` would sit across a tray's edge (neither wholly inside its padding nor 32 clear of it). */
function crossesTray(candidate: CardBounds, trays: CardBounds[]): boolean {
  return trays.some(tray => {
    const clear = candidate.x >= tray.x + tray.width + CARD_GAP || candidate.x + candidate.width + CARD_GAP <= tray.x
      || candidate.y >= tray.y + tray.height + CARD_GAP || candidate.y + candidate.height + CARD_GAP <= tray.y - LABEL_BAND;
    if (clear) return false;
    const inside = candidate.x >= tray.x + TRAY_INSET && candidate.y >= tray.y + TRAY_INSET
      && candidate.x + candidate.width <= tray.x + tray.width - TRAY_INSET && candidate.y + candidate.height <= tray.y + tray.height - TRAY_INSET;
    return !inside;
  });
}

function finitePoint(point: { x: number; y: number }) {
  return { x: Number.isFinite(point.x) ? point.x : 0, y: Number.isFinite(point.y) ? point.y : 0 };
}

function inside(view: CardBounds, box: CardBounds) {
  return box.x >= view.x && box.y >= view.y && box.x + box.width <= view.x + view.width && box.y + box.height <= view.y + view.height;
}

/** Nearest free grid slot around `start`; with a view, the first slot completely inside it wins. `trays`: never across their edges. */
function spiralSearch(start: { x: number; y: number }, size: { width: number; height: number }, occupied: CardBounds[], view?: CardBounds, trays: CardBounds[] = []): { x: number; y: number } | null {
  const rings = view ? Math.max(view.width, view.height) / PLACEMENT_GRID + 8 : 24;
  const offsets = spiralOffsets(rings);
  const reach = Math.ceil(rings) * PLACEMENT_GRID + CARD_GAP;
  const near = (box: CardBounds) => box.x < start.x + size.width + reach && box.x + box.width > start.x - reach
    && box.y < start.y + size.height + reach && box.y + box.height > start.y - reach;
  const nearby = occupied.filter(near);
  const nearbyTrays = trays.filter(box => near({ ...box, y: box.y - LABEL_BAND, height: box.height + LABEL_BAND }));
  let fallback: { x: number; y: number } | null = null;
  for (const offset of offsets) {
    const candidate = { x: start.x + offset.x, y: start.y + offset.y, width: size.width, height: size.height };
    if (conflicts(candidate, nearby) || crossesTray(candidate, nearbyTrays)) continue;
    if (!view || inside(view, candidate)) return { x: candidate.x, y: candidate.y };
    fallback ??= { x: candidate.x, y: candidate.y };
  }
  return fallback;
}

/**
 * New note / draft / paste: centred in the visible canvas, then a 32px-grid spiral to the first slot that
 * neither overlaps another card nor leaves the visible area. Frames are backgrounds and are only centred.
 * A card never lands across a tray's edge (`straddle`); an import passes `block` so it never joins a group by accident.
 */
export function placeInView(node: BoardNode, existing: BoardNode[], view: CardBounds, measurements: CardMeasurements = {}, trayRule: TrayRule = 'straddle', bounds?: CardPlacementBounds): BoardNode {
  const size = placementBounds([node], measurements, bounds)[0];
  const start = finitePoint({ x: Math.round(view.x + (view.width - size.width) / 2), y: Math.round(view.y + (view.height - size.height) / 2) });
  if (node.data.kind === 'frame') return { ...node, position: start };
  const trays = trayBounds(existing, [node], measurements);
  const occupied = [...occupiedBounds(existing, [node], measurements, bounds), ...(trayRule === 'block' ? blockedTrays(trays) : [])];
  const free = spiralSearch(start, size, occupied, view, trayRule === 'straddle' ? trays : []);
  return free ? { ...node, position: free } : placeCards([{ ...node, position: start }], existing, { origin: start, measurements, bounds })[0];
}

/** Double-click or context menu: the top-left corner follows the pointer; an overlap (or a tray's edge) pushes the card right and down. */
export function placeAtPointer(node: BoardNode, existing: BoardNode[], point: { x: number; y: number }, measurements: CardMeasurements = {}, bounds?: CardPlacementBounds): BoardNode {
  const start = finitePoint(point);
  if (node.data.kind === 'frame') return { ...node, position: start };
  // Only the size: getCardBounds also returns the node's own (stale) position, which must not override the candidate's.
  const { width, height } = placementBounds([node], measurements, bounds)[0];
  const size = { width, height };
  const occupied = occupiedBounds(existing, [node], measurements, bounds);
  const trays = trayBounds(existing, [node], measurements);
  const taken = (candidate: { x: number; y: number }) => conflicts({ ...candidate, ...size }, occupied) || crossesTray({ ...candidate, ...size }, trays);
  if (!taken(start)) return { ...node, position: start };
  const offsets = spiralOffsets(40).filter(offset => offset.x >= 0 && offset.y >= 0);
  for (const offset of offsets) {
    const candidate = { x: start.x + offset.x, y: start.y + offset.y };
    if (!taken(candidate)) return { ...node, position: candidate };
  }
  return placeCards([{ ...node, position: start }], existing, { origin: start, measurements, bounds })[0];
}

interface OccupancyGrid { x: number; y: number; cell: number; columns: number; rows: number; prefix: Int32Array }

/** Cells of the view covered by a card or its 32px gap, with 2D prefix sums for constant-time area checks. */
function occupancyGrid(view: CardBounds, occupied: CardBounds[], baseGrid = PLACEMENT_GRID): OccupancyGrid | null {
  if (!(view.width > 0 && view.height > 0) || ![view.x, view.y, view.width, view.height].every(Number.isFinite)) return null;
  // A zoomed-out view keeps at most ~10,000 cells by coarsening the grid in whole multiples.
  const cell = baseGrid * Math.max(1, Math.ceil(Math.sqrt(view.width * view.height / (baseGrid * baseGrid) / 10_000)));
  const columns = Math.floor(view.width / cell), rows = Math.floor(view.height / cell);
  if (columns <= 0 || rows <= 0) return null;
  const blocked = new Uint8Array(columns * rows);
  for (const box of occupied) {
    const c0 = Math.max(0, Math.floor((box.x - CARD_GAP - view.x) / cell)), c1 = Math.min(columns - 1, Math.ceil((box.x + box.width + CARD_GAP - view.x) / cell) - 1);
    const r0 = Math.max(0, Math.floor((box.y - CARD_GAP - view.y) / cell)), r1 = Math.min(rows - 1, Math.ceil((box.y + box.height + CARD_GAP - view.y) / cell) - 1);
    for (let row = r0; row <= r1; row++) for (let column = c0; column <= c1; column++) blocked[row * columns + column] = 1;
  }
  const prefix = new Int32Array((columns + 1) * (rows + 1));
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    prefix[(row + 1) * (columns + 1) + column + 1] = blocked[row * columns + column]
      + prefix[row * (columns + 1) + column + 1] + prefix[(row + 1) * (columns + 1) + column] - prefix[row * (columns + 1) + column];
  }
  return { x: view.x, y: view.y, cell, columns, rows, prefix };
}

/** Top-left-most free slot (reading order) for a block of `width`×`height` inside the occupancy grid. */
function firstFreeBlock(grid: OccupancyGrid, width: number, height: number): { x: number; y: number } | null {
  const across = Math.ceil(width / grid.cell), down = Math.ceil(height / grid.cell), stride = grid.columns + 1;
  if (across > grid.columns || down > grid.rows) return null;
  for (let row = 0; row + down <= grid.rows; row++) for (let column = 0; column + across <= grid.columns; column++) {
    const sum = grid.prefix[(row + down) * stride + column + across] - grid.prefix[row * stride + column + across]
      - grid.prefix[(row + down) * stride + column] + grid.prefix[row * stride + column];
    if (!sum) return { x: grid.x + column * grid.cell, y: grid.y + row * grid.cell };
  }
  return null;
}

/** Rows of at most `columns` cards with 32px gaps; offsets are relative to the block's top-left corner. */
function rowLayout(sizes: { width: number; height: number }[], columns: number) {
  const offsets: { x: number; y: number }[] = [];
  let x = 0, y = 0, rowHeight = 0, width = 0;
  sizes.forEach((size, index) => {
    if (index && index % columns === 0) { y += rowHeight + CARD_GAP; x = 0; rowHeight = 0; }
    offsets.push({ x, y });
    width = Math.max(width, x + size.width);
    rowHeight = Math.max(rowHeight, size.height);
    x += size.width + CARD_GAP;
  });
  return { offsets, width, height: y + rowHeight };
}

/**
 * Import of several files, links or video tasks (§5.4): the batch keeps one row layout (32px gaps) and starts at
 * the top-left-most free area of the visible canvas that holds it. When the widest layout has no room, fewer
 * columns are tried; when nothing fits inside the view, the batch goes to the free space nearest the view centre
 * and the caller reveals it (pan, zoom ≥ 0.5, or its first card).
 */
/** As many columns as fit the view width (at least one). */
function columnsThatFit(sizes: { width: number }[], viewWidth: number): number {
  let columns = 0;
  for (let width = 0; columns < sizes.length; columns++) {
    width += (columns ? CARD_GAP : 0) + sizes[columns].width;
    if (width > viewWidth && columns) break;
  }
  return Math.max(1, columns);
}

function placeLayout(nodes: BoardNode[], layout: ReturnType<typeof rowLayout>, origin: { x: number; y: number }): BoardNode[] {
  return nodes.map((node, index) => ({
    ...node, position: { x: Math.round(origin.x + layout.offsets[index].x), y: Math.round(origin.y + layout.offsets[index].y) },
  }));
}

/** Imported pictures (§5.4): justified rows with a target height of 184 and the 12 gap trays use. */
export const IMPORT_ROW_HEIGHT = 184;
export const PICTURE_GAP = 12;
const PICTURE_MIN = { width: 80, height: 60 };

interface BatchLayout { offsets: { x: number; y: number }[]; sizes: { width: number; height: number }[]; width: number; height: number }

/**
 * A batch with pictures (CORE-04): the pictures in justified rows at their own ratio (target 184, as wide as `width`),
 * every other card below them in rows of 32px gaps, as many per row as fit.
 */
function pictureBatchLayout(nodes: BoardNode[], sizes: { width: number; height: number }[], width: number): BatchLayout {
  const pictures = nodes.map((node, index) => index).filter(index => nodes[index].data.kind === 'image');
  const others = nodes.map((node, index) => index).filter(index => nodes[index].data.kind !== 'image');
  const rows = justifiedRows(pictures.map(index => ({ ratio: sizes[index].width / Math.max(1, sizes[index].height), minWidth: PICTURE_MIN.width, minHeight: PICTURE_MIN.height })), width, IMPORT_ROW_HEIGHT, PICTURE_GAP);
  const offsets: BatchLayout['offsets'] = new Array(nodes.length);
  const placedSizes: BatchLayout['sizes'] = sizes.map(size => ({ ...size }));
  pictures.forEach((index, order) => {
    const box = rows.boxes[order];
    offsets[index] = { x: box.x, y: box.y };
    placedSizes[index] = { width: box.width, height: box.height };
  });
  let blockWidth = rows.width, blockHeight = rows.height;
  if (others.length) {
    const rest = others.map(index => sizes[index]);
    const layout = rowLayout(rest, columnsThatFit(rest, width));
    const top = pictures.length ? rows.height + CARD_GAP : 0;
    others.forEach((index, order) => { offsets[index] = { x: layout.offsets[order].x, y: top + layout.offsets[order].y }; });
    blockWidth = Math.max(blockWidth, layout.width);
    blockHeight = top + layout.height;
  }
  return { offsets, sizes: placedSizes, width: blockWidth, height: blockHeight };
}

function placePictureLayout(nodes: BoardNode[], layout: BatchLayout, origin: { x: number; y: number }): BoardNode[] {
  return nodes.map((node, index) => ({
    ...node,
    position: { x: Math.round(origin.x + layout.offsets[index].x), y: Math.round(origin.y + layout.offsets[index].y) },
    ...(node.data.kind === 'image' ? { style: { ...node.style, width: layout.sizes[index].width, height: layout.sizes[index].height } } : {}),
  }));
}

/** The raw layout owns ratio, spacing and writeback. Only its search envelope includes incoming captions.
 * Old measurements of incoming pictures must not override the sizes just calculated for the new layout. */
function pictureEnvelope(nodes: BoardNode[], layout: BatchLayout, measurements: CardMeasurements, bounds?: CardPlacementBounds) {
  if (!bounds) return layout;
  const proposed = placePictureLayout(nodes, layout, { x: 0, y: 0 });
  const imageIds = new Set(nodes.filter(node => node.data.kind === 'image').map(node => node.id));
  const rawMeasurements = Object.fromEntries(Object.entries(measurements).filter(([id]) => !imageIds.has(id)));
  const boxes = placementBounds(proposed, rawMeasurements, bounds);
  return { width: Math.max(layout.width, ...boxes.map(box => box.x + box.width)),
    height: Math.max(layout.height, ...boxes.map(box => box.y + box.height)) };
}

/** Widths tried for a picture batch, widest first: the view (less one grid cell), then narrower blocks. */
const pictureWidths = (viewWidth: number, cell: number) => [1, .75, .5, .35].map(share => Math.max(PICTURE_MIN.width * 2 + PICTURE_GAP, Math.floor(viewWidth * share - cell)));
/**
 * A batch that has no room in the view goes elsewhere and the view follows it (zoom ≥ 0.5, §5.5): pick the block
 * shape that the view can show largest — wider and shorter than the view rather than a tall column.
 */
function widestView(nodes: BoardNode[], sizes: { width: number; height: number }[], view: CardBounds, base: number): BatchLayout {
  let best = pictureBatchLayout(nodes, sizes, base), bestFit = 0;
  for (const share of [1, 1.25, 1.5, 2, 2.5]) {
    const layout = pictureBatchLayout(nodes, sizes, Math.max(base, Math.floor(base * share)));
    const fit = Math.min(view.width / Math.max(1, layout.width), view.height / Math.max(1, layout.height));
    if (fit > bestFit + 1e-6) { best = layout; bestFit = fit; }
  }
  return best;
}
const hasPictureRows = (nodes: BoardNode[]) => nodes.filter(node => node.data.kind === 'image').length > 1;

export function placeBatchInView(nodes: BoardNode[], existing: BoardNode[], view: CardBounds, measurements: CardMeasurements = {}, bounds?: CardPlacementBounds): BoardNode[] {
  // An import keeps off the trays and their labels altogether: it never lands across a group's edge, or inside it by accident.
  if (nodes.length <= 1) return nodes.map(node => placeInView(node, existing, view, measurements, 'block', bounds));
  const occupied = [...occupiedBounds(existing, nodes, measurements, bounds), ...blockedTrays(trayBounds(existing, nodes, measurements))];
  if (hasPictureRows(nodes)) {
    const sizes = nodes.map(node => getCardBounds(node, measurements));
    const grid = occupancyGrid(view, occupied);
    const widths = pictureWidths(view.width, grid?.cell ?? PLACEMENT_GRID);
    for (const width of widths) {
      const layout = pictureBatchLayout(nodes, sizes, width);
      const envelope = pictureEnvelope(nodes, layout, measurements, bounds);
      const slot = grid && firstFreeBlock(grid, envelope.width, envelope.height);
      if (slot) return placePictureLayout(nodes, layout, slot);
    }
    const layout = widestView(nodes, sizes, view, widths[0]);
    const envelope = pictureEnvelope(nodes, layout, measurements, bounds);
    const start = finitePoint({ x: Math.round(view.x + (view.width - envelope.width) / 2), y: Math.round(view.y + (view.height - envelope.height) / 2) });
    const free = spiralSearch(start, envelope, occupied);
    const rightEdge = occupied.reduce((right, box) => Math.max(right, box.x + box.width + CARD_GAP), start.x);
    return placePictureLayout(nodes, layout, free ?? { x: rightEdge, y: start.y });
  }
  const sizes = nodes.map(node => placementBounds([node], measurements, bounds)[0]);
  const maxColumns = columnsThatFit(sizes, view.width);
  const grid = occupancyGrid(view, occupied);
  const place = (layout: ReturnType<typeof rowLayout>, origin: { x: number; y: number }) => placeLayout(nodes, layout, origin);
  for (let columns = maxColumns; ; columns = Math.max(1, Math.ceil(columns / 2))) {
    const layout = rowLayout(sizes, columns);
    const slot = grid && firstFreeBlock(grid, layout.width, layout.height);
    if (slot) return place(layout, slot);
    if (columns === 1) break;
  }
  const layout = rowLayout(sizes, maxColumns);
  const start = finitePoint({ x: Math.round(view.x + (view.width - layout.width) / 2), y: Math.round(view.y + (view.height - layout.height) / 2) });
  const free = spiralSearch(start, layout, occupied);
  const rightEdge = occupied.reduce((right, box) => Math.max(right, box.x + box.width + CARD_GAP), start.x);
  return place(layout, free ?? { x: rightEdge, y: start.y });
}

/**
 * Files dropped on the canvas (FC-02, §5.4 P5): the batch keeps one row layout centred on the pointer and moves as a
 * whole to the nearest free slot, inside the visible canvas whenever one holds it (fewer columns are tried before
 * giving up); otherwise it goes to the nearest free space and the caller reveals it. One file keeps the single-card
 * rule: centred on the pointer, pushed off other cards.
 */
export function placeBatchAtPoint(nodes: BoardNode[], existing: BoardNode[], point: { x: number; y: number }, view: CardBounds, measurements: CardMeasurements = {}, bounds?: CardPlacementBounds): BoardNode[] {
  const anchor = finitePoint(point);
  // Dropped onto a tray: the files may land wholly inside that tray (the person aimed at the group), never across its
  // edge; every other tray and its label is taken space.
  const allTrays = trayBounds(existing, nodes, measurements);
  const target = allTrays.filter(box => anchor.x >= box.x && anchor.x <= box.x + box.width && anchor.y >= box.y && anchor.y <= box.y + box.height);
  const occupied = [...occupiedBounds(existing, nodes, measurements, bounds), ...blockedTrays(allTrays.filter(box => !target.includes(box)))];
  if (nodes.length <= 1) {
    const first = nodes[0] ? placementBounds([nodes[0]], measurements, bounds)[0] : { width: 0, height: 0 };
    const start = { x: Math.round(anchor.x - first.width / 2), y: Math.round(anchor.y - first.height / 2) };
    const free = nodes[0] && nodes[0].data.kind !== 'frame' ? spiralSearch(start, first, occupied, undefined, target) : null;
    return free ? nodes.map(node => ({ ...node, position: free })) : placeCards(nodes, existing, { origin: start, measurements, bounds });
  }
  const sizes = nodes.map(node => getCardBounds(node, measurements));
  if (hasPictureRows(nodes)) {
    const widths = pictureWidths(view.width, PLACEMENT_GRID);
    const centre = (layout: { width: number; height: number }) => ({ x: Math.round(anchor.x - layout.width / 2), y: Math.round(anchor.y - layout.height / 2) });
    for (const width of widths) {
      const layout = pictureBatchLayout(nodes, sizes, width);
      const envelope = pictureEnvelope(nodes, layout, measurements, bounds);
      const free = spiralSearch(centre(envelope), envelope, occupied, view, target);
      if (free && inside(view, { ...free, ...envelope })) return placePictureLayout(nodes, layout, free);
    }
    const layout = widestView(nodes, sizes, view, widths[0]);
    const envelope = pictureEnvelope(nodes, layout, measurements, bounds);
    const start = centre(envelope);
    const free = spiralSearch(start, envelope, occupied, undefined, target);
    const rightEdge = occupied.reduce((right, box) => Math.max(right, box.x + box.width + CARD_GAP), start.x);
    return placePictureLayout(nodes, layout, free ?? { x: rightEdge, y: start.y });
  }
  const visibleSizes = nodes.map(node => placementBounds([node], measurements, bounds)[0]);
  const maxColumns = columnsThatFit(visibleSizes, view.width);
  const centred = (layout: ReturnType<typeof rowLayout>) => ({ x: Math.round(anchor.x - layout.width / 2), y: Math.round(anchor.y - layout.height / 2) });
  for (let columns = maxColumns; ; columns = Math.max(1, Math.ceil(columns / 2))) {
    const layout = rowLayout(visibleSizes, columns);
    const free = spiralSearch(centred(layout), layout, occupied, view, target);
    if (free && inside(view, { ...free, width: layout.width, height: layout.height })) return placeLayout(nodes, layout, free);
    if (columns === 1) break;
  }
  const layout = rowLayout(visibleSizes, maxColumns);
  const start = centred(layout);
  const free = spiralSearch(start, layout, occupied, undefined, target);
  const rightEdge = occupied.reduce((right, box) => Math.max(right, box.x + box.width + CARD_GAP), start.x);
  return placeLayout(nodes, layout, free ?? { x: rightEdge, y: start.y });
}

/**
 * Place one command's cards near its origin. A bounded grid keeps a 500-card
 * import predictable; the clear space to the right is a guaranteed fallback.
 * Frames are backgrounds and must not prevent placement inside their area.
 */
export function placeCards(nodes: BoardNode[], existing: BoardNode[], options: CardPlacementOptions): BoardNode[] {
  const measurements = options.measurements ?? {};
  const incomingIds = new Set(nodes.map(node => node.id));
  const occupied = existing.filter(node => node.data.kind !== 'frame' && !incomingIds.has(node.id));
  const takenBounds = placementBounds(occupied, measurements, options.bounds);
  const origin = { x: Number.isFinite(options.origin.x) ? options.origin.x : 0, y: Number.isFinite(options.origin.y) ? options.origin.y : 0 };
  const offsetsBySize = new Map<string, { x: number; y: number }[]>();
  let rightEdge = takenBounds.reduce((right, box) => Math.max(right, box.x + box.width + CARD_GAP), origin.x);

  return nodes.map((node, index) => {
    const size = placementBounds([node], measurements, options.bounds)[0];
    let position = { ...origin };
    if (node.data.kind !== 'frame' && !(index === 0 && options.preserveFirst && !options.bounds)) {
      const candidate = { ...position, width: size.width, height: size.height };
      if (conflicts(candidate, takenBounds)) {
        const key = `${size.width}:${size.height}`;
        let offsets = offsetsBySize.get(key);
        if (!offsets) {
          offsets = [];
          for (let row = -16; row <= 16; row++) for (let column = -16; column <= 16; column++) {
            if (row || column) offsets.push({ x: column * (size.width + CARD_GAP), y: row * (size.height + CARD_GAP) });
          }
          // Prefer the nearest slot, then a reading order of right, down, left, up.
          offsets.sort((a, b) => a.x * a.x + a.y * a.y - b.x * b.x - b.y * b.y
            || (a.y < 0 ? 1 : 0) - (b.y < 0 ? 1 : 0)
            || (a.x < 0 ? 1 : 0) - (b.x < 0 ? 1 : 0) || a.y - b.y || a.x - b.x);
          offsetsBySize.set(key, offsets);
        }
        const free = offsets.find(offset => !conflicts({ ...candidate, x: origin.x + offset.x, y: origin.y + offset.y }, takenBounds));
        position = free ? { x: origin.x + free.x, y: origin.y + free.y } : { x: rightEdge, y: origin.y };
      }
    }
    if (node.data.kind !== 'frame') {
      takenBounds.push({ ...position, width: size.width, height: size.height });
      rightEdge = Math.max(rightEdge, position.x + size.width + CARD_GAP);
    }
    return { ...node, position };
  });
}

/** Sidecar for producers outside this package (text/video excerpts and X imports). Keep their raw layout, payload
 * and sizes; translate only newly made cards when a full caption is involved in an obstacle conflict. */
export function avoidCaptionObstacles(nodes: BoardNode[], existing: BoardNode[], measurements: CardMeasurements = {}): BoardNode[] {
  if (!nodes.length) return nodes;
  const ids = new Set(nodes.map(node => node.id));
  const stationary = existing.filter(node => !ids.has(node.id) && node.data.kind !== 'frame');
  const moving = nodes.filter(node => node.data.kind !== 'frame');
  if (!moving.length) return nodes;
  const bounds = captionPlacementBounds(existing, measurements);
  const obstacles = placementBounds(stationary, measurements, bounds);
  const boxes = placementBounds(moving, measurements, bounds);
  const rawObstacles = stationary.map(node => getCardBounds(node, measurements));
  const rawBoxes = moving.map(node => getCardBounds(node, measurements));
  const collision = boxes.some((box, i) => obstacles.some((other, j) =>
    (box.height !== rawBoxes[i].height || other.height !== rawObstacles[j].height) && conflicts(box, [other])));
  if (!collision) return nodes;
  const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
  const size = { width: Math.max(...boxes.map(box => box.x + box.width)) - x,
    height: Math.max(...boxes.map(box => box.y + box.height)) - y };
  const occupied = occupiedBounds(existing, nodes, measurements, bounds);
  const free = spiralSearch({ x, y }, size, occupied);
  const next = free ?? { x: occupied.reduce((right, box) => Math.max(right, box.x + box.width + CARD_GAP), x), y };
  return nodes.map(node => ({ ...node, position: { x: node.position.x + next.x - x, y: node.position.y + next.y - y } }));
}
