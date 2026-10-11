import { StateField } from '@codemirror/state';
import type { EditorState, Range, Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { hiddenRanges, referenceField, referenceSpans } from './references';
import { draftParagraphNumbers } from '../../source-location';

/**
 * Markdown made quiet (DESIGN_SYSTEM §6.18.4, P2 “任何界面不露 Markdown 符号”). The text stays the raw Markdown
 * string; decorations only change how it looks:
 * - line classes: headings, quotation lines, list items, code, blank lines (blank lines become the paragraph gap);
 * - the first line of every counted paragraph carries `data-para` for the left-margin number and the paper-edge tick;
 * - marks (`## `, `> `, `**`, backticks, `[`…`](url)`) are hidden, list markers become a bullet; on the line that
 *   holds the caret (while the editor has focus) they reappear dimmed, so editing them stays possible — except the
 *   quotation mark, which stays hidden (its rule says it); leading marks reappear without moving the text.
 */

export type LineKind = 'blank' | 'heading' | 'quote' | 'list' | 'fence' | 'code' | 'text' | 'reference';
export interface DraftStructure {
  kinds: LineKind[];
  headingLevel: Uint8Array;
  /** Paragraph number on the first line of each counted block, 0 elsewhere. */
  paragraph: Uint32Array;
}

const HEADING = /^[ \t]{0,3}(#{1,6})[ \t]+/;
const QUOTE = /^[ \t]{0,3}>[ \t]?/;
const LIST = /^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/**
 * Classify every line once per document change. Paragraph numbers follow `paragraphIndexAt` (blocks split by blank
 * lines, single-line headings not counted) except that a block holding nothing but reference links is not counted
 * either: those blocks are folded into the paragraph above (references.ts), so the numbers run 1, 2, 3 as seen.
 */
export function analyzeDraftStructure(doc: Text, referenceOnlyLines: ReadonlySet<number>): DraftStructure {
  const count = doc.lines;
  const kinds: LineKind[] = new Array(count);
  const headingLevel = new Uint8Array(count + 1);
  const paragraph = new Uint32Array(count + 1);
  let fence: string | null = null;
  for (let number = 1; number <= count; number++) {
    const text = doc.line(number).text;
    const fenceMatch = FENCE.exec(text);
    if (fence) {
      kinds[number - 1] = 'code';
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && !text.slice(fenceMatch[0].length).trim()) { kinds[number - 1] = 'fence'; fence = null; }
      continue;
    }
    if (fenceMatch) { fence = fenceMatch[1]; kinds[number - 1] = 'fence'; continue; }
    if (!text.trim()) { kinds[number - 1] = 'blank'; continue; }
    if (referenceOnlyLines.has(number)) { kinds[number - 1] = 'reference'; continue; }
    const heading = HEADING.exec(text);
    if (heading) { kinds[number - 1] = 'heading'; headingLevel[number] = heading[1].length; continue; }
    kinds[number - 1] = QUOTE.test(text) ? 'quote' : LIST.test(text) ? 'list' : 'text';
  }
  let counter = 0;
  let blockStart = 0;
  let blockCounted = false;
  for (let number = 1; number <= count + 1; number++) {
    const kind = number <= count ? kinds[number - 1] : 'blank';
    if (kind === 'blank') {
      blockStart = 0;
      continue;
    }
    if (!blockStart) { blockStart = number; blockCounted = false; }
    const single = kind === 'heading' && (number === count || kinds[number] === 'blank') && number === blockStart;
    if (!blockCounted && kind !== 'reference' && kind !== 'fence' && !single) {
      counter++;
      paragraph[number] = counter;
      blockCounted = true;
    }
  }
  return { kinds, headingLevel, paragraph };
}

function referenceOnlyLineNumbers(state: EditorState): Set<number> {
  const lines = new Set<number>();
  const doc = state.doc;
  for (const span of referenceSpans(state)) {
    const line = doc.lineAt(span.from);
    const rest = line.text.slice(0, span.from - line.from) + line.text.slice(span.to - line.from);
    // Several references on one line: the line is reference-only when nothing but other references remain.
    const others = referenceSpans(state).filter(other => other !== span && other.from >= line.from && other.to <= line.to);
    let remaining = rest;
    for (const other of others) remaining = remaining.replace(doc.sliceString(other.from, other.to), '');
    if (!remaining.trim()) lines.add(line.number);
  }
  return lines;
}

export const structureField = StateField.define<DraftStructure>({
  create: state => analyzeDraftStructure(state.doc, referenceOnlyLineNumbers(state)),
  update: (value, transaction) => transaction.docChanged ? analyzeDraftStructure(transaction.state.doc, referenceOnlyLineNumbers(transaction.state)) : value,
});

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const span = document.createElement('span'); span.className = 'cm-md-bullet'; span.textContent = '•'; span.setAttribute('aria-hidden', 'true'); return span; }
}
const bullet = Decoration.replace({ widget: new BulletWidget() });
const hide = Decoration.replace({});
const dimMark = Decoration.mark({ class: 'cm-md-mark' });
/** A line's leading mark (`## `, `- `) on the caret line: hung outside the text (heading) or in the bullet's slot (list), so the text never shifts. */
const dimLead = Decoration.mark({ class: 'cm-md-mark cm-md-lead' });
const strong = Decoration.mark({ class: 'cm-md-strong' });
const code = Decoration.mark({ class: 'cm-md-inline-code' });
const link = Decoration.mark({ class: 'cm-md-link' });
/**
 * The last few characters of a text line stay together (CSS `.cm-keep`, only in justified focus writing), so a line
 * never ends with one or two characters on a row of their own (§3.4 “不允许孤字成行”, INSP-09). Presentation only:
 * the document text and every offset are unchanged (K9-14). A reference ending the line is kept with them.
 */
