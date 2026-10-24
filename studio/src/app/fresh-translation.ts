import type { CardData, Workspace } from '../model';
import { collectFreshSegments, translateFreshCard } from '../english-translation';

type WriteCard = (boardId: string, nodeId: string, patch: Partial<CardData>) => boolean;
type Notify = (message: string) => void;

let readWorkspace: () => Workspace | null = () => null;
let writeCard: WriteCard = () => false;
let notifyFresh: Notify = () => {};

/** Card ids and video attempt ids from the paste that is in progress. Gone on restart. */
const freshCards = new Set<string>();
const freshAttempts = new Set<string>();

export function bindFreshTranslation(read: () => Workspace | null, write: WriteCard, notify: Notify): void {
  readWorkspace = read;
  writeCard = write;
  notifyFresh = notify;
}

export function rememberFreshCards(ids: readonly string[]): void {
  for (const id of ids) if (id) freshCards.add(id);
}

export function rememberFreshAttempts(ids: readonly string[]): void {
  for (const id of ids) if (id) freshAttempts.add(id);
}

function cardOf(boardId: string, nodeId: string): CardData | undefined {
  return readWorkspace()?.boards.find(board => board.id === boardId)?.nodes.find(node => node.id === nodeId)?.data;
}

/** Translate one card from this paste. Does nothing for an id that was not just created, or that has no English. */
export function translateFreshCardNow(boardId: string, nodeId: string): void {
  if (!freshCards.delete(nodeId)) return;
  const data = cardOf(boardId, nodeId);
  if (!data || !collectFreshSegments(data).length) return;
  const bridge = typeof window === 'undefined' ? undefined : window.fieldTranslate;
  if (!bridge) {
    notifyFresh('翻译需要来处桌面版。请设置环境变量 CANVAS_TRANSLATE_API_KEY 后重新启动。');
    return;
  }
  void translateFreshCard(() => cardOf(boardId, nodeId), request => bridge.translate(request)).then(result => {
    if (result.patch) writeCard(boardId, nodeId, result.patch);
    if (result.notice) notifyFresh(result.notice);
  }).catch(error => {
    notifyFresh(error instanceof Error && error.message ? error.message : '翻译失败。');
  });
}

/** The first time this paste's attempt becomes completed. A later write of the same attempt does not ask again. */
export function translateFreshAttempt(boardId: string, nodeId: string, attemptId: string): void {
  if (!freshAttempts.delete(attemptId)) return;
  freshCards.add(nodeId);
  translateFreshCardNow(boardId, nodeId);
}
