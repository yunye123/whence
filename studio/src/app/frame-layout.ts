import type { Board, BoardNode } from '../model';
import { createNode } from '../board-utils';
import { frameContainsCard, getCardBounds, justifiedRows, knownImageRatio, type CardBounds, type CardMeasurements, type RowItem } from '../card-placement';
import { getCardSizeLimits } from '../card-size';

/**
 * Tray actions for creative boards (DESIGN_SYSTEM §6.15, §6.6): wrap a selection in a group (Ctrl G) and
 * arrange the cards inside one group by their own picture ratio. Pure: each returns a new board (one undo
 * step in App) or the same board when there is nothing to do. Positions and sizes are whole canvas units.
 */

/** Ctrl G wraps the selection with 16 on every side (§6.15). */
export const GROUP_WRAP = 16;
/** Inside a tray: padding and the gap between cards (matches the example boards). */
export const TRAY_PADDING = 16;
/** Horizontal gap; retained name for callers that use grid cell widths. */
export const TRAY_GAP = 6;
export const TRAY_ROW_GAP = 22;
/** “按比例成行” target row height for pictures: the middle of §6.15's 200–240 on creative boards. */
export const ROW_TARGET = 220;
/** “瀑布” column width target. */
export const MASONRY_COLUMN = 220;
/** “网格” cells are 4:3, the same cells as the moodboard export's grid (CORE-27). */
export const GRID_CELL_RATIO = .75;

export type FrameArrangementMode = 'rows' | 'grid' | 'masonry';