const keep = Decoration.mark({ class: 'cm-keep' });
const KEEP_CHARACTERS = 4;
/** Start of the last `count` visible characters before `end` (hidden references skipped, surrogate pairs whole). */
function keepStart(text: string, lineFrom: number, end: number, hidden: readonly { from: number; to: number }[], count: number): number {
  let position = end;
  for (let taken = 0; taken < count && position > lineFrom;) {
    const range = hidden.find(item => item.from < position && item.to >= position);
    if (range) { position = Math.max(lineFrom, range.from); continue; }
    position--;
    const code = text.charCodeAt(position - lineFrom);
    if (code >= 0xdc00 && code <= 0xdfff && position > lineFrom) position--;
    taken++;
  }
  return position;
}

/** Citation ownership uses the full draft's shared paragraph API, never a fresh count per reference. */
export function referencedParagraphs(state: EditorState): Set<number> {
  const { starts, owner } = draftParagraphNumbers(state.doc.toString());
  const result = new Set<number>();
  for (const span of referenceSpans(state)) {
    // An orphan source line has no preceding passage to circle.
    if (span.mode === 'label') continue;
    const position = span.citedFrom ?? span.hideFrom;
    let line = state.doc.lineAt(position).number - 1;
    while (line > 0 && !owner[line]) line--;
    if (starts[line] <= position && owner[line]) result.add(owner[line]);
  }
  return result;
}

