import { parseDraftReferences } from '../../draft-references';

// The pure analysis of reference links in a draft body (PW-B1). It has no CodeMirror dependency, so the panel and the
// script export use it without loading the editor (CORE-32); references.ts renders it in the editor and re-exports it.

/**
 * A source reference in the draft body and how the editor shows it (DESIGN_SYSTEM §6.13, §6.18.4, PW-B1).
 * The raw `[来源：…](field://…)` text never changes (K1); it is covered by a `Decoration.replace` widget:
 * - `sup`   a superscript number. A reference that sits alone on its line (what `formatDraftQuote` writes) is hoisted
 *           to the end of the paragraph or quotation above it: the hidden range starts at the end of that line, so
 *           the quotation reads “……司机。¹” and the link line plus the blank line before it disappear.
 * - `label` a reference alone on a line with nothing to attach to (first line, after a heading): number + source title.
 * `index` is the 1-based body order shared by footnotes, the source list and the margin (`draft-used-reference-N`).
 */
export interface DraftReferenceSpan {
  index: number;
  from: number;
  to: number;
  hideFrom: number;
  hideTo: number;
  mode: 'sup' | 'label';
  /** The quoted text this reference closes: the quotation block above it, or “…” right before an inline link. */
  citedFrom?: number;
  citedTo?: number;
  sourceNodeId: string;
  quoteNodeId?: string;
  time?: number;
  label: string;
}

const QUOTE_LINE = /^[ \t]{0,3}>[ \t]?/;
const HEADING_LINE = /^[ \t]{0,3}#{1,6}[ \t]/;
const FENCE_LINE = /^[ \t]{0,3}(?:`{3,}|~{3,})/;

/** `lastIndexOf('\n', -1)` still looks at index 0: at the very start the line starts at 0, even when the text opens with a line break. */
function lineStartAt(text: string, position: number) { return position <= 0 ? 0 : text.lastIndexOf('\n', position - 1) + 1; }
function lineEndAt(text: string, position: number) { const end = text.indexOf('\n', position); return end < 0 ? text.length : end; }

/**
 * The editor's state field and the React side (margin, footnotes, popover) analyse the same text after every
 * keystroke; one remembered result serves both (spans are treated as immutable by every caller).
 */
let lastAnalysis: { doc: string; spans: DraftReferenceSpan[] } | null = null;

/** Pure analysis of the body (tested in tests/draft-editor.test.ts); the editor state field in references.ts renders it. */
export function analyzeDraftReferences(doc: string): DraftReferenceSpan[] {
  if (lastAnalysis && lastAnalysis.doc === doc) return lastAnalysis.spans;
  const spans = analyzeUncached(doc);
  lastAnalysis = { doc, spans };
  return spans;
}

export function analyzeUncached(doc: string): DraftReferenceSpan[] {
  const spans: DraftReferenceSpan[] = [];
  parseDraftReferences(doc).forEach((reference, position) => {
    const lineStart = lineStartAt(doc, reference.from);
    const lineEnd = lineEndAt(doc, reference.to);
    const alone = !doc.slice(lineStart, reference.from).trim() && !doc.slice(reference.to, lineEnd).trim();
    const base = { index: position + 1, from: reference.from, to: reference.to, sourceNodeId: reference.sourceNodeId, quoteNodeId: reference.quoteNodeId, time: reference.time, label: reference.label };
    if (!alone) {
      // Inline: “……”[来源](field://…) cites the quotation marks right before it.
      const before = doc.slice(lineStart, reference.from);
      const close = before.search(/[”」』"][ \t]*$/);
      let cited: { citedFrom: number; citedTo: number } | undefined;
      if (close >= 0) {
        const open = Math.max(before.lastIndexOf('“', close), before.lastIndexOf('「', close), before.lastIndexOf('『', close), before.lastIndexOf('"', close - 1));
        if (open >= 0 && open < close) cited = { citedFrom: lineStart + open, citedTo: lineStart + close + 1 };
      }
      spans.push({ ...base, hideFrom: reference.from, hideTo: reference.to, mode: 'sup', ...cited });
      return;
    }
    // Alone on its line: look for the closest non-blank line above.
    let cursor = lineStart - 1;
    let previous: { from: number; to: number; text: string } | undefined;
    while (cursor >= 0) {
      const from = lineStartAt(doc, cursor);
      const text = doc.slice(from, cursor);
      if (text.trim()) { previous = { from, to: cursor, text }; break; }
      cursor = from - 1;
    }
    const earlier = spans[spans.length - 1];
    const hoistable = previous && !HEADING_LINE.test(previous.text) && !FENCE_LINE.test(previous.text)
      && !(earlier && earlier.hideTo > previous.to);
    if (!previous || !hoistable) {
      spans.push({ ...base, hideFrom: reference.from, hideTo: reference.to, mode: 'label' });
      return;
    }
    let cited: { citedFrom: number; citedTo: number } | undefined;
    if (earlier && earlier.hideTo === previous.to) {
      // Two references closing the same passage share its highlight.
      if (earlier.citedFrom !== undefined && earlier.citedTo !== undefined) cited = { citedFrom: earlier.citedFrom, citedTo: earlier.citedTo };
    } else if (QUOTE_LINE.test(previous.text)) {
      let first = previous.from;
      while (first > 0) {
        const from = lineStartAt(doc, first - 1);
        if (!QUOTE_LINE.test(doc.slice(from, first - 1))) break;
        first = from;
      }
      const mark = QUOTE_LINE.exec(doc.slice(first, previous.to));
      cited = { citedFrom: first + (mark ? mark[0].length : 0), citedTo: previous.to };
    }
    spans.push({ ...base, hideFrom: previous.to, hideTo: lineEnd, mode: 'sup', ...cited });
  });
  return spans;
}

/** Any `field://` text the reference parser did not claim (inside code, malformed): still never shown raw (PW-B1). */
export function strayInternalLinks(doc: string, spans: readonly DraftReferenceSpan[]): { from: number; to: number }[] {
  const stray: { from: number; to: number }[] = [];
  const pattern = /field:\/\/[^\s)\]>"'`]*/gi;
  for (let match = pattern.exec(doc); match; match = pattern.exec(doc)) {
    const from = match.index, to = from + match[0].length;
    if (!spans.some(span => from < span.hideTo && to > span.hideFrom)) stray.push({ from, to });
  }
  return stray;
}
