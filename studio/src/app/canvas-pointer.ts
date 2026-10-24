/** Same 4px threshold as card dragging and the card menu's right-click. */
export const POINTER_DRAG_THRESHOLD = 4;

export interface FlowBox { x: number; y: number; width: number; height: number }

export function pointerDragged(dx: number, dy: number, threshold = POINTER_DRAG_THRESHOLD): boolean {
  return Math.hypot(dx, dy) > threshold;
}

/** A card counts only when the whole card sits inside the box. A box inside a card does not. */
export function nodeFullyInside(node: FlowBox, box: FlowBox, epsilon = 0.5): boolean {
  if (node.width <= 0 || node.height <= 0 || box.width <= 0 || box.height <= 0) return false;
  return node.x >= box.x - epsilon && node.y >= box.y - epsilon
    && node.x + node.width <= box.x + box.width + epsilon
    && node.y + node.height <= box.y + box.height + epsilon;
}

export function nodeFlowBox(node: {
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
  style?: { width?: unknown; height?: unknown };
}): FlowBox | null {
  const width = finiteSize(node.measured?.width ?? node.width ?? node.style?.width);
  const height = finiteSize(node.measured?.height ?? node.height ?? node.style?.height);
  if (width === null || height === null) return null;
  return { x: node.position.x, y: node.position.y, width, height };
}

function finiteSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
