import type { BoardNode } from './model';
import { getCardBounds, type CardBounds, type CardMeasurements } from './card-placement';

export interface SnapGuide {
  /** x is a vertical guide; y is a horizontal guide, in canvas coordinates. */
  axis: 'x' | 'y';
  position: number;
  from: number;
  to: number;
  referenceId: string;
  feature: 'start' | 'center' | 'end';
}

export interface CardSnapOptions {
  zoom?: number;
  thresholdPx?: number;
  maxOrthogonalGapPx?: number;
  bypass?: boolean;
  /** Optional visible references; omitted means every nearby ordinary card. */
  referenceIds?: readonly string[];
  /** Session-only visible geometry; resizing and tray membership stay raw. */
  getBounds?: (node: BoardNode, measurements: CardMeasurements) => CardBounds;
}

export interface CardSnapResult { dx: number; dy: number; guides: SnapGuide[] }

const COORDINATE_LIMIT = 10_000_000;
const EMPTY = (): CardSnapResult => ({ dx: 0, dy: 0, guides: [] });
const FEATURES = ['start', 'center', 'end'] as const;

function aggregateBounds(bounds: CardBounds[]): CardBounds {
  const x = Math.min(...bounds.map(box => box.x)), y = Math.min(...bounds.map(box => box.y));
  return { x, y, width: Math.max(...bounds.map(box => box.x + box.width)) - x, height: Math.max(...bounds.map(box => box.y + box.height)) - y };
}

function intervalGap(a: number, aEnd: number, b: number, bEnd: number): number {
  return Math.max(0, b - aEnd, a - bEnd);
}

function featurePosition(box: CardBounds, axis: 'x' | 'y', feature: typeof FEATURES[number]): number {
  const size = axis === 'x' ? box.width : box.height;
  return box[axis] + (feature === 'start' ? 0 : feature === 'center' ? size / 2 : size);
}

/**
 * Resolve a whole drag group's offset, using the already moved node positions.
 * The caller supplies every actual moving ID, including a frame's contents,
 * and applies the returned offset to those IDs exactly once.
 */
export function snapCards(nodes: BoardNode[], movingIds: readonly string[], measurements: CardMeasurements = {}, options: CardSnapOptions = {}): CardSnapResult {
  if (options.bypass || !movingIds.length) return EMPTY();
  const zoom = Number.isFinite(options.zoom) && options.zoom! > 0 ? options.zoom! : 1;
  const threshold = (Number.isFinite(options.thresholdPx) && options.thresholdPx! >= 0 ? Math.min(24, options.thresholdPx!) : 6) / zoom;
  const orthogonalGap = (Number.isFinite(options.maxOrthogonalGapPx) && options.maxOrthogonalGapPx! >= 0 ? options.maxOrthogonalGapPx! : 160) / zoom;
  const moving = new Set(movingIds);
  const moved = nodes.filter(node => moving.has(node.id));
  if (!moved.length || moved.some(node => !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))) return EMPTY();
  const bounds = options.getBounds ?? getCardBounds;
  const group = aggregateBounds(moved.map(node => bounds(node, measurements)));
  const references = options.referenceIds ? new Set(options.referenceIds) : undefined;
  const candidates = nodes.filter(node => !moving.has(node.id) && node.data.kind !== 'frame'
    && (!references || references.has(node.id)) && Number.isFinite(node.position.x) && Number.isFinite(node.position.y));
  const winners: Partial<Record<'x' | 'y', { distance: number; offset: number; guide: SnapGuide; rank: number }>> = {};

  for (const node of candidates) {
    const reference = bounds(node, measurements);
    for (const axis of ['x', 'y'] as const) {
      const other = axis === 'x' ? 'y' : 'x';
      const otherSize = other === 'x' ? 'width' : 'height';
      if (intervalGap(group[other], group[other] + group[otherSize], reference[other], reference[other] + reference[otherSize]) > orthogonalGap) continue;
      for (const [rank, feature] of FEATURES.entries()) {
        const target = featurePosition(reference, axis, feature);
        const offset = target - featurePosition(group, axis, feature);
        const distance = Math.abs(offset);
        if (distance > threshold || moved.some(item => Math.abs(item.position[axis] + offset) > COORDINATE_LIMIT)) continue;
        const current = winners[axis];
        // Stable ID and feature ordering prevents guide flicker at equal distances.
        if (current && (distance > current.distance || (distance === current.distance
          && (rank > current.rank || (rank === current.rank && node.id.localeCompare(current.guide.referenceId) >= 0))))) continue;
        const padding = 12 / zoom;
        winners[axis] = { distance, offset, rank, guide: {
          axis, position: target, from: Math.min(group[other], reference[other]) - padding,
          to: Math.max(group[other] + group[otherSize], reference[other] + reference[otherSize]) + padding,
          referenceId: node.id, feature,
        } };
      }
    }
  }

  return { dx: winners.x?.offset ?? 0, dy: winners.y?.offset ?? 0,
    guides: [winners.x?.guide, winners.y?.guide].filter((guide): guide is SnapGuide => !!guide) };
}