function lineDecoration(kind: LineKind, level: number, paragraphNumber: number, caretBlank: boolean, cited: boolean) {
  const classes = [`cm-md-${kind}`];
  if (kind === 'heading') classes.push(`cm-md-h${Math.min(level, 3)}`);
  if (kind === 'blank' && caretBlank) classes.push('is-caret');
  if (paragraphNumber) classes.push('cm-para-start');
  if (paragraphNumber && cited) classes.push('is-cited-paragraph');
  return Decoration.line({ class: classes.join(' '), attributes: paragraphNumber ? { 'data-para': String(paragraphNumber) } : undefined });
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const structure = state.field(structureField);
  const hidden = hiddenRanges(state);
  const citedParagraphs = referencedParagraphs(state);
  const insideHidden = (position: number) => hidden.some(range => position > range.from && position <= range.to);
  const overlapsHidden = (from: number, to: number) => hidden.some(range => from < range.to && to > range.from);
  const focused = view.hasFocus;
  const activeLines = new Set<number>();
  if (focused) for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number, last = state.doc.lineAt(range.to).number;
    for (let number = first; number <= last; number++) activeLines.add(number);
  }
  const decorations: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    let line = state.doc.lineAt(from);
    for (;;) {
      if (!insideHidden(line.from)) {
        const kind = structure.kinds[line.number - 1];
        const active = activeLines.has(line.number);
        decorations.push(lineDecoration(kind, structure.headingLevel[line.number], structure.paragraph[line.number], kind === 'blank' && active, citedParagraphs.has(structure.paragraph[line.number])).range(line.from));
        const text = line.text;
        const mark = (start: number, end: number) => {
          if (end <= start || overlapsHidden(line.from + start, line.from + end)) return;
          decorations.push((active ? dimMark : hide).range(line.from + start, line.from + end));
        };
        if (kind === 'heading') {
          const match = HEADING.exec(text);
          if (match && !overlapsHidden(line.from, line.from + match[0].length)) decorations.push((active ? dimLead : hide).range(line.from, line.from + match[0].length));
        } else if (kind === 'quote') {
          // The quotation mark stays hidden even on the caret line: the rule beside the line already says “quoted”,
          // and revealing it would push the quoted words sideways while the caret moves through them.
          const match = QUOTE.exec(text);
          if (match && !overlapsHidden(line.from, line.from + match[0].length)) decorations.push(hide.range(line.from, line.from + match[0].length));
        }
        else if (kind === 'list') {
          const match = LIST.exec(text);
          if (match && /[-*+]/.test(match[0].trim()) && !overlapsHidden(line.from, line.from + match[0].length)) {
            decorations.push((active ? dimLead : bullet).range(line.from + match[0].length - match[0].trimStart().length, line.from + match[0].length));
          }
        }
        if (kind !== 'code' && kind !== 'fence' && kind !== 'reference') {
          // Inline marks: **strong**, `code`, [label](https://…). Reference links are already widgets.
          for (const match of text.matchAll(/(\*\*|__)(?=\S)(.+?\S)\1/g)) {
            const start = match.index ?? 0, end = start + match[0].length;
            if (overlapsHidden(line.from + start, line.from + end)) continue;
            mark(start, start + 2); mark(end - 2, end);
            decorations.push(strong.range(line.from + start + 2, line.from + end - 2));
          }
          for (const match of text.matchAll(/`([^`\n]+)`/g)) {
            const start = match.index ?? 0, end = start + match[0].length;
            if (overlapsHidden(line.from + start, line.from + end)) continue;
            mark(start, start + 1); mark(end - 1, end);
            decorations.push(code.range(line.from + start + 1, line.from + end - 1));
          }
          for (const match of text.matchAll(/!?\[([^\]\n]+)\]\((?!\s*<?field:)[^)\n]*\)/gi)) {
            const start = match.index ?? 0, end = start + match[0].length;
            if (overlapsHidden(line.from + start, line.from + end)) continue;
            const labelStart = start + match[0].indexOf('[') + 1, labelEnd = labelStart + match[1].length;
            mark(start, labelStart); mark(labelEnd, end);
            decorations.push(link.range(line.from + labelStart, line.from + labelEnd));
          }
        }
        if (kind === 'text' || kind === 'quote' || kind === 'list') {
          let end = line.to;
          while (end > line.from && /\s/.test(text[end - line.from - 1])) end--;
          const start = keepStart(text, line.from, end, hidden, KEEP_CHARACTERS);
          const tail = text.slice(start - line.from, end - line.from);
          // Inline syntax at the very end (a closing ** or `) is left alone: the mark would cut through its decorations.
          if (end - start >= 2 && start > line.from && !/[*_`]/.test(tail)) decorations.push(keep.range(start, end));
        }
      }
      if (line.to >= to || line.number >= state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
  }
  return Decoration.set(decorations, true);
}

export const markdownPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = build(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged
      || update.startState.field(referenceField) !== update.state.field(referenceField)) this.decorations = build(update.view);
  }
}, { decorations: plugin => plugin.decorations });

export const markdownExtension = [structureField, markdownPlugin];
