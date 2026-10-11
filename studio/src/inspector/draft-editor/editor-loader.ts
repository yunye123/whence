/**
 * The draft editor (CodeMirror and everything built on it) is a separate chunk, loaded only when writing (CORE-32):
 * a draft about to open, a draft card pointed at, selected or focused. Other panels and the idle preload no longer
 * bring it. One request is shared; once it has arrived `loadedDraftEditor()` returns it synchronously.
 */
type EditorKit = typeof import('./editor-kit');

let loaded: EditorKit | null = null;
let pending: Promise<EditorKit> | null = null;

export function preloadDraftEditor(): Promise<EditorKit> {
  pending ??= import('./editor-kit').then(kit => { loaded = kit; return kit; }).catch(error => { pending = null; throw error; });
  return pending;
}

export function loadedDraftEditor(): EditorKit | null { return loaded; }
