import { forwardRef, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import { Copy, PenLine, Plus } from 'lucide-react';
import { ThreadIcon } from '../icons/field-icons';
import type { TextRange } from './shared';
import { keepEditorFocus } from './shared';
import { blockAt, isBlockPart } from './reading-markdown';
import type { InlineRun, ListBlock, ReadingBlock, ReadingDocument, ReadingPart } from './reading-markdown';
import { rangeForOffsets, readingSelection } from './reading-selection';
import { withShortcut } from '../dialogs/shortcuts';

/**
 * Natural reading surface (DESIGN_SYSTEM §6.18.3). Its DOM text equals the LF-normalized body exactly (K9-13):
 * Markdown syntax and block gaps sit in hidden `.md-mark` spans, paragraph numbers are pseudo-elements, and the
 * located quotation, excerpt traces and formatting only wrap existing text. Everything that is not source text
 * (the “已摘录” margin notes and the selection toolbar) renders beside `.inspector-reading-body`, never inside it.
 */

/** A passage already excerpted to the canvas; `quoteIds` are the quote cards that hold it. */
export interface ReadingTrace { from: number; to: number; quoteIds: string[] }

interface Piece extends InlineRun { located: boolean; quotes: string }

const PARA_ATTR = 'data-para';

function cutPoints(from: number, to: number, located: TextRange | null, traces: ReadingTrace[]): number[] {
  const points = new Set<number>();
  const add = (value: number) => { if (value > from && value < to) points.add(value); };
  if (located) { add(located.from); add(located.to); }
  for (const trace of traces) { add(trace.from); add(trace.to); }
  return [...points].sort((a, b) => a - b);
}

function decorate(runs: InlineRun[], located: TextRange | null, traces: ReadingTrace[]): Piece[] {
  const pieces: Piece[] = [];
  for (const run of runs) {
    const relevant = traces.filter(trace => trace.from < run.to && trace.to > run.from);
    const points = [run.from, ...cutPoints(run.from, run.to, located, relevant), run.to];
    for (let index = 0; index < points.length - 1; index++) {
      const from = points[index], to = points[index + 1];
      const quotes = relevant.filter(trace => trace.from <= from && trace.to >= to).flatMap(trace => trace.quoteIds);
      pieces.push({ ...run, from, to, located: !!located && from >= located.from && to <= located.to, quotes: [...new Set(quotes)].join(' ') });
    }
  }
  return pieces;
}

function renderPiece(text: string, piece: Piece, key: string): ReactNode {
  const content = text.slice(piece.from, piece.to);
  if (piece.hidden) return <span key={key} className="md-mark" aria-hidden="true">{content}</span>;
  if (piece.soft) return <span key={key} className={piece.headingLine ? 'md-soft md-soft--heading' : 'md-soft'}>{content}</span>;
  let node: ReactNode = content;
  if (piece.code) node = <code>{node}</code>;
  if (piece.strike) node = <s>{node}</s>;
  if (piece.em) node = <em>{node}</em>;
  if (piece.strong) node = <strong>{node}</strong>;
  if (piece.imageAlt) node = <span className="md-image">{node}</span>;
  if (piece.link) node = piece.href
    ? <a className="md-link" href={piece.href} target="_blank" rel="noopener noreferrer">{node}</a>
    : <span className="md-link">{node}</span>;
  if (piece.headingLine) node = <span className={`md-hline md-hline--${Math.min(4, piece.headingLine)}`}>{node}</span>;
  return typeof node === 'string' ? node : <span key={key} className="md-run">{node}</span>;
}

function renderTraceGroups(text: string, pieces: Piece[], key: string): ReactNode[] {
  const out: ReactNode[] = [];
  for (let index = 0; index < pieces.length;) {
    const quotes = pieces[index].quotes;
    let end = index;
    while (end < pieces.length && pieces[end].quotes === quotes) end++;
    const children = pieces.slice(index, end).map((piece, offset) => renderPiece(text, piece, `${key}-${index + offset}`));
    out.push(quotes ? <span key={`${key}-t${index}`} className="reading-trace is-excerpt" data-quotes={quotes}>{children}</span> : children);
    index = end;
  }
  return out;
}

function renderPieces(text: string, pieces: Piece[], key: string, markLabel = '摘录原文'): ReactNode[] {
  const out: ReactNode[] = [];
  for (let index = 0; index < pieces.length;) {
    const located = pieces[index].located;
    let end = index;
    while (end < pieces.length && pieces[end].located === located) end++;
    const group = renderTraceGroups(text, pieces.slice(index, end), `${key}-${index}`);
    out.push(located ? <mark key={`${key}-m${index}`} className="inspector-source-highlight" aria-label={markLabel}>{group}</mark> : group);
    index = end;
  }
  return out;
}

function partRuns(part: ReadingPart): InlineRun[] {
  if (part.kind === 'gap') return [{ from: part.from, to: part.to, hidden: true }];
  if (part.kind === 'list') return part.items.flatMap(item => item.runs);
  return part.runs;
}

const headingTag = (level: number) => (level <= 1 ? 'h2' : level === 2 ? 'h3' : level === 3 ? 'h4' : 'h5');

function renderBlock(text: string, block: ReadingBlock, located: TextRange | null, traces: ReadingTrace[], hiddenHeading: number | null, shift = 0, markLabel?: string): ReactNode {
  const key = `b${block.from}`;
  const local = traces.filter(trace => trace.from < block.to && trace.to > block.from);
  const pieces = (runs: InlineRun[]) => renderPieces(text, decorate(runs, located, local), key, markLabel);
  const common = { 'data-from': block.from, 'data-provenance': local.length ? 'excerpt' : undefined } as const;
  switch (block.kind) {
    case 'heading': {
      // The highest heading level shown is drawn as h2 21/30, the next as h3 18/26 (§3.4): a text whose sections are
      // “##” under a hidden “#” title no longer gets section headings barely larger than its 17px body (INSP-22).
      const level = Math.max(1, block.level - shift);
      const Tag = headingTag(level);
      return <Tag key={key} {...common} className={`md-block md-heading md-heading--${Math.min(4, level)}${block.from === hiddenHeading ? ' is-duplicate-title' : ''}`} data-heading={block.from}>{pieces(block.runs)}</Tag>;
    }
    case 'paragraph':
      return <p
        key={key} {...common}
        className={['md-block md-p', block.prose && 'is-prose', block.sectionTitle && 'md-section-title', block.leadHeading && 'has-lead-heading', block.from === hiddenHeading && 'is-duplicate-title'].filter(Boolean).join(' ')}
        {...{ [PARA_ATTR]: block.para }}
        {...(block.sectionTitle || block.leadHeading ? { 'data-heading': block.from } : {})}
      >{pieces(block.runs)}</p>;
    case 'quote':
      return <blockquote key={key} {...common} className="md-block md-quote" {...{ [PARA_ATTR]: block.para }}>{pieces(block.runs)}</blockquote>;
    case 'code':
      // One <code> for the whole block: its runs are plain text inside it (no inline-code chips within code).
      return <pre key={key} {...common} className={['md-block md-code', block.continued && 'is-continued', block.continues && 'is-continuing'].filter(Boolean).join(' ')} {...{ [PARA_ATTR]: block.para }}><code>{pieces(block.runs.map(run => (run.code ? { ...run, code: false } : run)))}</code></pre>;
    case 'rule':
      return <div key={key} {...common} className="md-block md-rule" role="separator">{pieces(block.runs)}</div>;
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return <List key={key} {...common} className="md-block md-list" {...{ [PARA_ATTR]: block.para }} {...(block.ordered && block.start !== 1 ? { start: block.start } : {})}>
        {block.items.map(item => <li
          key={`i${item.from}`}
          className={[item.depth ? `md-depth-${item.depth}` : '', item.task ? `md-task md-task--${item.task}` : ''].filter(Boolean).join(' ') || undefined}
        >{renderPieces(text, decorate(item.runs, located, local), `${key}-i${item.from}`, markLabel)}</li>)}
      </List>;
    }
  }
}

