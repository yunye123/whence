/**
 * 连线落点（EG-M2）：松手时没有吸附到连接点，也照样连到指针下的那张卡；落在空白处给出提示。
 * 由 App 的 onConnectEnd 调用；吸附到连接点的情况 React Flow 已经触发了 onConnect，这里不重复。
 */
import type { CardKind } from '../../model';

export const CONNECT_HINT = '拖到另一张卡片上即可连接';
/** 吸附到连接点的半径（屏幕像素）。整卡判定由下面的落点逻辑负责，这个值只决定离连接点多近时吸过去。 */
export const FIELD_CONNECTION_RADIUS = 32;

export interface ConnectionDropState {
  isValid?: boolean | null;
  fromNode?: { id: string } | null;
  fromHandle?: { type?: 'source' | 'target' | string | null } | null;
}
export type ConnectionDrop = { source: string; target: string } | 'hint' | null;

type PointerLike = { clientX: number; clientY: number };
type EndEvent = PointerLike | { changedTouches?: ArrayLike<PointerLike>; touches?: ArrayLike<PointerLike> };

export function eventPoint(event: EndEvent): { x: number; y: number } | null {
  if ('clientX' in event && typeof event.clientX === 'number') return { x: event.clientX, y: event.clientY };
  const touch = ('changedTouches' in event && event.changedTouches?.[0]) || ('touches' in event && event.touches?.[0]);
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

/** 默认的命中：指针下从上到下第一张节点（分组托盘外层不接收指针，自然被跳过）。 */
export function cardIdsAtPoint(x: number, y: number, doc: Pick<Document, 'elementsFromPoint'> | undefined = typeof document === 'undefined' ? undefined : document): string[] {
  if (!doc) return [];
  const ids: string[] = [];
  for (const element of doc.elementsFromPoint(x, y)) {
    const node = element.closest<HTMLElement>('.react-flow__node[data-id]');
    const id = node?.dataset.id;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function resolveConnectionDrop(
  event: EndEvent,
  state: ConnectionDropState,
  kindOf: (id: string) => CardKind | undefined,
  idsAt: (x: number, y: number) => string[] = cardIdsAtPoint,
): ConnectionDrop {
  const from = state.fromNode?.id;
  if (!from || state.isValid === true) return null;
  const point = eventPoint(event);
  if (!point) return null;
  const target = idsAt(point.x, point.y).find(id => id === from || (kindOf(id) !== undefined && kindOf(id) !== 'frame'));
  if (target === from) return null;
  if (!target) return 'hint';
  return state.fromHandle?.type === 'target' ? { source: target, target: from } : { source: from, target };
}
