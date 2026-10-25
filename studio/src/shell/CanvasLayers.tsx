import { useEffect, useState } from 'react';
import { useStore, type ReactFlowState } from '@xyflow/react';
import SnapGuides from '../SnapGuides';
import type { SnapGuide } from '../card-snap';
import type { ResolvedTheme } from '../app/types';

/** The first-run hint is shown once per session and leaves after the first touch of the canvas or 12s. */
let hintSeen = false;
const HINT_MS = 12_000;
/** In App, connecting is allowed exactly when the window is editable and the select tool is active. */
const canWriteSelector = (state: ReactFlowState) => state.nodesConnectable;

/** The rail renders this hint outside ReactFlow, inside its shared provider. */
export function CanvasHint({ readOnly = false }: { readOnly?: boolean }) {
  const canWrite = useStore(canWriteSelector) && !readOnly;
  const [hint, setHint] = useState(!hintSeen);
  useEffect(() => {
    if (!hint) return;
    hintSeen = true;
    const dismiss = () => setHint(false);
    const timer = window.setTimeout(dismiss, HINT_MS);
    const pane = (event: Event) => { if (event.target instanceof Element && event.target.closest('.react-flow')) dismiss(); };
    window.addEventListener('pointerdown', pane, true);
    window.addEventListener('wheel', pane, { capture: true, passive: true });
    return () => { window.clearTimeout(timer); window.removeEventListener('pointerdown', pane, true); window.removeEventListener('wheel', pane, true); };
  }, [hint]);
  return hint ? <p className="canvas-hint"><span>右键拖动画布，或按住<kbd>空格</kbd>再用左键</span>{canWrite && <span>双击空白处写笔记</span>}</p> : null;
}

/** Only snap guides stay inside ReactFlow. Keep optional legacy props compatible with existing App calls. */
export default function CanvasLayers({ guides }: { guides: SnapGuide[]; theme?: ResolvedTheme; readOnly?: boolean }) {
  return <SnapGuides guides={guides}/>;
}
