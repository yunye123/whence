import { useViewport } from '@xyflow/react';
import type { SnapGuide } from './card-snap';

export default function SnapGuides({guides}: {guides: SnapGuide[]}) {
  const {x, y, zoom} = useViewport();
  if (!guides.length) return null;
  return <svg className="snap-guides" data-testid="snap-guides" aria-hidden="true">
    {guides.map(guide => <line key={guide.axis} data-axis={guide.axis}
      x1={(guide.axis === 'x' ? guide.position : guide.from) * zoom + x}
      x2={(guide.axis === 'x' ? guide.position : guide.to) * zoom + x}
      y1={(guide.axis === 'y' ? guide.position : guide.from) * zoom + y}
      y2={(guide.axis === 'y' ? guide.position : guide.to) * zoom + y}/>)}
  </svg>;
}
