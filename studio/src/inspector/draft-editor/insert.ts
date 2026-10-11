import { EditorSelection } from '@codemirror/state';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import { insertDraftText } from '../draft-text';

// fitQuoteToCaret is plain text work (no CodeMirror): it lives in quote-fit.ts and is re-exported here (CORE-32).
export { fitQuoteToCaret } from './quote-fit';

/**
 * C11: inserting into the editor computes the result with `insertDraftText` (unchanged, test-locked) and dispatches
 * exactly that change, so the textarea path and the CodeMirror path give the same body and caret.
 * Returns null when the selection is outside the document (cannot happen for a live state).
 */
export function draftInsertion(state: EditorState, text: string, wrap?: [string, string]): { spec: TransactionSpec; body: string; cursor: number } | null {
  const { from, to } = state.selection.main;
  const current = state.doc.toString();
  if (from < 0 || to > current.length) return null;
  const result = insertDraftText(current, from, to, text, wrap);
  const inserted = result.body.slice(from, result.body.length - (current.length - to));
  return {
    body: result.body,
    cursor: result.cursor,
    spec: { changes: { from, to, insert: inserted }, selection: EditorSelection.cursor(result.cursor), scrollIntoView: true, userEvent: 'input.paste' },
  };
}