/**
 * A located quotation that crosses blocks (or list items) still has to be one `mark 摘录原文` (K4, scripts compare
 * its text). Those blocks render flat for as long as the location is shown: one pre-wrap block whose gaps and list
 * markers are visible text, headings styled inline.
 */
function renderFlat(text: string, parts: ReadingPart[], located: TextRange, traces: ReadingTrace[], markLabel?: string): ReactNode {
  const first = parts.find(isBlockPart)!;
  const firstPara = parts.find((part): part is Exclude<ReadingBlock, { kind: 'heading' }> => isBlockPart(part) && part.kind !== 'heading');
  const runs: InlineRun[] = parts.flatMap(part => {
    const level = part.kind === 'heading' ? part.level : 0;
    return partRuns(part).map(run => {
      const syntaxOnlyWhitespace = run.hidden && !text.slice(run.from, run.to).trim();
      const listMarker = part.kind === 'list' && run.hidden && (part as ListBlock).items.some(item => item.from === run.from);
      if (syntaxOnlyWhitespace || listMarker) return { from: run.from, to: run.to, soft: true };
      return level && !run.hidden ? { ...run, headingLine: level } : run;
    });
  });
  const local = traces.filter(trace => trace.from < runs[runs.length - 1].to && trace.to > runs[0].from);
  return <div key={`flat${first.from}`} data-from={first.from} data-provenance={local.length ? 'excerpt' : undefined} className="md-block md-flat" {...(firstPara ? { [PARA_ATTR]: firstPara.para } : {})}>
    {renderPieces(text, decorate(runs, located, local), `flat${first.from}`, markLabel)}
  </div>;
}

