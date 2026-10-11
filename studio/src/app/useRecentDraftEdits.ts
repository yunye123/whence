import { useEffect, useRef } from 'react';
import type { Board, BoardNode } from '../model';

/** Camera movement, card positions and version metadata do not mean a draft was edited. */
export function latestEditedDraft(previous: readonly BoardNode[], current: readonly BoardNode[]): string | undefined {
  const before = new Map(previous.map(node => [node.id, node.data]));
  let edited: string | undefined;
  for (const node of current) {
    if (node.data.kind !== 'draft') continue;
    const old = before.get(node.id);
    if (!old || old.kind !== 'draft' || old.body !== node.data.body || old.title !== node.data.title) edited = node.id;
  }
  return edited;
}

/** Per-board session memory only; no timestamps or extra fields enter saved user data. */
export function useRecentDraftEdits(board: Board | null): string | undefined {
  const previous = useRef<{ boardId: string; nodes: readonly BoardNode[] } | undefined>(undefined);
  const recent = useRef(new Map<string, string>());
  useEffect(() => {
    if (!board) { previous.current = undefined; return; }
    if (previous.current?.boardId === board.id && previous.current.nodes !== board.nodes) {
      const id = latestEditedDraft(previous.current.nodes, board.nodes);
      if (id) recent.current.set(board.id, id);
    }
    previous.current = { boardId: board.id, nodes: board.nodes };
  }, [board?.id, board?.nodes]);
  return board ? recent.current.get(board.id) : undefined;
}