function union(boxes: CardBounds[]): CardBounds | null {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Wrap the chosen ordinary cards in a new tray placed under every card. Returns the board and the tray id. */
export function groupCards(board: Board, ids: readonly string[], measurements: CardMeasurements = {}, title = '新分组'): { board: Board; frameId?: string } {
  const chosen = board.nodes.filter(node => ids.includes(node.id) && node.data.kind !== 'frame');
  const box = union(chosen.map(node => getCardBounds(node, measurements)));
  if (!box) return { board };
  const frame = createNode('frame', { x: Math.round(box.x - GROUP_WRAP), y: Math.round(box.y - GROUP_WRAP) });
  frame.data = { ...frame.data, title, body: '' };
  const limits = getCardSizeLimits(frame.data);
  frame.style = { width: Math.max(limits.minWidth, Math.round(box.width + GROUP_WRAP * 2)), height: Math.max(limits.minHeight, Math.round(box.height + GROUP_WRAP * 2)) };
  // First in the list: frames render under cards (K7 zIndex -1) and an earlier node never covers a later one.
  return { board: { ...board, nodes: [frame, ...board.nodes] }, frameId: frame.id };
}

/**
 * Width ÷ height a card should keep (§6.15: 0.25–4). A picture keeps its own picture's ratio once it is known
 * (knownImageRatio; App reads the members' pictures before arranging), never the box an earlier layout cropped it to,
 * so switching rows → grid → masonry never accumulates cropping (CORE-03). Other cards keep the box they have.
 */
function ratioOf(node: BoardNode, box: CardBounds): number {
  const known = node.data.kind === 'image' ? knownImageRatio(node) : undefined;
  const ratio = known ?? box.width / Math.max(1, box.height);
  return Math.min(4, Math.max(.25, Number.isFinite(ratio) ? ratio : 1));
}

interface Item extends RowItem { node: BoardNode }
interface Placed { id: string; x: number; y: number; width: number; height: number }

const item = (node: BoardNode, ratio: number): Item => {
  const limits = getCardSizeLimits(node.data);
  return { node, ratio, minWidth: limits.minWidth, minHeight: limits.minHeight };
};
/** The narrowest box a card can take at its ratio without going under its smallest size. */
const smallestWidth = (entry: Item) => Math.max(entry.minWidth, entry.minHeight * entry.ratio);

/** Justified rows at the picture's own ratio (justifiedRows, shared with the import). */
function layoutRows(items: Item[], innerWidth: number): { placed: Placed[]; height: number } {
  const rows = trayRows(items, innerWidth, ROW_TARGET);
  return { placed: rows.boxes.map((box, index) => ({ id: items[index].node.id, ...box })), height: rows.height };
}

/** Shared justifiedRows keeps its import contract. Only tray rows separate the 6px column and 22px row gaps. */
function trayRows(items: Item[], width: number, target: number): ReturnType<typeof justifiedRows> {
  const layout = justifiedRows(items, width, target, TRAY_GAP);
  const tops = [...new Set(layout.boxes.map(box => box.y))].sort((a, b) => a - b);
  const shifts = new Map(tops.map((top, index) => [top, index * (TRAY_ROW_GAP - TRAY_GAP)]));
  return { ...layout, boxes: layout.boxes.map(box => ({ ...box, y: box.y + shifts.get(box.y)! })),
    height: layout.height + Math.max(0, tops.length - 1) * (TRAY_ROW_GAP - TRAY_GAP) };
}

/** As many columns as the target suggests, but never so many that a card would go under its smallest width. */
function columnsFor(items: Item[], innerWidth: number, wanted: number): { columns: number; width: number } {
  const narrowest = Math.max(...items.map(smallestWidth));
  let columns = Math.max(1, Math.min(items.length, wanted));
  while (columns > 1 && (innerWidth - TRAY_GAP * (columns - 1)) / columns < narrowest) columns--;
  return { columns, width: Math.floor((innerWidth - TRAY_GAP * (columns - 1)) / columns) };
}

/** A picture at least this wide (2:1 and wider: panoramas, banners) takes two grid cells side by side. */
export const GRID_WIDE_RATIO = 2;

/** Each grid column away from the suggested count costs this much (in empty cells). */
const GRID_COLUMN_COST = .6;

type GridCard = { entry: Item; column: number; span: number; width: number; height: number };

/** Pack `items` in reading order into rows of `columns` cells (a wide picture takes two), filling a hole left at the end of the row above. */
function packGrid(items: Item[], columns: number, width: number, cell: number): { rows: { used: boolean[]; cards: GridCard[] }[]; empty: number } {
  const rows: { used: boolean[]; cards: GridCard[] }[] = [];
  const fits = (row: (typeof rows)[number], span: number) => {
    for (let column = 0; column + span <= columns; column++) if (row.used.slice(column, column + span).every(used => !used)) return column;
    return -1;
  };
  let usedCells = 0;
  for (const entry of items) {
    const span = columns >= 2 && entry.ratio >= GRID_WIDE_RATIO ? 2 : 1;
    const slot = span * width + (span - 1) * TRAY_GAP;
    let w = Math.min(slot, cell * entry.ratio), h = w / entry.ratio;
    if (w < entry.minWidth || h < entry.minHeight) { w = smallestWidth(entry); h = w / entry.ratio; }
    const card: GridCard = { entry, column: 0, span, width: Math.round(w), height: Math.round(h) };
    // Reading order, densely: the current row, or a hole left at the end of the row just above it.
    let placedRow = -1;
    for (let index = Math.max(0, rows.length - 2); index < rows.length && placedRow < 0; index++) {
      const column = fits(rows[index], span);
      if (column >= 0 && (index === rows.length - 1 || span === 1)) { placedRow = index; card.column = column; }
    }
    if (placedRow < 0) { rows.push({ used: Array.from({ length: columns }, () => false), cards: [] }); placedRow = rows.length - 1; card.column = 0; }
    const row = rows[placedRow];
    for (let column = card.column; column < card.column + span; column++) row.used[column] = true;
    row.cards.push(card);
    usedCells += span;
  }
  return { rows, empty: rows.length * columns - usedCells };
}

/**
 * Equal 4:3 cells (CORE-27), like the moodboard export: each card is contained in its cell at its own ratio and
 * centred, nothing is cropped. A wide picture (2:1 or wider) spans two cells of the row, so a 4:1 banner is shown at
 * twice the size instead of a thin strip in a box of air (polish1 gate); a later single picture may fill the cell it
 * left at the end of the row above (dense packing, never more than one row back). A card that would go under its
 * smallest size keeps that size instead, and only its row grows to hold it.
 *
 * Round 4: the column count is the one around the suggested count that leaves the fewest empty cells — holes at row
 * ends and the last row's tail — so twelve pictures with four wide ones fill four rows of four instead of ending two
 * rows early in five columns (ragged rows); ties go to cells nearest the 220 target.
 */
function layoutGrid(items: Item[], innerWidth: number): { placed: Placed[]; height: number } {
  const wanted = Math.max(1, Math.min(items.length, Math.round(innerWidth / ROW_TARGET), Math.ceil(Math.sqrt(items.length * innerWidth / (ROW_TARGET * 3)))));
  // A wide picture only needs half its smallest width per cell (it spans two); others need a whole cell.
  const narrowest = (entry: Item) => entry.ratio >= GRID_WIDE_RATIO ? (smallestWidth(entry) - TRAY_GAP) / 2 : smallestWidth(entry);
  const widest = Math.max(...items.map(narrowest));
  const cellWidth = (columns: number) => Math.floor((innerWidth - TRAY_GAP * (columns - 1)) / columns);
  let most = wanted;
  while (most > 1 && cellWidth(most) < widest) most--;
  let best: { columns: number; width: number; cell: number; packed: ReturnType<typeof packGrid>; score: number } | null = null;
  for (const columns of [most, most - 1, most + 1]) {
    if (columns < 1 || columns > items.length || (columns > 1 && cellWidth(columns) < widest)) continue;
    const width = cellWidth(columns), cell = Math.round(width * GRID_CELL_RATIO);
    const packed = packGrid(items, columns, width, cell);
    const score = packed.empty + GRID_COLUMN_COST * Math.abs(columns - most) + .002 * Math.abs(width - ROW_TARGET);
    if (!best || score < best.score - 1e-6) best = { columns, width, cell, packed, score };
  }
  const { width, cell, packed } = best ?? { width: cellWidth(1), cell: Math.round(cellWidth(1) * GRID_CELL_RATIO), packed: packGrid(items, 1, cellWidth(1), Math.round(cellWidth(1) * GRID_CELL_RATIO)) };
  const placed: Placed[] = [];
  let top = 0;
  for (const row of packed.rows) {
    const rowHeight = Math.max(cell, ...row.cards.map(card => card.height));
    for (const card of row.cards) {
      const slot = card.span * width + (card.span - 1) * TRAY_GAP;
      placed.push({
        id: card.entry.node.id,
        x: card.column * (width + TRAY_GAP) + Math.round((slot - card.width) / 2),
        y: top + Math.round((rowHeight - card.height) / 2),
        width: card.width, height: card.height,
      });
    }
    top += rowHeight + TRAY_ROW_GAP;
  }
  return { placed, height: Math.max(0, top - TRAY_ROW_GAP) };
}

/** Columns of equal width; each card goes to the currently shortest column at its own ratio. */
function layoutMasonry(items: Item[], innerWidth: number): { placed: Placed[]; height: number } {
  const { columns, width } = columnsFor(items, innerWidth, Math.round(innerWidth / MASONRY_COLUMN));
  const heights = Array.from({ length: columns }, () => 0);
  const placed: Placed[] = [];
  for (const entry of items) {
    const column = heights.indexOf(Math.min(...heights));
    const height = Math.round(width / entry.ratio);
    placed.push({ id: entry.node.id, x: column * (width + TRAY_GAP), y: heights[column], width, height });
    heights[column] += height + TRAY_ROW_GAP;
  }
  return { placed, height: Math.max(0, Math.max(...heights) - TRAY_ROW_GAP) };
}

/** A tray label hangs 26 above the tray (§6.15); with a hair of air it takes this much room above a tray. */
export const TRAY_LABEL_BAND = 30;
/** Room kept between a grown tray and what it pushes (the placement gap). */
const PUSH_GAP = 32;

/**
 * A tray that grew taller pushes what lies below it down (CORE-02), in the same undo step: every card and tray under
 * the tray's old bottom edge that overlaps it horizontally moves down together, each pushed tray taking the cards it
 * wholly contains along, just far enough that the nearest of them (a tray counted from the top of its label) stays
 * 32 below the grown tray. So a tray never covers the label or the pictures of the tray below it, and arranging the
 * same tray again (rows → grid → rows) does not keep pushing the rest of the board further away.
 */
function pushBelow(board: Board, nodes: BoardNode[], frame: BoardNode, oldBox: CardBounds, newHeight: number, measurements: CardMeasurements, fixed: ReadonlySet<string>): BoardNode[] {
  if (newHeight <= oldBox.height) return nodes;
  const oldBottom = oldBox.y + oldBox.height;
  const moving = new Set<string>();
  let nearest = Infinity;
  for (const node of board.nodes) {
    if (node.id === frame.id || fixed.has(node.id)) continue;
    const box = getCardBounds(node, measurements);
    if (box.y >= oldBottom - 1 && box.x < oldBox.x + oldBox.width && box.x + box.width > oldBox.x) {
      moving.add(node.id);
      nearest = Math.min(nearest, box.y - (node.data.kind === 'frame' ? TRAY_LABEL_BAND : 0));
    }
  }
  for (const node of board.nodes) {
    if (!moving.has(node.id) || node.data.kind !== 'frame') continue;
    for (const member of board.nodes) if (!fixed.has(member.id) && member.id !== frame.id && frameContainsCard(node, member, measurements)) moving.add(member.id);
  }
  const shift = Math.ceil(oldBox.y + newHeight + PUSH_GAP - nearest);
  if (!moving.size || shift <= 0) return nodes;
  return nodes.map(node => moving.has(node.id) ? { ...node, position: { x: node.position.x, y: Math.round(node.position.y + shift) } } : node);
}

/**
 * Reading order by visual rows: cards whose tops fall inside the current row band (above the shortest card's bottom)
 * read left to right, so pictures centred in grid cells or rows of mixed heights keep their order when re-arranged.
 */
function readingRows<T extends { box: CardBounds }>(sorted: T[]): T[] {
  const result: T[] = [];
  let row: T[] = [], bottom = -Infinity;
  for (const entry of sorted) {
    if (row.length && entry.box.y >= bottom) { result.push(...row.sort((a, b) => a.box.x - b.box.x)); row = []; bottom = -Infinity; }
    row.push(entry);
    bottom = row.length === 1 ? entry.box.y + entry.box.height : Math.min(bottom, entry.box.y + entry.box.height);
  }
  return [...result, ...row.sort((a, b) => a.box.x - b.box.x)];
}

/**
 * Arrange the cards wholly inside one tray (frameContainsCard, the same rule as dragging a group, K9-6).
 * Reading order is kept (top to bottom, then left to right). The tray keeps its width and grows or shrinks
 * in height so it always wraps every card (§6.15: a tray never clips a card).
 */
export function arrangeFrame(board: Board, frameId: string, mode: FrameArrangementMode, measurements: CardMeasurements = {}): Board {
  const frame = board.nodes.find(node => node.id === frameId && node.data.kind === 'frame');
  if (!frame) return board;
  const members = board.nodes.filter(node => frameContainsCard(frame, node, measurements));
  if (!members.length) return board;
  const frameBox = getCardBounds(frame, measurements);
  const innerWidth = Math.max(80, frameBox.width - TRAY_PADDING * 2);
  const boxes = members.map(node => ({ node, box: getCardBounds(node, measurements) })).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const items = (mode === 'masonry' ? boxes : readingRows(boxes)).map(({ node, box }) => item(node, ratioOf(node, box)));
  const layout = mode === 'grid' ? layoutGrid(items, innerWidth) : mode === 'masonry' ? layoutMasonry(items, innerWidth) : layoutRows(items, innerWidth);
  const byId = new Map(layout.placed.map(entry => [entry.id, entry]));
  const originX = Math.round(frameBox.x + TRAY_PADDING), originY = Math.round(frameBox.y + TRAY_PADDING);
  let changed = false;
  const nodes = board.nodes.map(node => {
    const spot = byId.get(node.id);
    if (!spot) return node;
    const limits = getCardSizeLimits(node.data);
    const width = Math.max(limits.minWidth, spot.width), height = Math.max(limits.minHeight, spot.height);
    const position = { x: originX + spot.x, y: originY + spot.y };
    if (node.position.x === position.x && node.position.y === position.y && node.style?.width === width && node.style?.height === height) return node;
    changed = true;
    return { ...node, position, style: { ...node.style, width, height } };
  });
  // Lay out again with the clamped sizes counted, so the tray wraps a card that hit its minimum size.
  const bottom = Math.max(...nodes.filter(node => byId.has(node.id)).map(node => node.position.y + (node.style?.height ?? 0)));
  const frameHeight = Math.max(getCardSizeLimits(frame.data).minHeight, Math.round(bottom + TRAY_PADDING - frameBox.y));
  const resizedFrame = frame.style?.height === frameHeight && frame.style?.width === Math.round(frameBox.width) ? frame : { ...frame, style: { ...frame.style, width: Math.round(frameBox.width), height: frameHeight } };
  if (!changed && resizedFrame === frame) return board;
  const arranged = nodes.map(node => node.id === frame.id ? resizedFrame : node);
  const fixed = new Set(members.map(node => node.id));
  return { ...board, nodes: pushBelow(board, arranged, frame, frameBox, frameHeight, measurements, fixed) };
}

/**
 * Rows of pictures as “按比例成行” leaves them: every member a picture; the cards of each row share one height and
 * follow each other 6 apart from the tray's left padding; every row but the last ends at the right padding.
 * Returns the row heights, or null for a tray arranged by hand, a grid or a masonry.
 */
function justifiedRowHeights(members: { node: BoardNode; box: CardBounds }[], frameBox: CardBounds): number[] | null {
  if (!members.length || members.some(member => member.node.data.kind !== 'image')) return null;
  const left = frameBox.x + TRAY_PADDING, right = frameBox.x + frameBox.width - TRAY_PADDING;
  const rows: CardBounds[][] = [];
  for (const { box } of [...members].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const row = rows.find(candidate => Math.abs(candidate[0].y - box.y) < 2);
    if (row) row.push(box); else rows.push([box]);
  }
  const heights: number[] = [];
  for (const [index, row] of rows.entries()) {
    row.sort((a, b) => a.x - b.x);
    if (Math.abs(row[0].x - left) > 2 || row.some(box => Math.abs(box.height - row[0].height) > 2)) return null;
    // Read old 12px rows as arranged rows too. Joining may reflow the tail in v2, while untouched old rows
    // keep their exact coordinates; changing the preferred gap must not turn an old arranged tray into a hand layout.
    for (let at = 1; at < row.length; at++) {
      const gap = row[at].x - (row[at - 1].x + row[at - 1].width);
      if (Math.abs(gap - TRAY_GAP) > 2 && Math.abs(gap - 12) > 2) return null;
    }
    const last = row[row.length - 1];
    if (index < rows.length - 1 && Math.abs(last.x + last.width - right) > 2) return null;
    heights.push(row[0].height);
  }
  return heights;
}

/** Move one card into a tray: next to the tray's last card, growing the tray to wrap it. */
export function moveIntoFrame(board: Board, cardId: string, frameId: string, measurements: CardMeasurements = {}): Board {
  const frame = board.nodes.find(node => node.id === frameId && node.data.kind === 'frame');
  const card = board.nodes.find(node => node.id === cardId && node.data.kind !== 'frame');
  if (!frame || !card || frameContainsCard(frame, card, measurements)) return board;
  const frameBox = getCardBounds(frame, measurements);
  const cardBox = getCardBounds(card, measurements);
  const memberNodes = board.nodes.filter(node => frameContainsCard(frame, node, measurements));
  // A picture joining a tray of justified picture rows: the rows are justified again with it (the target height is the
  // tray's own middle row height), at the end or — when that leaves a field of air — where the rows close best, so a
  // narrow picture never sits alone in a last row of air (polish1 gate) nor leaves a third of the last row empty (round 4).
  // The tray keeps its width, wraps the result exactly, pushes what is below when it grows; one undo step.
  const rowHeights = card.data.kind === 'image' ? justifiedRowHeights(memberNodes.map(node => ({ node, box: getCardBounds(node, measurements) })), frameBox) : null;
  if (rowHeights) return reflowRows(board, frame, frameBox, [...memberNodes, card], rowHeights, measurements);
  const members = memberNodes.map(node => getCardBounds(node, measurements));
  const inner = frameBox.width - TRAY_PADDING * 2;
  // Fit the card into the tray's row height when it is larger than the tray can hold side by side.
  const scale = Math.min(1, inner / cardBox.width, (members.length ? Math.max(...members.map(box => box.height)) : ROW_TARGET) / cardBox.height);
  const width = Math.round(cardBox.width * scale), height = Math.round(cardBox.height * scale);
  const bottom = members.length ? Math.max(...members.map(box => box.y + box.height)) : frameBox.y + TRAY_PADDING - TRAY_ROW_GAP;
  // The last row: cards whose top is level with the card that reaches lowest.
  const lowest = members.find(box => box.y + box.height === bottom);
  const lastRow = lowest ? members.filter(box => Math.abs(box.y - lowest.y) < 4) : [];
  const rowRight = lastRow.length ? Math.max(...lastRow.map(box => box.x + box.width)) : frameBox.x + TRAY_PADDING - TRAY_GAP;
  const rowTop = lowest ? lowest.y : frameBox.y + TRAY_PADDING;
  const fitsInRow = lastRow.length && rowRight + TRAY_GAP + width <= frameBox.x + frameBox.width - TRAY_PADDING;
  const position = fitsInRow ? { x: Math.round(rowRight + TRAY_GAP), y: Math.round(rowTop) } : { x: Math.round(frameBox.x + TRAY_PADDING), y: Math.round(bottom + TRAY_ROW_GAP) };
  const frameHeight = Math.max(Math.round(frameBox.height), Math.round(position.y + height + TRAY_PADDING - frameBox.y));
  const nodes = board.nodes.map(node => node.id === card.id ? { ...node, position, style: { ...node.style, width, height } }
    : node.id === frame.id ? { ...node, style: { ...node.style, width: Math.round(frameBox.width), height: frameHeight } } : node);
  const fixed = new Set([card.id, ...board.nodes.filter(node => frameContainsCard(frame, node, measurements)).map(node => node.id)]);
  return { ...board, nodes: pushBelow(board, nodes, frame, frameBox, frameHeight, measurements, fixed) };
}

/** Joining anywhere but the end costs this much on top of the pictures it moves. */
const JOIN_MOVED_COST = .05;
/** Moving every picture already in the tray costs this much (fewer, proportionally): joining should not reshuffle it. */
const REFLOW_MOVED_COST = .3;
/** A tray this much taller or shorter than before costs this much per 100%. */
const REFLOW_GROWTH_COST = .5;

/**
 * Justified rows for `cards` (reading order, the new card last) inside `frame`, at the tray's own row height. The members
 * keep their reading order. Candidates (round 4): only the last row (or two) justified again with the newcomer at its end,
 * the rows above untouched; the whole tray justified again with the newcomer at the end; and the newcomer at each other
 * place (a 1:3 picture cannot go under 80 wide, so in a tray of ~240 rows it needs a row of its own height, and at the end
 * that row was only two thirds full). The layout kept is the one whose last row leaves the least air, unless that costs
 * uneven rows, a much taller or shorter tray, or moving many of the pictures already there.
 */
function reflowRows(board: Board, frame: BoardNode, frameBox: CardBounds, cards: BoardNode[], rowHeights: number[], measurements: CardMeasurements): Board {
  const innerWidth = Math.max(80, frameBox.width - TRAY_PADDING * 2);
  const median = (values: number[]) => { const sorted = [...values].sort((x, y) => x - y); return sorted[Math.floor((sorted.length - 1) / 2)]; };
  const target = Math.min(320, Math.max(120, median(rowHeights)));
  const originX = Math.round(frameBox.x + TRAY_PADDING), originY = Math.round(frameBox.y + TRAY_PADDING);
  const members = readingRows(cards.slice(0, -1).map(node => ({ node, box: getCardBounds(node, measurements) })).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x));
  const joining = cards[cards.length - 1];
  const kept = members.map(({ node, box }) => item(node, ratioOf(node, box)));
  const newcomer = item(joining, ratioOf(joining, getCardBounds(joining, measurements)));
  const innerHeight = Math.max(1, frameBox.height - TRAY_PADDING * 2);
  // Where each member is now, relative to the tray's inner corner, and the rows they form (justifiedRowHeights's rows).
  const current = members.map(({ box }) => ({ x: Math.round(box.x) - originX, y: Math.round(box.y) - originY, width: Math.round(box.width), height: Math.round(box.height) }));
  const rowStarts: number[] = [];
  current.forEach((box, index) => { if (!index || Math.abs(box.y - current[index - 1].y) >= 2) rowStarts.push(index); });

  type Layout = { order: Item[]; boxes: { x: number; y: number; width: number; height: number }[]; height: number };
  const pick: { layout?: Layout; score: number } = { score: Infinity };
  const consider = (layout: Layout, share: number, movedOff: boolean) => {
    const tops = [...new Set(layout.boxes.map(box => box.y))].sort((x, y) => x - y);
    const heights = tops.map(top => layout.boxes.find(box => box.y === top)!.height);
    const lastTop = tops[tops.length - 1];
    const lastRight = Math.max(...layout.boxes.filter(box => box.y === lastTop).map(box => box.x + box.width));
    let moved = 0;
    layout.order.forEach((entry, index) => {
      const at = kept.indexOf(entry);
      if (at < 0) return;
      const was = current[at], now = layout.boxes[index];
      if (Math.abs(was.x - now.x) > 1 || Math.abs(was.y - now.y) > 1 || Math.abs(was.width - now.width) > 1 || Math.abs(was.height - now.height) > 1) moved++;
    });
    const score = (1 - lastRight / innerWidth) + .5 * (Math.max(...heights) / Math.max(1, Math.min(...heights)) - 1) + .2 * Math.abs(1 - share)
      + REFLOW_GROWTH_COST * Math.abs(layout.height / innerHeight - 1) + REFLOW_MOVED_COST * moved / Math.max(1, kept.length) + (movedOff ? JOIN_MOVED_COST : 0);
    if (score < pick.score - 1e-6) { pick.score = score; pick.layout = layout; }
  };
  const shares = [1, .9, 1.1, .8, 1.2];
  // 1. Only the last row (or the last two) again, with the newcomer at the end; the rows above stay where they are.
  for (let tail = 1; tail <= Math.min(2, rowStarts.length); tail++) {
    const from = rowStarts[rowStarts.length - tail];
    const top = current[from].y;
    const tailItems = [...kept.slice(from), newcomer];
    const tailTarget = Math.min(320, Math.max(120, median(rowHeights.slice(-tail))));
    for (const share of shares) {
      const rows = trayRows(tailItems, innerWidth, Math.round(tailTarget * share));
      consider({ order: [...kept.slice(0, from), ...tailItems], boxes: [...current.slice(0, from), ...rows.boxes.map(box => ({ ...box, y: box.y + top }))], height: top + rows.height }, share, false);
    }
  }
  // 2. The whole tray again, the newcomer at the end first, then at every other place.
  for (let at = kept.length; at >= 0; at--) {
    const sequence = [...kept.slice(0, at), newcomer, ...kept.slice(at)];
    for (const share of shares) {
      const rows = trayRows(sequence, innerWidth, Math.round(target * share));
      consider({ order: sequence, boxes: rows.boxes, height: rows.height }, share, at < kept.length);
    }
  }
  // The newcomer at the end is always a candidate with a finite score, so a layout is always picked.
  const layout = pick.layout!;
  const spots = new Map(layout.boxes.map((box, index) => [layout.order[index].node.id, box]));
  const nodes = board.nodes.map(node => {
    const spot = spots.get(node.id);
    if (!spot) return node;
    const limits = getCardSizeLimits(node.data);
    return { ...node, position: { x: originX + spot.x, y: originY + spot.y }, style: { ...node.style, width: Math.max(limits.minWidth, spot.width), height: Math.max(limits.minHeight, spot.height) } };
  });
  const bottom = Math.max(...nodes.filter(node => spots.has(node.id)).map(node => node.position.y + (node.style?.height ?? 0)));
  const frameHeight = Math.max(getCardSizeLimits(frame.data).minHeight, Math.round(bottom + TRAY_PADDING - frameBox.y));
  const arranged = nodes.map(node => node.id === frame.id ? { ...node, style: { ...node.style, width: Math.round(frameBox.width), height: frameHeight } } : node);
  return { ...board, nodes: pushBelow(board, arranged, frame, frameBox, frameHeight, measurements, new Set(cards.map(node => node.id))) };
}