function crossesBlocks(document: ReadingDocument, range: TextRange): boolean {
  const start = blockAt(document, range.from), end = blockAt(document, Math.max(range.from, range.to - 1));
  if (!start || !end) return false;
  if (start !== end) return true;
  if (start.kind !== 'list') return false;
  const item = (offset: number) => start.items.findIndex(entry => offset < entry.to);
  return item(range.from) !== item(range.to - 1);
}

function renderDocument(document: ReadingDocument, located: TextRange | null, traces: ReadingTrace[], hiddenHeading: number | null, markLabel?: string): ReactNode[] {
  const { text, parts } = document;
  const flat = located && crossesBlocks(document, located)
    ? { from: blockAt(document, located.from)!.from, to: blockAt(document, located.to - 1)!.to }
    : null;
  const shown = parts.filter((part): part is Extract<ReadingBlock, { kind: 'heading' }> => part.kind === 'heading' && part.from !== hiddenHeading);
  const shift = shown.length ? Math.min(...shown.map(part => part.level)) - 1 : 0;
  const out: ReactNode[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (flat && part.from >= flat.from && part.to <= flat.to) {
      let end = index;
      while (end < parts.length && parts[end].to <= flat.to) end++;
      out.push(renderFlat(text, parts.slice(index, end), located!, traces, markLabel));
      index = end - 1;
      continue;
    }
    out.push(part.kind === 'gap'
      ? <span key={`g${part.from}`} className="md-mark md-gap" aria-hidden="true">{text.slice(part.from, part.to)}</span>
      : renderBlock(text, part, located, traces, hiddenHeading, shift, markLabel));
  }
  return out;
}

interface ReadingBodyProps {
  document: ReadingDocument;
  hiddenHeading: number | null;
  located: TextRange | null;
  /** Accessible name of the located range's mark: “摘录原文” (K4), “搜索结果” after a search. */
  markLabel?: string;
  traces: ReadingTrace[];
  onMouseUp: () => void;
  onKeyUp: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: () => void;
}

/** The article itself. Memoized: selection, margin notes and the toolbar never re-render the text. */
const ReadingBody = memo(forwardRef<HTMLDivElement, ReadingBodyProps>(function ReadingBody({ document, hiddenHeading, located, markLabel, traces, onMouseUp, onKeyUp, onKeyDown, onPointerDown }, ref) {
  return <div
    ref={ref}
    className="inspector-reading-body"
    role="document"
    aria-label="资料阅读正文"
    tabIndex={0}
    onMouseUp={onMouseUp}
    onKeyUp={onKeyUp}
    onKeyDown={onKeyDown}
    onPointerDown={onPointerDown}
  >{renderDocument(document, located, traces, hiddenHeading, markLabel)}</div>;
}), (previous, next) => previous.document === next.document && previous.traces === next.traces && previous.hiddenHeading === next.hiddenHeading
  && previous.located?.from === next.located?.from && previous.located?.to === next.located?.to && previous.markLabel === next.markLabel
  && previous.onMouseUp === next.onMouseUp && previous.onKeyUp === next.onKeyUp && previous.onKeyDown === next.onKeyDown);

/** Docked sticky toolbar (48) + 36 breathing room. The 52px shell header sits outside the scroller. */
export const READING_SCROLL_MARGIN = 84;

