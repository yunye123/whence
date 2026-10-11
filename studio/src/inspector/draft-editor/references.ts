import { Facet, RangeSet, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { analyzeDraftReferences, analyzeUncached, strayInternalLinks, type DraftReferenceSpan } from './reference-analysis';

// The span type and the pure analysis live in reference-analysis.ts (no CodeMirror, CORE-32); re-exported here.
export type { DraftReferenceSpan } from './reference-analysis';
export { analyzeDraftReferences, strayInternalLinks } from './reference-analysis';

/**
 * A range view of the body (a script cell, §6.29): its document is one paragraph of the draft, so its references are
 * numbered from `base` + 1 (the references before it), and it is analysed apart from the body's remembered result.
 */
export const referenceScope = Facet.define<{ base: number }, { base: number } | null>({ combine: values => values[0] ?? null });

function scopedAnalysis(doc: string, scope: { base: number } | null): DraftReferenceSpan[] {
  if (!scope) return analyzeDraftReferences(doc);
  const spans = analyzeUncached(doc);
  return scope.base ? spans.map(span => ({ ...span, index: span.index + scope.base })) : spans;
}

export interface ReferenceInfo { title: string; location?: string; gone?: boolean }

/** Labels for the widgets' tooltips and accessible names, resolved from the board by the React side. */
export const setReferenceInfo = StateEffect.define<ReadonlyMap<number, ReferenceInfo>>();
/** Pointer hover from the margin card or the superscript itself (null clears it). */
export const setReferenceHover = StateEffect.define<number | null>();

/** Full-width closing punctuation leaves half an em of air on its right; the superscript tucks into it. */
const CLOSING_PUNCTUATION = /[、。，；：！？）」』”’》〉】]/;

class ReferenceWidget extends WidgetType {
  constructor(readonly index: number, readonly mode: 'sup' | 'label', readonly active: boolean, readonly info: ReferenceInfo | undefined, readonly afterPunct = false, readonly sourceLine = false) { super(); }
  eq(other: ReferenceWidget) {
    return other.index === this.index && other.mode === this.mode && other.active === this.active && other.afterPunct === this.afterPunct && other.sourceLine === this.sourceLine
      && other.info?.title === this.info?.title && other.info?.location === this.info?.location && other.info?.gone === this.info?.gone;
  }
  toDOM() {
    const name = `第 ${this.index} 处引用${this.info ? `：${this.info.title}${this.info.location ? ` ${this.info.location}` : ''}` : ''}`;
    const sup = document.createElement('sup');
    sup.className = `cm-ref${this.active ? ' is-active' : ''}${this.info?.gone ? ' is-gone' : ''}${this.afterPunct && this.mode === 'sup' ? ' is-after-punct' : ''}`;
    sup.textContent = String(this.index);
    sup.dataset.refIndex = String(this.index);
    sup.title = this.info?.gone ? `${name}（来源卡片已不在当前画布）` : name;
    sup.setAttribute('aria-label', name);
    if (this.mode === 'sup' && !this.sourceLine) return sup;
    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.tabIndex = -1; // Alt+Enter at the atomic range is the editor's keyboard route.
    wrap.setAttribute('contenteditable', 'false');
    wrap.setAttribute('aria-label', name);
    wrap.title = sup.title;
    wrap.className = `cm-ref-label${this.active ? ' is-active' : ''}`;
    wrap.classList.add('nodrag', 'nopan', 'tag-btn');
    wrap.dataset.refIndex = String(this.index);
    const title = document.createElement('span');
    title.className = 'cm-ref-label__title';
    title.textContent = this.info?.title || '来源';
    if (!this.sourceLine) { wrap.append(sup, title); return wrap; }
    const stamp = document.createElement('span');
    stamp.className = `tag tag--stamp${this.info?.gone ? ' tag--gone' : ''}`;
    const head = document.createElement('span');
    head.className = 'tag__head';
    head.setAttribute('aria-hidden', 'true');
    // The shared stamp's solid glyph geometry; no HTML from source text enters the widget.
    const video = !!this.info?.location && /^\d{2,}:\d{2}/.test(this.info.location);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'tag__icon');
    svg.setAttribute('viewBox', video ? '0 0 24 24' : '0 0 9 12');
    svg.setAttribute('data-provenance-icon', video ? 'video' : 'text');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', video ? 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z' : 'M3.9 .6H8.6V11.4H7V2.1H5.9V11.4H4.3V7H3.9A3.2 3.2 0 0 1 3.9 .6Z');
    svg.append(path); head.append(svg);
    const location = document.createElement('span');
    location.className = 'tag__body';
    location.textContent = this.info?.location || '查看来源';
    stamp.append(head, location);
    wrap.append(stamp, title);
    return wrap;
  }
  ignoreEvent() { return true; }
}

class StrayLinkWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-ref-stray';
    span.textContent = '内部链接';
    span.title = '画布内部链接（只在来处里有效）';
    return span;
  }
  ignoreEvent() { return false; }
}

