import { EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { historyField } from '@codemirror/commands';

// A source visit unmounts the inspector. Preserve only serializable editor history in memory, with fresh callbacks
// and decorations on return. Nothing is written to body, browser storage or the board file.
const sessions = new Map<string, { body: string; json: ReturnType<EditorState['toJSON']>; bytes: number }>();
const fields = { history: historyField };
const BUDGET = 4_000_000;
let total = 0;

export function rememberDraftSession(key: string | undefined, state: EditorState) {
  if (!key) return;
  const old = sessions.get(key);
  if (old) { total -= old.bytes; sessions.delete(key); }
  const json = state.toJSON(fields), bytes = JSON.stringify(json).length;
  if (bytes > BUDGET) return;
  while (sessions.size && (sessions.size >= 32 || total + bytes > BUDGET)) {
    const oldest = sessions.keys().next().value!;
    total -= sessions.get(oldest)!.bytes;
    sessions.delete(oldest);
  }
  sessions.set(key, { body: state.doc.toString(), json, bytes }); total += bytes;
}

export function draftSessionState(key: string | undefined, body: string, extensions: Extension): EditorState {
  const saved = key ? sessions.get(key) : undefined;
  return saved?.body === body ? EditorState.fromJSON(saved.json, { extensions }, fields) : EditorState.create({ doc: body, extensions });
}
