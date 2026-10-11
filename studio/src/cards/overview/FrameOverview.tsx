import { useCallback } from 'react';
import { useStore, type ReactFlowState } from '@xyflow/react';
import { zoomTier } from '../../canvas/lod';
import { TrayGlyph } from '../FrameCardBody';

/** Screen height of the frame label (§6.15) and the widest label worth checking for room. */
const FRAME_LABEL_H = 26;
const FRAME_LABEL_MAX_W = 240;

/**
 * Whether anything (usually the tray above) occupies the band where the label would sit above this tray.
 * At far zoom a 26px label needs 26 / zoom canvas units, more than the usual 40 between stacked trays; the
 * label then becomes a 20px tab sunk into its own tray's padding instead of sliding under the neighbour's
 * pictures (frames sit below cards, K7).
 * One boolean per frame (K9-7); the selector only runs while the overview is mounted.
 */
export function frameLabelBlocked(state: Pick<ReactFlowState, 'nodeLookup' | 'transform'>, id: string): boolean {
  const self = state.nodeLookup.get(id);
  if (!self) return false;
  const tier = zoomTier(state.transform[2]);
  const { x, y } = self.internals.positionAbsolute;
  const width = Math.min(self.measured?.width ?? self.width ?? 0, FRAME_LABEL_MAX_W / tier);
  const top = y - FRAME_LABEL_H / tier;
  for (const node of state.nodeLookup.values()) {
    if (node.id === id || node.hidden) continue;
    const position = node.internals.positionAbsolute;
    const nodeWidth = node.measured?.width ?? node.width ?? 0, nodeHeight = node.measured?.height ?? node.height ?? 0;
    if (position.x < x + width && position.x + nodeWidth > x && position.y < y && position.y + nodeHeight > top) return true;
  }
  return false;
}

export function FrameOverview({ id, title, frameCount }: { id?: string; title: string; frameCount?: number }) {
  const tight = useStore(useCallback((state: ReactFlowState) => (id ? frameLabelBlocked(state, id) : false), [id]));
  return (
    <div className="field-card__overview field-card__overview--frame card-drag" data-lighttable-preview="tab" aria-hidden="true">
      <div className={`field-card__overview-content${tight ? ' is-tight' : ''}`}>
        <TrayGlyph />
        <h3>{title}</h3>
        {frameCount !== undefined && <span className="field-card__overview-sub">{frameCount} 张</span>}
      </div>
    </div>
  );
}


