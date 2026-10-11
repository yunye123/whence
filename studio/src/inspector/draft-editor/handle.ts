import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { draftScroller, editorHidden } from './scroll-anchor';

export type SelectionDirection = 'forward' | 'backward' | 'none';

/**
 * The textarea-shaped surface the inspector keeps for every body editor (C11). A plain `<textarea>` satisfies it
 * as is; the CodeMirror draft editor provides it through `attachTextareaAdapter`. Offsets are UTF-16 positions in
 * the LF-normalised body, so `insertDraftText`, `parseDraftReferences` and `DraftEditorState` need no mapping (K9-14).
 */
export interface TextEditorHandle {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly selectionDirection: SelectionDirection;
  scrollTop: number;
  scrollLeft: number;
  setSelectionRange(start: number, end: number, direction?: SelectionDirection): void;
  focus(options?: FocusOptions): void;
}

/** The draft editor's handle: the textarea surface plus two CodeMirror-only conveniences. */
export interface DraftEditorHandle extends TextEditorHandle {
  /** Scroll the current selection to the middle of the visible writing area (layout switches, restore). */
  revealSelection(): void;
  /** Select a range and centre it (locating a reference). */
  revealRange(from: number, to: number): void;
  readonly view: EditorView;
  /** Every update of the body editor, after it is applied (script cells follow the body through it, §6.29). */
  subscribe(listener: (update: ViewUpdate) => void): () => void;
}

// The scroll anchors and the draft scroller only read the view: they live apart from CodeMirror's modules (scroll-anchor.ts),
// so the panel can use them without loading the editor (CORE-32). Re-exported here for existing imports.
export { draftScroller, captureScrollAnchor, restoreScrollAnchor } from './scroll-anchor';

const clamp = (value: number, length: number) => Math.max(0, Math.min(length, Math.trunc(Number.isFinite(value) ? value : 0)));

/**
 * Define the textarea members on `view.contentDOM` (the element named “文稿正文”), so the inspector and the browser
 * scripts read and set the editor exactly as they did the textarea: `value`, `selectionStart`, `selectionEnd`,
 * `selectionDirection`, `scrollTop`, `scrollLeft` (of whatever scrolls the text: the panel's `.inspector-scroll`),
 * `setSelectionRange()`. `focus()` goes through `view.focus()`, which
 * puts the DOM selection back to the editor state's selection instead of letting the browser reset it.
 */
export function attachTextareaAdapter(view: EditorView, listeners: Set<(update: ViewUpdate) => void> = new Set()): DraftEditorHandle & HTMLElement {
  const dom = view.contentDOM;
  const nativeFocus = HTMLElement.prototype.focus;
  let focusing = false;
  const select = (start: number, end: number, direction: SelectionDirection = 'none') => {
    const length = view.state.doc.length;
    const from = clamp(start, length);
    const to = Math.max(from, clamp(end, length));
    view.dispatch({ selection: direction === 'backward' ? EditorSelection.single(to, from) : EditorSelection.single(from, to) });
  };
  // A hidden editor (脚本 view) keeps its selection but scrolls nothing: the panel's scroller belongs to the script then.
  const reveal = (position: number) => { if (!editorHidden(view)) view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'center' }) }); };
  // The editor grows with its text inside the panel's scroll area (shell contract: one scroller), so its own
  // scroller never scrolls. The textarea members report the element that actually scrolls the text, which keeps
  // “editor scrolled by N, restore N” true for navigation, the visit cache and the scripts.
  const scroller = (): HTMLElement => draftScroller(view);
  const members: PropertyDescriptorMap = {
    value: { configurable: true, get: () => view.state.doc.toString() },
    selectionStart: { configurable: true, get: () => view.state.selection.main.from },
    selectionEnd: { configurable: true, get: () => view.state.selection.main.to },
    selectionDirection: { configurable: true, get: () => { const main = view.state.selection.main; return main.empty ? 'none' : main.anchor > main.head ? 'backward' : 'forward'; } },
    scrollTop: { configurable: true, get: () => scroller().scrollTop, set: (value: number) => { scroller().scrollTop = value; } },
    scrollLeft: { configurable: true, get: () => scroller().scrollLeft, set: (value: number) => { scroller().scrollLeft = value; } },
    setSelectionRange: { configurable: true, value: select },
    focus: { configurable: true, value: (options?: FocusOptions) => {
      // view.focus() calls contentDOM.focus() itself; that inner call must reach the native method.
      if (focusing) { nativeFocus.call(dom, options); return; }
      focusing = true;
      try { view.focus(); } finally { focusing = false; }
    } },
    revealSelection: { configurable: true, value: () => reveal(view.state.selection.main.head) },
    revealRange: { configurable: true, value: (from: number, to: number) => {
      const length = view.state.doc.length;
      const start = clamp(from, length), end = Math.max(start, clamp(to, length));
      view.dispatch({ selection: EditorSelection.single(start, end), effects: editorHidden(view) ? [] : EditorView.scrollIntoView(EditorSelection.range(start, end), { y: 'center' }) });
      view.focus();
    } },
    view: { configurable: true, value: view },
    subscribe: { configurable: true, value: (listener: (update: ViewUpdate) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } },
  };
  Object.defineProperties(dom, members);
  return dom as unknown as DraftEditorHandle & HTMLElement;
}