/**
 * Scroll only the panel's own scroller (never the page or the sticky left column) so `element` lands at the top
 * margin or in the middle. `scrollIntoView` would also move other scroll ancestors and cancel a smooth scroll that
 * is still running when the contents column keeps its current entry in view.
 */
export function scrollReadingTo(element: Element, place: 'start' | 'center', instant: boolean) {
  const scroller = element.closest<HTMLElement>('.inspector-scroll');
  if (!scroller) { element.scrollIntoView({ block: place, behavior: instant ? 'auto' : 'smooth' }); return; }
  const box = scroller.getBoundingClientRect(), rect = element.getBoundingClientRect();
  const delta = place === 'start' ? rect.top - box.top - READING_SCROLL_MARGIN : rect.top + rect.height / 2 - box.top - scroller.clientHeight / 2;
  scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + delta), behavior: instant ? 'auto' : 'smooth' });
}

/** Scroll the article to an excerpt trace and let it pulse once (from the “本文已摘录” list). */
export function scrollToTrace(body: HTMLElement | null, quoteId: string, instant: boolean): boolean {
  const spans = body ? [...body.querySelectorAll<HTMLElement>('.reading-trace[data-quotes]')].filter(span => span.dataset.quotes?.split(' ').includes(quoteId)) : [];
  if (!spans.length) return false;
  scrollReadingTo(spans[0], 'center', instant);
  for (const span of spans) { span.classList.remove('is-pulse'); void span.offsetWidth; span.classList.add('is-pulse'); }
  window.setTimeout(() => { for (const span of spans) span.classList.remove('is-pulse'); }, 1400);
  return true;
}

/** `end`: narrow columns place the visible excerpt label below the paragraph, outside source text. */
interface MarginNote { top: number; left: number; quoteIds: string[]; end?: boolean }
type ToolbarPlacement = { mode: 'margin' | 'above' | 'below'; top: number; left: number; compact?: boolean } | null;

/** `compact`: the narrower margin bar (short labels) for a margin of 106–151px, e.g. 1440 wide with the contents column. */
const TOOLBAR = { width: 148, compact: 100, gap: 12, rowHeight: 32, padding: 4 } as const;
const STRIP_HEIGHT = 40;

export interface TextReadingProps {
  document: ReadingDocument;
  /** A first heading that only repeats the card title (shown above the article): kept in the text, not displayed. */
  hiddenHeading?: number | null;
  /** Margin notes reveal the quote on the canvas (true) or open it (false, until App offers revealCard). */
  revealsOnCanvas?: boolean;
  range: TextRange | null;
  traces?: ReadingTrace[];
  /** The current excerpt-able selection (offsets into the body), or null. */
  selection?: TextRange | null;
  readOnly?: boolean;
  onSelection: (range: TextRange | null) => void;
  onExcerpt?: (understand: boolean) => void;
  onRevealQuote?: (quoteId: string) => void;
  /** Extra keys handled on the article (E, Alt+↓/↑ sentences, Ctrl+A, Alt+←). Return true when handled. */
  onCommand?: (event: ReactKeyboardEvent<HTMLDivElement>) => boolean;
  bodyRef?: RefObject<HTMLDivElement | null>;
  /** Accessible names for the margin notes (“在画布上找到摘录：…”). */
  quoteLabel?: (quoteId: string) => string;
  /** What the located range is (CORE-05): an excerpt's original (default, “摘录原文”) or a search hit (“搜索结果”). */
  rangeOrigin?: 'search';
}

const NO_TRACES: ReadingTrace[] = [];

