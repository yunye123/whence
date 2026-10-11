import type { ReactNode } from 'react';
import { CanvasHint } from './CanvasLayers';

export interface CanvasRailProps {
  tools: ReactNode;
  navigation: ReactNode;
  readOnly?: boolean;
}

/** A 48px layout row, outside the measured .flow-container. Never register this row as an overlay. */
export default function CanvasRail({ tools, navigation, readOnly }: CanvasRailProps) {
  return <div className="canvas-rail">
    <div className="canvas-rail__tools">{tools}</div>
    <div className="canvas-rail__hint"><CanvasHint readOnly={readOnly}/></div>
    <div className="canvas-rail__navigation">{navigation}</div>
  </div>;
}
