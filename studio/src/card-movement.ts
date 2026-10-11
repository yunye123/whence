import type { Board, BoardNode } from './model';
import { frameContainsCard, getCardBounds, type CardMeasurements } from './card-placement';

export function movingCardIds(nodes: BoardNode[], ids: string[], measurements: CardMeasurements = {}): Set<string> {
  const result = new Set(ids);
  for (const frame of nodes.filter(node => result.has(node.id) && node.data.kind === 'frame')) for (const child of nodes) if (frameContainsCard(frame, child, measurements)) result.add(child.id);
  return result;
}

export function nudgeCards(board: Board, ids: string[], dx: number, dy: number, measurements: CardMeasurements = {}): Board {
  const moving = movingCardIds(board.nodes, ids, measurements), affected = board.nodes.filter(node => moving.has(node.id));
  if (!affected.length) return board;
  const x = Math.min(10_000_000 - Math.max(...affected.map(node => node.position.x)), Math.max(-10_000_000 - Math.min(...affected.map(node => node.position.x)), dx));
  const y = Math.min(10_000_000 - Math.max(...affected.map(node => node.position.y)), Math.max(-10_000_000 - Math.min(...affected.map(node => node.position.y)), dy));
  if (!x && !y) return board;
  return { ...board, nodes: board.nodes.map(node => moving.has(node.id) ? { ...node, position: { x: node.position.x + x, y: node.position.y + y } } : node) };
}

export type CardAlignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'
  | 'horizontal' | 'vertical' | 'distribute-horizontal' | 'distribute-vertical';

function selectedCards(nodes: BoardNode[], ids: string[]): BoardNode[] {
  const chosen = new Set(ids);
  return nodes.filter(node => chosen.has(node.id) && node.data.kind !== 'frame');
}

function distribution(nodes: BoardNode[], axis: 'horizontal' | 'vertical', measurements: CardMeasurements): { ordered: BoardNode[]; coordinate: 'x' | 'y'; size: 'width' | 'height'; gap: number } | undefined {
  const coordinate = axis === 'horizontal' ? 'x' : 'y', size = axis === 'horizontal' ? 'width' : 'height';
  const ordered = [...nodes].sort((a, b) => a.position[coordinate] - b.position[coordinate]);
  if (ordered.length < 3) return undefined;
  const occupied = ordered.slice(0, -1).reduce((sum, node) => sum + getCardBounds(node, measurements)[size], 0);
  const remaining = ordered.at(-1)!.position[coordinate] - ordered[0].position[coordinate] - occupied;
  if (remaining < -0.000_001) return undefined;
  return { ordered, coordinate, size, gap: Math.max(0, remaining / (ordered.length - 1)) };
}

/** Equal outer gaps keep the first and last cards fixed and never overlap. */
export function canDistributeCards(nodes: BoardNode[], ids: string[], axis: 'horizontal' | 'vertical', measurements: CardMeasurements = {}): boolean {
  return !!distribution(selectedCards(nodes, ids), axis, measurements);
}

function commitPositions(board: Board, positions: Map<string, { x: number; y: number }>): Board {
  const points = [...positions.values()];
  if (!points.length || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return board;
  for (const axis of ['x', 'y'] as const) {
    const min = Math.min(...points.map(point => point[axis])), max = Math.max(...points.map(point => point[axis]));
    if (max - min > 20_000_000) return board;
    const offset = Math.min(10_000_000 - max, Math.max(-10_000_000 - min, 0));
    if (offset) for (const point of points) point[axis] += offset;
  }
  let changed = false;
  const nodes = board.nodes.map(node => {
    const position = positions.get(node.id);
    if (!position || (position.x === node.position.x && position.y === node.position.y)) return node;
    changed = true;
    return { ...node, position };
  });
  return changed ? { ...board, nodes } : board;
}

export function alignCards(board: Board, ids: string[], mode: CardAlignment, measurements: CardMeasurements = {}): Board {
  const chosen = selectedCards(board.nodes, ids);
  if (chosen.length < 2) return board;
  const bounds = chosen.map(node => getCardBounds(node, measurements));
  const left = Math.min(...bounds.map(box => box.x)), top = Math.min(...bounds.map(box => box.y));
  const right = Math.max(...bounds.map(box => box.x + box.width)), bottom = Math.max(...bounds.map(box => box.y + box.height));
  const positions = new Map<string, { x: number; y: number }>();

  if (mode === 'distribute-horizontal' || mode === 'distribute-vertical') {
    const layout = distribution(chosen, mode === 'distribute-horizontal' ? 'horizontal' : 'vertical', measurements);
    if (!layout) return board;
    let cursor = layout.ordered[0].position[layout.coordinate];
    for (const [index, node] of layout.ordered.entries()) {
      // Keep both endpoints exact rather than accumulating a floating point error.
      positions.set(node.id, { ...node.position, [layout.coordinate]: index === layout.ordered.length - 1 ? node.position[layout.coordinate] : cursor });
      cursor += getCardBounds(node, measurements)[layout.size] + layout.gap;
    }
  } else if (mode === 'horizontal' || mode === 'vertical') {
    const ordered = [...chosen].sort((a, b) => mode === 'horizontal' ? a.position.x - b.position.x : a.position.y - b.position.y);
    let cursor = mode === 'horizontal' ? left : top;
    for (const node of ordered) {
      positions.set(node.id, { x: mode === 'horizontal' ? cursor : left, y: mode === 'vertical' ? cursor : top });
      const box = getCardBounds(node, measurements);
      cursor += (mode === 'horizontal' ? box.width : box.height) + 32;
    }
  } else {
    for (const node of chosen) {
      const box = getCardBounds(node, measurements);
      positions.set(node.id, {
        x: mode === 'left' ? left : mode === 'right' ? right - box.width : mode === 'center-x' ? (left + right - box.width) / 2 : node.position.x,
        y: mode === 'top' ? top : mode === 'bottom' ? bottom - box.height : mode === 'center-y' ? (top + bottom - box.height) / 2 : node.position.y,
      });
    }
  }
  return commitPositions(board, positions);
}