export default function TextReading({ document, hiddenHeading = null, revealsOnCanvas = false, range, traces = NO_TRACES, selection = null, readOnly = false, onSelection, onExcerpt, onRevealQuote, onCommand, bodyRef: externalBodyRef, quoteLabel, rangeOrigin }: TextReadingProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const ownBodyRef = useRef<HTMLDivElement>(null);
  const bodyRef = externalBodyRef ?? ownBodyRef;
  const pointerDown = useRef(false);
  const latest = useRef({ onSelection, onCommand, selection });
  latest.current = { onSelection, onCommand, selection };
  const [notes, setNotes] = useState<MarginNote[]>([]);
  const [placement, setPlacement] = useState<ToolbarPlacement>(null);
  const [copied, setCopied] = useState(false);
  const [measureTick, setMeasureTick] = useState(0);

  const report = useCallback(() => {
    const body = bodyRef.current;
    if (body) latest.current.onSelection(readingSelection(body));
  }, [bodyRef]);
  const onMouseUp = useCallback(() => { pointerDown.current = false; report(); }, [report]);
  const onKeyUp = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.shiftKey || event.key.startsWith('Arrow')) report();
  }, [report]);
  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (latest.current.onCommand?.(event)) { event.preventDefault(); event.stopPropagation(); }
  }, []);
  const onPointerDown = useCallback(() => { pointerDown.current = true; }, []);

  // The selection collapses elsewhere (a click outside, a caret in another field): forget it. A selection made
  // without the mouse (caret browsing, restored selections) is reported once it settles.
  useEffect(() => {
    let frame = 0;
    const onChange = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const body = bodyRef.current;
        if (!body?.isConnected || pointerDown.current) return;
        const current = window.getSelection();
        const inside = !!current?.rangeCount && !current.isCollapsed && body.contains(current.getRangeAt(0).startContainer) && body.contains(current.getRangeAt(0).endContainer);
        if (inside) {
          const next = readingSelection(body);
          const known = latest.current.selection;
          if (next && (!known || known.from !== next.from || known.to !== next.to)) latest.current.onSelection(next);
        } else if (latest.current.selection) latest.current.onSelection(null);
      });
    };
    const onUp = () => { pointerDown.current = false; };
    window.document.addEventListener('selectionchange', onChange);
    window.addEventListener('pointerup', onUp);
    return () => { window.document.removeEventListener('selectionchange', onChange); window.removeEventListener('pointerup', onUp); if (frame) cancelAnimationFrame(frame); };
  }, [bodyRef]);

  // Return to a located quotation: centre it; the sticky notice above stays readable (PR-M3).
  useLayoutEffect(() => {
    const mark = range ? bodyRef.current?.querySelector('mark.inspector-source-highlight') : null;
    if (mark) scrollReadingTo(mark, 'center', true);
  }, [range?.from, range?.to]);

  // Re-measure margin positions when the article reflows (panel width, fonts, layout switch).
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let frame = 0;
    const bump = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; setMeasureTick(value => value + 1); }); };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(bump) : null;
    observer?.observe(body);
    void window.document.fonts?.ready.then(bump);
    return () => { observer?.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [bodyRef]);

  // “已摘录” notes in the right margin, level with the first line of each trace; notes on one line merge.
  useLayoutEffect(() => {
    const body = bodyRef.current, surface = surfaceRef.current;
    if (!body || !surface || !traces.length) { setNotes(previous => (previous.length ? [] : previous)); return; }
    const origin = surface.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    const scroller = body.closest<HTMLElement>('.inspector-scroll');
    const contentRight = scroller ? scroller.getBoundingClientRect().left + scroller.clientWidth : window.innerWidth;
    // The note needs a real margin. Narrow columns reserve a band below each excerpted block for a visible label.
    if (contentRight - bodyBox.right < 96) {
      const ends = new Map<Element, MarginNote>();
      for (const span of body.querySelectorAll<HTMLElement>('.reading-trace[data-quotes]')) {
        const block = span.closest('.md-block');
        if (!block) continue;
        const ids = (span.dataset.quotes ?? '').split(' ').filter(Boolean);
        const known = ends.get(block);
        if (known) { for (const id of ids) if (!known.quoteIds.includes(id)) known.quoteIds.push(id); continue; }
        const range = window.document.createRange();
        range.selectNodeContents(block);
        const last = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).at(-1);
        if (!last) continue;
        ends.set(block, { top: block.getBoundingClientRect().bottom - origin.top + 2, left: Math.max(0, bodyBox.right - origin.left - 84), quoteIds: ids, end: true });
      }
      setNotes([...ends.values()]);
      return;
    }
    const left = bodyBox.right - origin.left + 16;
    const seen = new Set<string>();
    const found: MarginNote[] = [];
    for (const span of body.querySelectorAll<HTMLElement>('.reading-trace[data-quotes]')) {
      const ids = (span.dataset.quotes ?? '').split(' ').filter(id => id && !seen.has(id));
      if (!ids.length) continue;
      const rect = [...span.getClientRects()].find(item => item.width > 0 && item.height > 0);
      if (!rect) continue;
      ids.forEach(id => seen.add(id));
      found.push({ top: rect.top - origin.top + rect.height / 2 - 12, left, quoteIds: ids });
    }
    found.sort((a, b) => a.top - b.top);
    const merged: MarginNote[] = [];
    for (const note of found) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(note.top - last.top) < 6) last.quoteIds.push(...note.quoteIds);
      else merged.push({ ...note, top: last ? Math.max(note.top, last.top + 28) : note.top });
    }
    setNotes(merged);
  }, [traces, document, measureTick, range?.from, range?.to]);

  // The selection toolbar: in the right margin level with the first selected line; above the selection when the
  // margin is too narrow (below when there is no room above). It never covers the selected words.
  useLayoutEffect(() => {
    const body = bodyRef.current, surface = surfaceRef.current;
    if (!body || !surface || !selection) { setPlacement(null); return; }
    const dom = rangeForOffsets(body, selection);
    const rects = dom ? [...dom.getClientRects()].filter(rect => rect.width > 0.5 && rect.height > 0) : [];
    if (!rects.length) { setPlacement(null); return; }
    const origin = surface.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    const scroller = body.closest<HTMLElement>('.inspector-scroll');
    const viewport = scroller?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const contentRight = scroller ? viewport.left + scroller.clientWidth : viewport.right;
    const first = rects[0], last = rects[rects.length - 1];
    // §6.18.3: the bar stands in the right margin whenever that margin is at least 152 wide (148 + a 4px gap at least).
    // A narrower margin still takes the bar, with short labels (INSP-04): above the text it would cover the line above.
    const margin = contentRight - bodyBox.right;
    const compact = margin < TOOLBAR.width + 4;
    const barWidth = compact ? TOOLBAR.compact : TOOLBAR.width;
    if (margin >= barWidth + 6) {
      const gap = Math.min(TOOLBAR.gap, margin - barWidth);
      setPlacement({ mode: 'margin', compact, left: bodyBox.right - origin.left + gap, top: first.top - origin.top + first.height / 2 - TOOLBAR.padding - TOOLBAR.rowHeight / 2 });
      return;
    }
    const width = Math.min(surface.clientWidth, 340);
    const left = Math.max(0, Math.min(first.left - origin.left - 8, surface.clientWidth - width));
    const roomAbove = first.top - viewport.top - (STRIP_HEIGHT + 56);
    // Without a margin the bar looks for a band with no words in it (INSP-04): the space right of a short line or a
    // heading above the selection, or below it, or a paragraph gap. Only when every line there is full does it fall
    // back to sitting over the line above (never over the selected words).
    const stripWidth = surface.querySelector<HTMLElement>('.reading-selection-bar--above, .reading-selection-bar--below')?.offsetWidth || 288;
    const textRight = (top: number, bottom: number) => {
      let right = Number.NEGATIVE_INFINITY;
      for (const block of body.querySelectorAll<HTMLElement>('.md-block')) {
        const box = block.getBoundingClientRect();
        if (box.bottom <= top || box.top >= bottom) continue;
        const range = window.document.createRange();
        range.selectNodeContents(block);
        for (const rect of range.getClientRects()) if (rect.width > 0 && rect.bottom > top + 2 && rect.top < bottom - 2) right = Math.max(right, rect.right);
      }
      return right;
    };
    const aboveTop = first.top - STRIP_HEIGHT - 8, belowTop = last.bottom + 8;
    /** Where the bar can start in a band without covering words (right of the band's last word), or null. */
    const spot = (top: number) => {
      const right = textRight(top, top + STRIP_HEIGHT);
      return right + 8 + stripWidth <= bodyBox.right ? Math.max(left, right + 8 - origin.left) : null;
    };
    const above = roomAbove >= 8 ? spot(aboveTop) : null;
    const below = above === null && belowTop + STRIP_HEIGHT + 8 <= viewport.bottom ? spot(belowTop) : null;
    if (above !== null) setPlacement({ mode: 'above', left: above, top: aboveTop - origin.top });
    else if (below !== null) setPlacement({ mode: 'below', left: below, top: belowTop - origin.top });
    else if (roomAbove >= 8) setPlacement({ mode: 'above', left, top: aboveTop - origin.top });
    else setPlacement({ mode: 'below', left, top: belowTop - origin.top });
  }, [selection?.from, selection?.to, document, measureTick]);

  useEffect(() => { setCopied(false); }, [selection?.from, selection?.to]);

  const copy = async () => {
    const text = window.getSelection()?.toString() ?? '';
    let done = false;
    try { if (text && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); done = true; } } catch { /* fall back below */ }
    if (!done) { try { done = window.document.execCommand('copy'); } catch { done = false; } }
    setCopied(done);
  };

  const bar = selection && placement && <div
    className={`reading-selection-bar reading-selection-bar--${placement.mode}${placement.compact ? ' is-compact' : ''}`}
    role="toolbar"
    aria-label="文字摘录"
    aria-orientation={placement.mode === 'margin' ? 'vertical' : 'horizontal'}
    style={{ top: placement.top, left: placement.left }}
    onPointerDown={keepEditorFocus}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (latest.current.onCommand?.(event)) { event.preventDefault(); return; }
      const keys = placement.mode === 'margin' ? ['ArrowDown', 'ArrowUp'] : ['ArrowRight', 'ArrowLeft'];
      if (!keys.includes(event.key)) return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(window.document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === keys[0] ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      event.preventDefault();
    }}
  >
    <button type="button" className="reading-selection-bar__item reading-selection-bar__item--primary" aria-label="摘录选中文字到画布" aria-keyshortcuts="E" title={readOnly ? '此窗口只读' : withShortcut('摘录到画布', 'excerpt')} disabled={readOnly} onClick={() => onExcerpt?.(false)}>
      <Plus size={16} aria-hidden="true" /><span>摘录</span><kbd aria-hidden="true">E</kbd>
    </button>
    <button type="button" className="reading-selection-bar__item" aria-label={placement.compact ? '摘录并写理解' : undefined} title={readOnly ? '此窗口只读' : '摘录后接着写理解'} disabled={readOnly} onClick={() => onExcerpt?.(true)}>
      <PenLine size={16} aria-hidden="true" /><span aria-hidden={placement.compact || undefined}>{placement.compact ? '写理解' : '摘录并写理解'}</span>
    </button>
    <button type="button" className="reading-selection-bar__item" aria-label={copied ? '已复制选中文字' : '复制选中文字'} onClick={() => void copy()}>
      <Copy size={16} aria-hidden="true" /><span aria-hidden="true">{copied ? '已复制' : '复制'}</span>
    </button>
  </div>;

  return <div ref={surfaceRef} className="reading-surface" data-notes={notes.some(note => note.end) ? 'end' : 'margin'}>
    <ReadingBody
      ref={bodyRef}
      document={document}
      hiddenHeading={hiddenHeading}
      located={range}
      markLabel={rangeOrigin === 'search' ? '搜索结果' : undefined}
      traces={traces}
      onMouseUp={onMouseUp}
      onKeyUp={onKeyUp}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    />
    {notes.length > 0 && <div className="reading-margin">
      {notes.map(note => note.end ? <button
        key={note.quoteIds.join(' ')}
        type="button"
        className="reading-used reading-used--end"
        style={{ top: note.top, left: note.left }}
        aria-label={`已摘录：${quoteLabel?.(note.quoteIds[0]) ?? '已摘录的文字'}${note.quoteIds.length > 1 ? `，共 ${note.quoteIds.length} 条` : ''}`}
        title={revealsOnCanvas ? '已摘录，点按在画布上找到这张摘录' : '已摘录，点按打开这张摘录'}
        disabled={!onRevealQuote}
        onClick={() => onRevealQuote?.(note.quoteIds[0])}
      ><ThreadIcon size={14} /><span>已摘录</span>{note.quoteIds.length > 1 && <span className="tabular">{note.quoteIds.length}</span>}</button> : <button
        key={note.quoteIds.join(' ')}
        type="button"
        className="reading-used"
        style={{ top: note.top, left: note.left }}
        aria-label={`${revealsOnCanvas ? '在画布上找到摘录' : '打开摘录'}：${quoteLabel?.(note.quoteIds[0]) ?? '已摘录的文字'}`}
        title={revealsOnCanvas ? '在画布上找到这张摘录' : '打开这张摘录'}
        disabled={!onRevealQuote}
        onClick={() => onRevealQuote?.(note.quoteIds[0])}
      ><ThreadIcon size={14} /><span>已摘录</span>{note.quoteIds.length > 1 && <span className="tabular">{note.quoteIds.length}</span>}</button>)}
    </div>}
    {bar}
  </div>;
}
