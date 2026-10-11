import type { BoardNode } from '../model';
import { getCardBounds, type CardBounds, type CardMeasurements } from '../card-placement';
import type { CardLod } from '../cards/types';

/** Session-only geometry; never add these 24 pixels to measurements or stored sizes. */
export const PHOTO_CAPTION_HEIGHT = 24;
export const CAPTION_ROW_GAP = 22;
const CELL = 200;

export interface CaptionFlag {
  readonly inTray: boolean;
  readonly tightCaption: boolean;
  /** Smallest containing tray owns the display number; all raw memberships remain intact. */
  readonly frameId?: string;
  readonly printNumber?: string;
}
export interface CaptionRules {
  readonly flags: ReadonlyMap<string, CaptionFlag>;
  /** Eligible to show at full LOD. Hover-only captions and simple/far captions are excluded. */
  readonly captionIds: ReadonlySet<string>;
  readonly printNumbers: ReadonlyMap<string, string>;
  readonly frameMembers: ReadonlyMap<string, readonly string[]>;
}
export interface CaptionRowEntry { readonly id: string; readonly box: CardBounds }

/** PLAN §2.4②: tops less than half the shorter height apart share a row; row then reads left to right.
 * The earliest top and shortest height anchor a row, preventing a chain of staggered cards joining distant rows.
 * Id breaks exact geometry ties, so board array order does not renumber a tray. No input is sorted in place. */
export function captionReadingRows<T extends CaptionRowEntry>(entries: readonly T[]): T[][] {
  const sorted = [...entries].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x || a.id.localeCompare(b.id));
  const rows: T[][] = [];
  let top = 0, shortest = 0;
  for (const entry of sorted) {
    const row = rows[rows.length - 1];
    if (!row || entry.box.y - top >= Math.min(shortest, entry.box.height) / 2) {
      rows.push([entry]); top = entry.box.y; shortest = entry.box.height;
    } else { row.push(entry); shortest = Math.min(shortest, entry.box.height); }
  }
  return rows.map(row => row.sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y || a.id.localeCompare(b.id)));
}

const overlaps = (a: CardBounds, b: CardBounds) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
const contains = (a: CardBounds, b: CardBounds) => b.x >= a.x && b.y >= a.y
  && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;

/** 200px grid, with a bounded overflow list for exceptionally large legacy boxes. No camera or DOM inputs. */
function spatialIndex(entries: readonly CaptionRowEntry[]) {
  const buckets = new Map<string, CaptionRowEntry[]>(), large: CaptionRowEntry[] = [];
  const keys = (box: CardBounds): string[] | null => {
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return [];
    const x0 = Math.floor(box.x / CELL), x1 = Math.floor((box.x + box.width) / CELL);
    const y0 = Math.floor(box.y / CELL), y1 = Math.floor((box.y + box.height) / CELL);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 8192) return null;
    const result: string[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) result.push(`${x}:${y}`);
    return result;
  };
  for (const entry of entries) {
    const cells = keys(entry.box);
    if (!cells) { large.push(entry); continue; }
    for (const key of cells) { const bucket = buckets.get(key); if (bucket) bucket.push(entry); else buckets.set(key, [entry]); }
  }
  return (box: CardBounds): CaptionRowEntry[] => {
    const cells = keys(box);
    if (!cells) return [...entries];
    const neighbours = new Set(large);
    for (const key of cells) for (const entry of buckets.get(key) ?? []) neighbours.add(entry);
    return [...neighbours];
  };
}

/** Calculate once per board nodes / measurements / learned-image-ratio version (main's useMemo).
 * Only raw image bounds decide membership. No persistent fields, viewport subscriptions or DOM reads.
 * A tray with any adjacent-row gap <22 keeps all its captions hover-only. Every eligible caption also
 * checks outsiders and same-row overlaps, so old trays/free photos never silently cover another card.
 * The 20px proximity rule is extended to the actual 24px free caption box's last 4px to prevent ink overlap. */
export function captionRules(nodes: readonly BoardNode[], measurements: CardMeasurements = {}): CaptionRules {
  const entries = nodes.map(node => ({ id: node.id, node, box: getCardBounds(node, measurements) }));
  const frames = entries.filter(e => e.node.data.kind === 'frame');
  const cards = entries.filter(e => e.node.data.kind !== 'frame');
  const nearbyFrames = spatialIndex(frames), nearbyCards = spatialIndex(cards);
  const membership = new Map<string, typeof frames>();
  const members = new Map(frames.map(f => [f.id, [] as typeof cards]));
  for (const card of cards) {
    const inside = nearbyFrames(card.box).filter(f => contains(f.box, card.box)) as typeof frames;
    inside.sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height || a.id.localeCompare(b.id));
    membership.set(card.id, inside);
    for (const f of inside) members.get(f.id)!.push(card);
  }
  const tightFrames = new Set<string>(), printNumbers = new Map<string, string>();
  // Independent numbers in each table; for overlapping tables the smallest one wins the display number.
  for (const f of [...frames].sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height || a.id.localeCompare(b.id))) {
    const inside = members.get(f.id)!;
    const rows = captionReadingRows(inside);
    for (let i = 1; i < rows.length; i++) {
      const bottom = Math.max(...rows[i - 1].map(e => e.box.y + e.box.height));
      if (Math.min(...rows[i].map(e => e.box.y)) - bottom < CAPTION_ROW_GAP) tightFrames.add(f.id);
    }
    const pictures = captionReadingRows(inside.filter(e => e.node.data.kind === 'image')).flat();
    pictures.forEach((picture, index) => {
      if (membership.get(picture.id)?.[0]?.id === f.id) printNumbers.set(picture.id, String(index + 1).padStart(2, '0'));
    });
  }
  const flags = new Map<string, CaptionFlag>(), captionIds = new Set<string>();
  for (const entry of entries) {
    const inFrames = membership.get(entry.id) ?? [];
    let tightCaption = false;
    if (entry.node.data.kind === 'image') {
      const band = { ...entry.box, y: entry.box.y + entry.box.height, height: inFrames.length ? 20 : PHOTO_CAPTION_HEIGHT };
      tightCaption = inFrames.some(f => tightFrames.has(f.id))
        || nearbyCards(band).some(other => other.id !== entry.id && overlaps(band, other.box));
      if (!tightCaption) captionIds.add(entry.id);
    }
    flags.set(entry.id, Object.freeze({ inTray: inFrames.length > 0, tightCaption,
      frameId: inFrames[0]?.id, printNumber: printNumbers.get(entry.id) }));
  }
  return { flags, captionIds, printNumbers, frameMembers: new Map([...members].map(([id, entries]) => [id, entries.map(e => e.id)])) };
}

/** Geometry for viewport fit/start/reveal, selected bbox, snap and obstacle avoidance.
 * Membership, resizing and raw ratio probes must continue using getCardBounds / frameContainsCard.
 * Low LOD hides captions: pass its discrete enum to omit them; never pass a continuously changing zoom.
 * A temporary hover caption is deliberately excluded. */
export function getVisibleCardBounds(node: BoardNode, measurements: CardMeasurements = {}, captionIds: ReadonlySet<string> = new Set(), lod: CardLod = 'full'): CardBounds {
  const raw = getCardBounds(node, measurements);
  return node.data.kind === 'image' && lod === 'full' && captionIds.has(node.id)
    ? { ...raw, height: raw.height + PHOTO_CAPTION_HEIGHT } : raw;
}
