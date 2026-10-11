import type { EditorView } from '@codemirror/view';

// Positions in the draft editor's scroller (INSP-08). Only the view instance is used, so this module does not load
// CodeMirror: the panel reads and restores anchors through it (CORE-32), and handle.ts re-exports it.

/** The element that scrolls the draft text: CodeMirror's own scroller, or the panel's `.inspector-scroll` it grows in. */
export function draftScroller(view: EditorView): HTMLElement {
  const own = view.scrollDOM;
  if (typeof getComputedStyle === 'function' && getComputedStyle(own).overflowY !== 'visible') return own;
  return own.closest<HTMLElement>('.inspector-scroll') ?? own;
}

/** The editor is not laid out (the draft shows its script view, §6.29): its line positions mean nothing on screen. */
export function editorHidden(view: EditorView): boolean {
  return typeof view.dom.getClientRects === 'function' && view.dom.getClientRects().length === 0;
}

/**
 * The line at the top of the visible text, as a document position plus its offset from the scroller's top edge.
 * A hidden editor has no such line (pos −1): the panel's pixel offset is then the whole answer.
 */
export function captureScrollAnchor(view: EditorView): { pos: number; offset: number } {
  if (editorHidden(view)) return { pos: -1, offset: 0 };
  const top = draftScroller(view).getBoundingClientRect().top;
  const block = view.lineBlockAtHeight(Math.max(0, top - view.documentTop));
  return { pos: block.from, offset: view.documentTop + block.top - top };
}

/**
 * Put that line back at the same offset (INSP-08): scroll by the measured difference, then measure again, so estimated
 * heights of other lines no longer matter. No `scrollIntoView` here: it honours the editor's scroll margins (toolbar
 * inset) and could land after the first correction, leaving the line one toolbar height too low.
 */
export function restoreScrollAnchor(view: EditorView, anchor: { pos: number; offset: number }) {
  if (anchor.pos < 0 || editorHidden(view)) return;
  const pos = Math.min(Math.max(0, anchor.pos), view.state.doc.length);
  // Lines drawn for the first time get their real height a frame later and move the anchor again: correct until it
  // has held still for two frames (a few frames at most).
  let rounds = 0, still = 0;
  const correct = () => view.requestMeasure({
    read: () => {
      const scroller = draftScroller(view);
      return { scroller, delta: view.documentTop + view.lineBlockAt(pos).top - scroller.getBoundingClientRect().top - anchor.offset };
    },
    write: ({ scroller, delta }) => {
      if (Math.abs(delta) > 0.5) { scroller.scrollTop += delta; still = 0; } else still++;
      if (still >= 2 || ++rounds > 8) return;
      requestAnimationFrame(correct);
    },
  });
  correct();
}
