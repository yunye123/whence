import type { Board, BoardNode } from './model';
import { formatDraftQuote, formatDraftSourceLine } from './draft-references';

export type DraftEditorState = {
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: 'forward' | 'backward' | 'none';
  editorScrollTop: number;
  editorScrollLeft: number;
  inspectorScrollTop: number;
  referencesOpen?: boolean;
  versionsOpen?: boolean;
  writingExpanded?: boolean;
};
/**
 * `insertAfter`: a trip that picks a shot for one script line (“补一个镜头”, §6.29) carries where that line ends in the
 * LF body, so the watching page can give the chosen sentences to that line (“配给这一行”) or write them in right after it
 * (“另起一行写进原话”); `line` is its number.
 */
export type DraftSourceRequest = { draftId: string; sourceId: string; quoteNodeId?: string; time?: number; editor: DraftEditorState; insertAfter?: number; line?: number };
export type DraftReturnInfo = { draftId: string; title: string; insert?: { line?: number } };
/** Where a trip's line ended, with the words just before it, so a body changed meanwhile can still be followed. */
export type DraftInsertPoint = { at: number; anchor: string; line?: number };
export type DraftRestoreRequest = { draftId: string; token: number; editor: DraftEditorState };

type DraftView = 'canvas' | 'outline';
type DraftViewport = Board['viewport'];
type ReturnContext = {
  boardId: string;
  draftId: string;
  view: DraftView;
  viewport: DraftViewport;
  editor: DraftEditorState;
  insert?: DraftInsertPoint;
};
type PendingRestore = { boardId: string; restore: DraftRestoreRequest };

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function editorSnapshot(editor: DraftEditorState, bodyLength: number): DraftEditorState {
  const position = (value: number) => Math.min(bodyLength, Math.max(0, Math.trunc(finite(value))));
  const selectionStart = position(editor.selectionStart);
  return {
    selectionStart,
    selectionEnd: Math.max(selectionStart, position(editor.selectionEnd)),
    selectionDirection: editor.selectionDirection === 'forward' || editor.selectionDirection === 'backward'
      ? editor.selectionDirection : 'none',
    editorScrollTop: Math.max(0, finite(editor.editorScrollTop)),
    editorScrollLeft: Math.max(0, finite(editor.editorScrollLeft)),
    inspectorScrollTop: Math.max(0, finite(editor.inspectorScrollTop)),
    referencesOpen: editor.referencesOpen === true,
    versionsOpen: editor.versionsOpen === true,
    writingExpanded: editor.writingExpanded === true,
  };
}

function viewportSnapshot(viewport: DraftViewport): DraftViewport {
  return {
    x: finite(viewport.x),
    y: finite(viewport.y),
    zoom: Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1,
  };
}

const lf = (text: string) => text.replace(/\r\n?/g, '\n');
const ANCHOR = 160;

/**
 * The offset to write at in `body` (LF): the trip's own offset while the words before it are unchanged, else just after
 * those words when they occur exactly once, else null (the caller appends at the end and says so).
 */
export function resolveDraftInsertion(body: string, point: DraftInsertPoint): number | null {
  if (point.at <= body.length && body.slice(point.at - point.anchor.length, point.at) === point.anchor) return point.at;
  if (!point.anchor.trim()) return null;
  const first = body.indexOf(point.anchor);
  return first >= 0 && body.indexOf(point.anchor, first + 1) < 0 ? first + point.anchor.length : null;
}

/**
 * Paragraphs written into `body` (LF) at `at`, as their own blocks: one blank line before and after, the rest of the body
 * untouched. Returns the new body and where the first new paragraph starts.
 */
export function insertDraftBlocks(body: string, at: number | null, blocks: string): { body: string; from: number; to: number; at: number } {
  const text = blocks.replace(/^\n+|\n+$/g, '');
  const point = at === null ? body.length : Math.max(0, Math.min(body.length, at));
  const head = body.slice(0, point).replace(/\n+$/, '');
  const tail = body.slice(point).replace(/^\n+/, '');
  const from = head ? head.length + 2 : 0;
  const next = `${head}${head ? '\n\n' : ''}${text}${tail ? `\n\n${tail}` : '\n'}`;
  return { body: next, from, to: from + text.length, at: head.length };
}

/**
 * What a “补一个镜头” trip writes (§6.29): `shot` (“配给这一行”, the default) gives the trip's line its picture — only the
 * excerpts' source links, one reference-only paragraph that the script folds into that line, so its words and the line
 * count stay as they were; `line` (“另起一行写进原话”) writes each quotation with its source as new lines after it.
 */
export type TripWriteMode = 'shot' | 'line';

/**
 * Write excerpts in after a trip's line. A line that can no longer be found takes no picture: the quotations go to the
 * end as new lines (`mode` says what was actually written, `followed` whether the line was found).
 */
export function writeTripLine(body: string, point: DraftInsertPoint, quotes: readonly BoardNode[], mode: TripWriteMode): { body: string; from: number; to: number; at: number; followed: boolean; mode: TripWriteMode } {
  const text = lf(body);
  const at = resolveDraftInsertion(text, point);
  const written: TripWriteMode = at === null ? 'line' : mode;
  const blocks = written === 'shot'
    ? quotes.map(quote => formatDraftSourceLine(quote)).join('\n')
    : quotes.map(quote => formatDraftQuote(quote).replace(/^\n+|\n+$/g, '')).join('\n\n');
  return { ...insertDraftBlocks(text, at, blocks), followed: at !== null, mode: written };
}

