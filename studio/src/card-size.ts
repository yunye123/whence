import type { Board, CardData, CardKind } from './model';

/** Persistence, pointer resizing and keyboard resizing use the same ceiling. */
export const MAX_CARD_SIZE = 10_000;

/**
 * Smallest box at which each card still reads (DESIGN_SYSTEM §6.8–6.15). Images follow the picture's own
 * ratio, so a 3:4 picture in a 184px row (138×184) and a 21:9 one in a 72px strip must both fit; text
 * cards keep one line of content plus their head; a frame keeps its label and a small tray.
 */
const MIN_SIZE: Record<CardKind, { width: number; height: number }> = {
  image: { width: 80, height: 60 },
  video: { width: 200, height: 150 },
  quote: { width: 200, height: 88 },
  note: { width: 140, height: 64 },
  draft: { width: 220, height: 160 },
  link: { width: 160, height: 80 },
  frame: { width: 240, height: 160 },
};

export function getCardSizeLimits(data: Pick<CardData, 'kind' | 'videoImport'>) {
  const min = MIN_SIZE[data.kind] ?? MIN_SIZE.note;
  return {
    minWidth: min.width,
    minHeight: min.height,
    maxWidth: MAX_CARD_SIZE,
    maxHeight: MAX_CARD_SIZE,
  };
}

/** Invalid requests leave the board intact; finite requests clamp at its saveable limits. */
export function resizeCard(board: Board, id: string, width: number, height: number): Board {
  const node = board.nodes.find(item => item.id === id);
  if (!node || !Number.isFinite(width) || !Number.isFinite(height)) return board;
  const limits = getCardSizeLimits(node.data);
  const nextWidth = Math.min(limits.maxWidth, Math.max(limits.minWidth, width));
  const nextHeight = Math.min(limits.maxHeight, Math.max(limits.minHeight, height));
  if (node.style?.width === nextWidth && node.style?.height === nextHeight) return board;
  return { ...board, nodes: board.nodes.map(item => item === node
    ? { ...node, style: { ...node.style, width: nextWidth, height: nextHeight } } : item) };
}
