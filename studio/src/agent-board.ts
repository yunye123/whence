import type { Board } from './model';
import { validateBoard } from './storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What an agent sees when it opens the local link. The board is the live canvas. */
export const AGENT_READ = [
  '用 GET 请求这个链接。',
  '返回里的 board 就是来处里这张画布当前的内容。',
  '每张卡片在 board.nodes 里：data.kind 是类型，data.title 是标题，data.body 是正文。',
  '类型有 note 笔记、quote 摘录、draft 文稿、link 链接、image 图片、video 视频、frame 分组。',
  '卡片位置在 nodes[].position，连线在 board.edges 的 source 和 target。',
  '图片和视频的文件仍在来处里，这里能读到的是它们的文字、时间码和位置。',
  'board.updatedAt 是这一版的时间。稍后如果要写入，把这个时间原样带回。',
] as const;

/** What an agent follows only after the user asks it to change the canvas. */
export const AGENT_WRITE = [
  '只有使用者明确要求修改或整理时才写入。读取本身不要改画布。',
  '先 GET。在拿到的 board 上改标题、简介、卡片的 title 和 body、卡片位置或连线。',
  '保留 board.id、board.createdAt 和 board.updatedAt，不要新增字段。',
  '用 PUT 把整个 board 送回这个链接，Content-Type 用 application/json。可以只送 board，也可以送 { "board": board }。',
  '来处会留下原来的画面缩放和本机文件夹。',
  '如果返回 409，说明画布刚刚又被改过：重新 GET，在新的 board 上再改一次。',
  '来处窗口开着时，写入会直接出现在这张画布上。',
] as const;

export function agentBoardLink(origin: string, boardId: string): string {
  if (!UUID.test(boardId)) throw new Error('这张画布不能给出本地地址。');
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) throw new Error('本地地址需要来处桌面版。');
  url.pathname = `/agent/boards/${boardId}`;
  url.search = '';
  url.hash = '';
  return url.href;
}

export interface AgentBoardView {
  link: string;
  read: readonly string[];
  write: readonly string[];
  board: Board;
}

export function agentBoardView(board: Board, link: string): AgentBoardView {
  return { link, read: AGENT_READ, write: AGENT_WRITE, board };
}

export function agentBoardError(link: string, error: string) {
  return { link, read: AGENT_READ, write: AGENT_WRITE, error };
}

export type AgentEditDecision =
  | { kind: 'apply'; board: Board }
  | { kind: 'conflict' }
  | { kind: 'invalid' };

/** Accept a write only when it still matches the canvas the agent just read. */
export function applyAgentEdit(current: Board, value: unknown): AgentEditDecision {
  const raw = unwrapBoard(value);
  if (!raw) return { kind: 'invalid' };
  let incoming: Board;
  try { incoming = validateBoard(raw); } catch { return { kind: 'invalid' }; }
  if (incoming.id !== current.id) return { kind: 'invalid' };
  if (incoming.updatedAt !== current.updatedAt) return { kind: 'conflict' };
  const next = JSON.parse(JSON.stringify(incoming)) as Board;
  next.createdAt = current.createdAt;
  next.viewport = current.viewport;
  if (current.storage) next.storage = current.storage;
  else delete next.storage;
  return { kind: 'apply', board: next };
}

function unwrapBoard(value: unknown): unknown {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.board && typeof record.board === 'object') return record.board;
  if (typeof record.id === 'string' && Array.isArray(record.nodes)) return record;
  return null;
}
