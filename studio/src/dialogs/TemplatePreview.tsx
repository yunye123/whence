import { memo, useMemo } from 'react';
import type { BoardNode, TemplateId } from '../model';
import { createBoard } from '../templates';

/** Estimated on-canvas heights for cards that only store a width (DESIGN_SYSTEM §6.9–6.14). */
const ESTIMATED_HEIGHT: Record<BoardNode['data']['kind'], number> = { video: 250, image: 200, note: 170, quote: 150, draft: 240, link: 140, frame: 300 };
const PAD = 36;

type Box = { id: string; kind: BoardNode['data']['kind']; x: number; y: number; w: number; h: number; title: string };

function layout(template: TemplateId): { boxes: Box[]; view: [number, number, number, number] } {
  const nodes = createBoard(template).nodes;
  if (!nodes.length) return { boxes: [], view: [0, 0, 440, 280] };
  const boxes = nodes.map(node => ({
    id: node.id, kind: node.data.kind, title: node.data.title,
    x: node.position.x, y: node.position.y,
    w: node.style?.width ?? 290, h: node.style?.height ?? ESTIMATED_HEIGHT[node.data.kind],
  }));
  const left = Math.min(...boxes.map(box => box.x)) - PAD, top = Math.min(...boxes.map(box => box.y)) - PAD;
  const right = Math.max(...boxes.map(box => box.x + box.w)) + PAD, bottom = Math.max(...boxes.map(box => box.y + box.h)) + PAD;
  // 预览框是 16:10；内容按比例放进去，空出的一边留给画布地面。
  let width = right - left, height = bottom - top;
  const ratio = 1.6;
  let x = left, y = top;
  if (width / height > ratio) { const next = width / ratio; y -= (next - height) / 2; height = next; }
  else { const next = height * ratio; x -= (next - width) / 2; width = next; }
  return { boxes, view: [x, y, width, height] };
}

function Lines({ box, count, inset = 22, gap = 26, first = .7 }: { box: Box; count: number; inset?: number; gap?: number; first?: number }) {
  return <>{Array.from({ length: count }, (_, index) => {
    const width = (box.w - inset * 2) * (index === 0 ? first : index === count - 1 ? .55 : .9);
    return <rect key={index} className={index === 0 ? 'tp-line tp-line--head' : 'tp-line'} x={box.x + inset} y={box.y + inset + index * gap} width={width} height={index === 0 ? 12 : 9} rx={2}/>;
  })}</>;
}

function Card({ box }: { box: Box }) {
  const { x, y, w, h } = box;
  switch (box.kind) {
    case 'frame':
      return <g><rect className="tp-frame" x={x} y={y} width={w} height={h} rx={3}/><rect className="tp-frame-label" x={x + 14} y={y + 14} width={Math.min(84, w * .3)} height={12} rx={2}/></g>;
    case 'video':
      return <g><rect className="tp-surface" x={x} y={y} width={w} height={h} rx={4}/><rect className="tp-poster" x={x} y={y} width={w} height={h * .62} rx={4}/><path className="tp-play" d={`M${x + 26} ${y + h * .62 - 44}l22 13-22 13z`}/>
        {Array.from({ length: 14 }, (_, index) => <rect key={index} className={index === 5 || index === 6 ? 'tp-tick tp-tick--used' : 'tp-tick'} x={x + 18 + index * ((w - 36) / 14)} y={y + h * .62 + 14} width={(w - 36) / 14 - 3} height={6} rx={1}/>)}
        <rect className="tp-line tp-line--head" x={x + 18} y={y + h * .62 + 38} width={w * .55} height={12} rx={2}/></g>;
    case 'note':
      return <g><rect className="tp-note" x={x} y={y} width={w} height={h} rx={2}/><Lines box={box} count={4} first={.62}/></g>;
    case 'draft':
      return <g><rect className="tp-paper" x={x} y={y} width={w} height={h} rx={2}/><Lines box={box} count={6} first={.5}/></g>;
    case 'image':
      return <rect className="tp-image" x={x} y={y} width={w} height={h} rx={2}/>;
    case 'quote':
      return <g><rect className="tp-surface" x={x} y={y} width={w} height={h} rx={2}/><path className="tp-rule" d={`M${x} ${y + 2}h${w}`}/><Lines box={{ ...box, y: box.y + 20 }} count={3}/></g>;
    default:
      return <g><rect className="tp-jacket" x={x} y={y} width={w} height={h} rx={2}/><Lines box={box} count={3}/></g>;
  }
}

/** “模板预览画出真实布局”（F-m1）：直接按 createBoard 的坐标与尺寸缩小绘制，不画示意图标。 */
function TemplatePreview({ template }: { template: TemplateId }) {
  const { boxes, view } = useMemo(() => layout(template), [template]);
  return (
    <svg className="nb-preview" viewBox={view.join(' ')} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={`tp-dots-${template}`} x={view[0]} y={view[1]} width={48} height={48} patternUnits="userSpaceOnUse"><circle className="tp-dot" cx={24} cy={24} r={2.6}/></pattern>
      </defs>
      <rect x={view[0]} y={view[1]} width={view[2]} height={view[3]} fill={`url(#tp-dots-${template})`}/>
      {boxes.length
        ? boxes.map(box => <Card key={box.id} box={box}/>)
        : <g className="tp-blank"><rect x={view[0] + view[2] / 2 - 70} y={view[1] + view[3] / 2 - 46} width={140} height={92} rx={3}/><path d={`M${view[0] + view[2] / 2} ${view[1] + view[3] / 2 - 14}v28M${view[0] + view[2] / 2 - 14} ${view[1] + view[3] / 2}h28`}/></g>}
    </svg>
  );
}

export default memo(TemplatePreview);
