/**
 * App 交给 React Flow 的 edges：已保存连线 + 派生引用线，带画法、选中、强调与中文读屏名称。
 * 派生线只存在于这里，不进入 board.edges（不保存、不进撤销历史）。
 */
import { useMemo, useRef } from 'react';
import { setAnchorBoard } from './anchors';
import type { Edge, EdgeChange } from '@xyflow/react';
import type { Board } from '../../model';
import { edgeAriaLabel, edgeEmphasis, fieldEdgeRecords, isDerivedEdgeId, type FieldEdgeData } from './model';

export type FieldFlowEdge = Edge<FieldEdgeData>;

/** 派生引用线的读屏说明（只读，随文稿里的引用出现和消失）。 */
export const DERIVED_DESCRIPTION = '由文稿里的引用生成，只读；删除文稿中的这处引用后自动消失。';

export function buildFlowEdges(board: Pick<Board, 'nodes' | 'edges'> | null | undefined, selectedNodeIds: readonly string[] = [], selectedEdgeIds: readonly string[] = []): FieldFlowEdge[] {
  if (!board) return [];
  const records = fieldEdgeRecords(board);
  const emphasis = edgeEmphasis(records, selectedNodeIds);
  const byId = new Map(board.nodes.map(node => [node.id, node] as const));
  const selectedEdges = new Set(selectedEdgeIds);
  return records.map(record => {
    const tone = emphasis.get(record.id);
    const data: FieldEdgeData = tone ? { ...record.data, emphasis: tone } : record.data;
    const edge: FieldFlowEdge = {
      id: record.id,
      source: record.source,
      target: record.target,
      data,
      selected: selectedEdges.has(record.id),
      ariaLabel: edgeAriaLabel(record.data, byId),
      className: ['field-edge', `field-edge--${record.data.kind}`, tone && `is-${tone}`, record.data.derived && 'is-derived'].filter(Boolean).join(' '),
    };
    if (record.type !== undefined) edge.type = record.type;
    if (record.label !== undefined) edge.label = record.label;
    if (record.data.derived) {
      edge.selectable = false; edge.deletable = false; edge.focusable = true;
      // The shared React Flow hint says “Enter to select, Delete to remove”, which does not apply here.
      edge.domAttributes = { 'aria-describedby': undefined, 'aria-description': DERIVED_DESCRIPTION };
    }
    return edge;
  });
}

const sameData = (a: FieldEdgeData | undefined, b: FieldEdgeData | undefined) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
};
const sameEdge = (a: FieldFlowEdge, b: FieldFlowEdge) => a.source === b.source && a.target === b.target && a.type === b.type
  && a.label === b.label && a.selected === b.selected && a.ariaLabel === b.ariaLabel && a.className === b.className
  && a.selectable === b.selectable && !!a.domAttributes === !!b.domAttributes && sameData(a.data, b.data);

/**
 * `buildFlowEdges` 的 memo 版：拖动卡片时卡片数组每帧都变，但连线的画法通常不变，
 * 这里复用上一帧的边对象（全部不变时复用整个数组），React Flow 不必重画所有线。
 */
export function useFieldFlowEdges(board: Pick<Board, 'id' | 'nodes' | 'edges'> | null | undefined, selectedNodeIds: readonly string[], selectedEdgeIds: readonly string[]): FieldFlowEdge[] {
  const previous = useRef<{ boardId?: string; edges: FieldFlowEdge[] }>({ edges: [] });
  return useMemo(() => {
    setAnchorBoard(board?.id);
    const next = buildFlowEdges(board, selectedNodeIds, selectedEdgeIds);
    const last = previous.current.boardId === board?.id ? previous.current.edges : [];
    const lastById = new Map(last.map(edge => [edge.id, edge] as const));
    let changed = next.length !== last.length;
    const merged = next.map((edge, index) => {
      const old = lastById.get(edge.id);
      if (old && sameEdge(old, edge)) { if (last[index] !== old) changed = true; return old; }
      changed = true;
      return edge;
    });
    const result = changed ? merged : last;
    previous.current = { boardId: board?.id, edges: result };
    return result;
    // board.nodes changes identity on every drag frame; the structural sharing above absorbs that.
  }, [board?.id, board?.nodes, board?.edges, selectedNodeIds, selectedEdgeIds]);
}

/** onEdgesChange 里派生线的变化（选中以外）一律丢弃：派生线不在 board.edges 里。 */
export function storedEdgeChanges<T extends EdgeChange>(changes: readonly T[]): T[] {
  return changes.filter(change => !('id' in change) || !isDerivedEdgeId(change.id));
}
