/**
 * 给连线写标签（EG-M3、FC-08）：保存在画布里的连线（我画的关系、摘录线）可以加、改、清空标签；派生引用线只读。
 *
 * 写回走 React Flow 的 `replace` 变更：App 的 onEdgesChange 把它交给 applyEdgeChanges → changeBoard，所以和删除连线
 * 一样进撤销历史、过存储校验。替换进去的对象只带存储字段（K1：`{ id, source, target, label?, type? }`），
 * 画法、选中、读屏名这些只属于 React Flow 的字段一概不写进存储。
 */
import type { Edge } from '@xyflow/react';
import type { BoardEdge } from '../../model';

/** 与存储校验一致（storage.ts：连线标签最多 500 字）。 */
export const EDGE_LABEL_MAX = 500;

/** 写好标签后的那条连线（只有存储字段）；文字没变时返回 null。空白 = 去掉标签。 */
export function labelledEdge(edge: Pick<Edge, 'id' | 'source' | 'target' | 'type' | 'label'>, text: string): BoardEdge | null {
  const next = text.replace(/\s+/g, ' ').trim().slice(0, EDGE_LABEL_MAX);
  const current = typeof edge.label === 'string' ? edge.label : '';
  if (next === current) return null;
  const item: BoardEdge = { id: edge.id, source: edge.source, target: edge.target };
  if (edge.type !== undefined) item.type = edge.type;
  if (next) item.label = next;
  return item;
}

// ── 哪条线的标签框开着（同一时刻只有一个；标签框画在另一个 DOM 子树里，靠这个小 store 通知） ──────────

let editing: string | null = null;
const listeners = new Set<() => void>();
export const getEditingEdge = (): string | null => editing;
export function setEditingEdge(id: string | null): void {
  if (editing === id) return;
  editing = id;
  for (const listener of [...listeners]) listener();
}
export function subscribeEditing(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// ── 刚连出来的线：建好后弹出可以不填的标签框（EG-M2“建好后可选弹出标签输入”） ─────────────────────────

/** 松手后这么久之内出现的新线才算这次连出来的。 */
export const FRESH_EDGE_MS = 1500;

export interface ConnectionTracker {
  /** 开始拖连线：记下起点卡和此刻已有的线。 */
  start(from: string, edgeIds: Iterable<string>): void;
  /** 松手（连上或取消）。 */
  end(): void;
  /** 这条线是不是这次拖出来的：开始时还没有、连着起点卡、松手不久。每次拖动只认领一次。 */
  claim(id: string, source: string, target: string): boolean;
}

export function createConnectionTracker(now: () => number = () => performance.now()): ConnectionTracker {
  let pending: { from: string; known: Set<string>; endedAt?: number } | null = null;
  return {
    start(from, edgeIds) { pending = { from, known: new Set(edgeIds) }; },
    end() { if (pending && pending.endedAt === undefined) pending.endedAt = now(); },
    claim(id, source, target) {
      const current = pending;
      if (!current || current.known.has(id)) return false;
      if (current.endedAt !== undefined && now() - current.endedAt > FRESH_EDGE_MS) { pending = null; return false; }
      if (current.from !== source && current.from !== target) return false;
      pending = null;
      return true;
    },
  };
}

export const connectionTracker = createConnectionTracker();
