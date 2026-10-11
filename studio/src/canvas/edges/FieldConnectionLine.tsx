import { useEffect } from 'react';
import { useStore, useStoreApi, type ConnectionLineComponentProps, type InternalNode, type ReactFlowState } from '@xyflow/react';
import { chooseSide, inkRoute, oppositeSide, sidePoint, type Box, type Point, type Side } from './geometry';
import { connectionTracker } from './label-edit';

const selectLookup = (state: ReactFlowState) => state.nodeLookup;

const nodeBox = (node: InternalNode): Box => ({
  x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y,
  width: node.measured?.width ?? node.width ?? 0, height: node.measured?.height ?? node.height ?? 0,
});
const isFrame = (node: InternalNode) => (node.data as { kind?: string } | undefined)?.kind === 'frame';

/** 指针所在的卡片（最上面的那张；分组托盘不是落点）。 */
export function cardAtPoint(lookup: ReadonlyMap<string, InternalNode>, point: Point, excludeId?: string): InternalNode | null {
  let best: InternalNode | null = null;
  for (const node of lookup.values()) {
    if (node.id === excludeId || node.hidden || isFrame(node)) continue;
    const box = nodeBox(node);
    if (!box.width || !box.height) continue;
    if (point.x < box.x || point.x > box.x + box.width || point.y < box.y || point.y > box.y + box.height) continue;
    if (!best || node.internals.z >= best.internals.z) best = node;
  }
  return best;
}

const positionSide = (position: string): Side => (position === 'left' || position === 'right' || position === 'top' || position === 'bottom' ? position : 'right');

/**
 * 建立连线时的预览（EG-M2）：整张卡都是落点。指针在某张卡上时，那张卡显示 1.5px 虚线墨框，
 * 预览线直接画成松手后的样子（卡边中点到卡边中点）；在空白处时线跟着指针。
 */
export function FieldConnectionLine({ fromNode, fromX, fromY, fromPosition, toX, toY, toNode }: ConnectionLineComponentProps) {
  const lookup = useStore(selectLookup);
  const store = useStoreApi();
  const fromId = fromNode.id;
  // The preview lives exactly as long as the drag: note which threads existed, so the one this drag creates can
  // open its (optional) label box when it appears (FieldEdge, EG-M3).
  useEffect(() => {
    connectionTracker.start(fromId, store.getState().edges.map(edge => edge.id));
    return () => connectionTracker.end();
  }, [fromId, store]);
  const hovered = toNode && toNode.id !== fromNode.id && !isFrame(toNode) ? toNode : cardAtPoint(lookup, { x: toX, y: toY }, fromNode.id);
  let start: Point, end: Point, startSide: Side, endSide: Side;
  let target: Box | null = null;
  if (hovered) {
    const from = nodeBox(fromNode);
    target = nodeBox(hovered);
    startSide = chooseSide(from, target);
    endSide = oppositeSide[startSide];
    start = sidePoint(from, startSide);
    end = sidePoint(target, endSide);
  } else {
    start = { x: fromX, y: fromY };
    startSide = positionSide(fromPosition);
    end = { x: toX, y: toY };
    endSide = Math.abs(toX - fromX) >= Math.abs(toY - fromY) ? (toX >= fromX ? 'left' : 'right') : (toY >= fromY ? 'top' : 'bottom');
  }
  const { d } = inkRoute(start, startSide, end, endSide);
  return (
    <g className={`field-connection${hovered ? ' is-over' : ''}`}>
      {target && <rect className="field-connection__target" x={target.x - 5} y={target.y - 5} width={target.width + 10} height={target.height + 10} rx={5} />}
      <path className="field-connection__line" d={d} />
      <circle className="field-connection__start" cx={start.x} cy={start.y} r={2.4} />
      <circle className="field-connection__end" cx={end.x} cy={end.y} r={2.4} />
    </g>
  );
}