interface ReferenceState {
  doc: string;
  spans: DraftReferenceSpan[];
  info: ReadonlyMap<number, ReferenceInfo>;
  hover: number | null;
  active: number | null;
  decorations: DecorationSet;
  atomic: RangeSet<Decoration>;
}

/** The reference the caret is in: inside its cited passage, or right next to its superscript. */
function activeFromSelection(state: EditorState, spans: readonly DraftReferenceSpan[]): number | null {
  const head = state.selection.main.head;
  for (const span of spans) {
    if (head === span.hideFrom || head === span.hideTo) return span.index;
    if (span.citedFrom !== undefined && span.citedTo !== undefined && head >= span.citedFrom && head <= span.citedTo) return span.index;
  }
  return null;
}

function buildDecorations(doc: string, spans: readonly DraftReferenceSpan[], active: number | null, info: ReadonlyMap<number, ReferenceInfo>, scoped: boolean) {
  const ranges: Range<Decoration>[] = [];
  const atomic = new RangeSetBuilder<Decoration>();
  for (const span of spans) {
    const isActive = span.index === active;
    if (span.citedFrom !== undefined && span.citedTo !== undefined && span.citedTo > span.citedFrom) {
      ranges.push(Decoration.mark({ class: `cm-cite${isActive ? ' is-active' : ''}`, attributes: { 'data-ref-index': String(span.index) } }).range(span.citedFrom, span.citedTo));
    }
    const afterPunct = span.hideFrom > 0 && CLOSING_PUNCTUATION.test(doc[span.hideFrom - 1]);
    const lineFrom = span.from === 0 ? 0 : doc.lastIndexOf('\n', span.from - 1) + 1;
    const nextBreak = doc.indexOf('\n', span.to);
    const lineTo = nextBreak < 0 ? doc.length : nextBreak;
    const sourceLine = !scoped && !doc.slice(lineFrom, span.from).trim() && !doc.slice(span.to, lineTo).trim();
    ranges.push(Decoration.replace({ widget: new ReferenceWidget(span.index, span.mode, isActive, info.get(span.index), afterPunct, sourceLine) }).range(span.hideFrom, span.hideTo));
  }
  for (const stray of strayInternalLinks(doc, spans)) ranges.push(Decoration.replace({ widget: new StrayLinkWidget() }).range(stray.from, stray.to));
  const set = Decoration.set(ranges, true);
  // The cited passages share positions with the widgets; atomic ranges are only the hidden ones.
  const replaced = spans.map(span => ({ from: span.hideFrom, to: span.hideTo })).sort((a, b) => a.from - b.from);
  for (const range of replaced) if (range.to > range.from) atomic.add(range.from, range.to, Decoration.replace({}));
  return { decorations: set, atomic: atomic.finish() };
}

function compute(state: EditorState, previous: ReferenceState | null, info: ReadonlyMap<number, ReferenceInfo>, hover: number | null): ReferenceState {
  const doc = state.doc.toString();
  const spans = previous && previous.doc === doc ? previous.spans : scopedAnalysis(doc, state.facet(referenceScope));
  const active = hover ?? activeFromSelection(state, spans);
  if (previous && previous.doc === doc && previous.active === active && previous.info === info && previous.hover === hover) return previous;
  return { doc, spans, info, hover, active, ...buildDecorations(doc, spans, active, info, !!state.facet(referenceScope)) };
}

export const referenceField = StateField.define<ReferenceState>({
  create: state => compute(state, null, new Map(), null),
  update(value, transaction) {
    let info = value.info, hover = value.hover;
    for (const effect of transaction.effects) {
      if (effect.is(setReferenceInfo)) info = effect.value;
      if (effect.is(setReferenceHover)) hover = effect.value;
    }
    const rescoped = transaction.reconfigured && transaction.startState.facet(referenceScope) !== transaction.state.facet(referenceScope);
    if (!transaction.docChanged && !transaction.selection && info === value.info && hover === value.hover && !rescoped) return value;
    if (transaction.docChanged && hover !== null) hover = null;
    return compute(transaction.state, transaction.docChanged || rescoped ? null : value, info, hover);
  },
  provide: field => [
    EditorView.decorations.from(field, value => value.decorations),
    EditorView.atomicRanges.of(view => view.state.field(field).atomic),
  ],
});

export function referenceSpans(state: EditorState): readonly DraftReferenceSpan[] { return state.field(referenceField).spans; }
export function activeReference(state: EditorState): number | null { return state.field(referenceField).active; }
/** Positions covered by a reference widget, so the Markdown styling leaves them alone. */
export function hiddenRanges(state: EditorState): readonly { from: number; to: number }[] {
  return state.field(referenceField).spans.map(span => ({ from: span.hideFrom, to: span.hideTo }));
}

export const referenceExtension: Extension = referenceField;
