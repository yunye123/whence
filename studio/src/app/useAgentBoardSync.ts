import { useEffect, useRef, type RefObject } from 'react';
import type { Workspace } from '../model';
import { agentBoardError, agentBoardLink, agentBoardView, applyAgentEdit } from '../agent-board';

/** Answers a local agent from the open canvas. Nothing is copied out to another file. */
export function useAgentBoardSync({ workspaceRef, readOnlyRef, setNext, notify }: {
  workspaceRef: RefObject<Workspace | null>;
  readOnlyRef: RefObject<boolean>;
  setNext: (next: Workspace) => void;
  notify: (message: string) => void;
}): void {
  const notifyRef = useRef(notify);
  const setNextRef = useRef(setNext);
  notifyRef.current = notify;
  setNextRef.current = setNext;
  useEffect(() => {
    const api = window.fieldAgentBoard;
    if (!api) return;
    return api.onRequest(request => {
      const workspace = workspaceRef.current;
      const board = workspace?.boards.find(item => item.id === request.boardId);
      const link = linkFor(request.boardId);
      if (!board) return { status: 404, body: JSON.stringify(agentBoardError(link, '没有这张画布。')) };
      if (request.method === 'GET') return { status: 200, body: JSON.stringify(agentBoardView(board, link)) };
      if (readOnlyRef.current) return { status: 409, body: JSON.stringify(agentBoardError(link, '来处正由另一个窗口使用，这次没有写入。')) };
      let parsed: unknown;
      try { parsed = JSON.parse(request.body); } catch { return { status: 400, body: JSON.stringify(agentBoardError(link, '写入的内容不是画布。请按 write 里的方法，用 PUT 送回这张画布。')) }; }
      const decision = applyAgentEdit(board, parsed);
      if (decision.kind === 'conflict') return { status: 409, body: JSON.stringify(agentBoardError(link, '这张画布刚刚又改过。请重新 GET，在新的内容上再改。')) };
      if (decision.kind !== 'apply') return { status: 400, body: JSON.stringify(agentBoardError(link, '没有写入。请保持 board.id 和 board.updatedAt 不变，只改标题、正文、卡片位置或连线。')) };
      const current = workspaceRef.current;
      const live = current?.boards.find(item => item.id === board.id);
      if (!current || !live || live.updatedAt !== board.updatedAt) return { status: 409, body: JSON.stringify(agentBoardError(link, '这张画布刚刚又改过。请重新 GET，在新的内容上再改。')) };
      const nextBoard = { ...decision.board, updatedAt: new Date().toISOString() };
      setNextRef.current({ ...current, boards: current.boards.map(item => item.id === nextBoard.id ? nextBoard : item) });
      notifyRef.current('已写入本地智能体整理的画布');
      return { status: 200, body: JSON.stringify(agentBoardView(nextBoard, link)) };
    });
  }, [readOnlyRef, workspaceRef]);
}

function linkFor(boardId: string): string {
  try { return agentBoardLink(window.location.origin, boardId); }
  catch { return ''; }
}