function findDraft(board: Board, draftId: string): BoardNode | undefined {
  return board.nodes.find(node => node.id === draftId && node.data.kind === 'draft');
}

/** One in-memory trip from a draft to its source. No text or navigation history is retained. */
export class DraftNavigationSession {
  private context: ReturnContext | null = null;
  private pending: PendingRestore | null = null;
  private nextToken = 0;

  open(board: Board, request: DraftSourceRequest, view: DraftView, viewport: DraftViewport): { nodeId: string; quoteNodeId?: string; time?: number } {
    const draft = findDraft(board, request.draftId);
    if (!draft) throw new Error('当前文稿已不存在，请重新打开文稿。');
    if (request.sourceId === request.draftId) throw new Error('不能把当前文稿作为自己的来源。');
    if (!board.nodes.some(node => node.id === request.sourceId)) throw new Error('这条来源已不存在，无法打开。');
    if (request.quoteNodeId !== undefined) {
      const quote = board.nodes.find(node => node.id === request.quoteNodeId);
      if (!quote || quote.data.kind !== 'quote' || quote.data.citation?.nodeId !== request.sourceId) {
        throw new Error('这处摘录与来源已无法对应，请检查来源引用。');
      }
    }
    if (request.time !== undefined && (!Number.isFinite(request.time) || request.time < 0 || request.time > 604_800)) {
      throw new Error('来源时间无效，请使用大于或等于 0 的有限秒数。');
    }

    let insert: DraftInsertPoint | undefined;
    if (request.insertAfter !== undefined) {
      const body = lf(draft.data.body);
      if (!Number.isInteger(request.insertAfter) || request.insertAfter < 0 || request.insertAfter > body.length) throw new Error('这一行的位置已变化，请回到脚本重新打开。');
      const line = request.line !== undefined && Number.isInteger(request.line) && request.line > 0 ? request.line : undefined;
      insert = { at: request.insertAfter, anchor: body.slice(Math.max(0, request.insertAfter - ANCHOR), request.insertAfter), ...(line ? { line } : {}) };
    }

    // Validate and copy the complete next state before replacing an existing return route.
    const context: ReturnContext = {
      boardId: board.id,
      draftId: draft.id,
      view,
      viewport: viewportSnapshot(viewport),
      editor: editorSnapshot(request.editor, draft.data.body.length),
      ...(insert ? { insert } : {}),
    };
    this.context = context;
    this.pending = null;
    return { nodeId: request.sourceId, ...(request.quoteNodeId !== undefined ? { quoteNodeId: request.quoteNodeId } : {}), ...(request.time !== undefined ? { time: request.time } : {}) };
  }

  info(board: Board): DraftReturnInfo | null {
    this.reconcile(board);
    if (!this.context) return null;
    const draft = findDraft(board, this.context.draftId)!;
    const insert = this.context.insert;
    return { draftId: draft.id, title: draft.data.title, ...(insert ? { insert: insert.line ? { line: insert.line } : {} } : {}) };
  }

  /** The line this trip picks a shot for (“配给这一行”), or null for an ordinary trip back to a source. */
  insertPoint(board: Board): DraftInsertPoint | null {
    this.reconcile(board);
    const insert = this.context?.insert;
    return insert ? { ...insert } : null;
  }

  /**
   * `length` characters were written into the trip's draft right after offset `at`: the caret and selection kept for
   * the way back move with the words after it (a caret at `at` itself, the end of the line, stays).
   */
  shiftReturn(at: number, length: number): void {
    if (!this.context || !(length > 0)) return;
    const editor = this.context.editor;
    const move = (value: number) => value > at ? value + length : value;
    this.context = { ...this.context, editor: { ...editor, selectionStart: move(editor.selectionStart), selectionEnd: move(editor.selectionEnd) } };
  }

  restoreInfo(board: Board): DraftRestoreRequest | null {
    this.reconcile(board);
    if (!this.pending) return null;
    const restore = this.pending.restore;
    const draft = findDraft(board, restore.draftId)!;
    return { draftId: restore.draftId, token: restore.token, editor: editorSnapshot(restore.editor, draft.data.body.length) };
  }

  returnToDraft(board: Board): { draftId: string; view: DraftView; viewport: DraftViewport; restore: DraftRestoreRequest } | null {
    this.reconcile(board);
    if (!this.context) return null;
    const context = this.context;
    const draft = findDraft(board, context.draftId)!;
    const restore: DraftRestoreRequest = {
      draftId: draft.id,
      token: ++this.nextToken,
      editor: editorSnapshot(context.editor, draft.data.body.length),
    };
    this.pending = { boardId: board.id, restore };
    this.context = null;
    return {
      draftId: draft.id,
      view: context.view,
      viewport: { ...context.viewport },
      restore: { ...restore, editor: { ...restore.editor } },
    };
  }

  complete(token: number): void {
    if (this.pending?.restore.token === token) this.pending = null;
  }

  clear(): void {
    this.context = null;
    this.pending = null;
  }

  reconcile(board: Board | null): void {
    if (!board) { this.clear(); return; }
    if (this.context && (this.context.boardId !== board.id || !findDraft(board, this.context.draftId))) this.clear();
    if (this.pending && (this.pending.boardId !== board.id || !findDraft(board, this.pending.restore.draftId))) this.clear();
  }
}
