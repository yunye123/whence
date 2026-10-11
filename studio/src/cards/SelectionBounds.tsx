import type { CSSProperties } from 'react';
import { ViewportPortal, useStore, type ReactFlowState } from '@xyflow/react';

/**
 * The multiselection outline (§6.8 多选, CD-M7): two or more selected cards get one 1px dashed box
 * (`--selection-ring`, ink, 4 / 4) around all of them, a little outside their ink lines; the cards themselves
 * draw only the ink line. It follows the cards while they move, keeps a screen-constant stroke and gap
 * at every zoom (`--z`), never takes the pointer, and stands aside while a marquee drag is drawing its
 * own rectangle. React Flow's own rectangle after a marquee drag stays as the drag surface, unpainted.
 *
 * One subscription for the whole canvas: the selector walks the node lookup once per store change and
 * returns a string, so nothing re-renders unless the box itself changed (K9-8 keeps cards out of this).
 */
const selectBounds = (state: ReactFlowState): string => {
  if (state.userSelectionActive) return '';
  let count = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of state.nodeLookup.values()) {
    if (!node.selected || node.hidden) continue;
    const width = node.measured?.width ?? node.width ?? 0;
    const height = node.measured?.height ?? node.height ?? 0;
    if (!width || !height) continue;
    const { x, y } = node.internals.positionAbsolute;
    count += 1;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width); maxY = Math.max(maxY, y + height);
  }
  if (count < 2) return '';
  return [minX, minY, maxX - minX, maxY - minY].map(value => Math.round(value * 10) / 10).join(',');
};

export function SelectionBounds() {
  const bounds = useStore(selectBounds);
  if (!bounds) return null;
  const [x, y, width, height] = bounds.split(',').map(Number);
  return (
    <ViewportPortal>
      <svg
        className="field-selection-bounds"
        aria-hidden="true"
        focusable="false"
        style={{ '--bx': x, '--by': y, '--bw': width, '--bh': height } as CSSProperties}
      >
        <rect className="field-selection-bounds__rect" x="0" y="0" width="100%" height="100%" />
      </svg>
    </ViewportPortal>
  );
}
