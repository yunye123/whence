import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, RefObject, SetStateAction } from 'react';
import { BookOpen, Pencil } from 'lucide-react';
import type { BoardNode, CardData, Citation } from '../model';
import { useBoard } from '../board-context';
import type { BoardActions } from '../board-context';
import { resolveTextAnchor } from '../text-anchor';
import type { TextAnchorMatch, TextAnchorResolution } from '../text-anchor';
import { paragraphIndexAt, plainMarkdown, quoteDisplayTitle } from '../source-location';
import TextReading from './TextReading';
import type { ReadingTrace } from './TextReading';
import ReadingLead, { ReadingLeadPopover } from './ReadingLead';
import type { ReadingExcerpt } from './ReadingLead';
import SourceLocationNotice from './SourceLocationNotice';
import { adjacentSentence, parseReadingDocument, trimToVisible } from './reading-markdown';
import type { ReadingDocument } from './reading-markdown';
import { caretTopInTextarea, offsetOfPoint, restoreReadingSelection } from './reading-selection';
import type { TextWalkNode } from './reading-selection';
import { READING_SCROLL_MARGIN } from './TextReading';
import { inspectorSessions } from './session-cache';
import { InspectorSlot, isEditableTarget, keepEditorFocus, useInspectorLayout } from './shared';
import { formatCount } from './draft-text';
import type { PatchCard, SourceReveal, TextRange, TextSelection } from './shared';
import { TranslationForCard } from './EnglishTranslation';

/** Optional App action (integration request inspector-shell / inspector-reading): bring a card into view. */
type RevealBoard = BoardActions & { revealCard?: (id: string) => void };

/** Imported text and saved post prose open in reading; a person's own notes keep opening in the editor (PR-M1). */
export function readsByDefault(data: CardData): boolean {
  if (!data.body.trim()) return false;
  if (data.kind === 'note') return !!data.tags?.includes('文字资料');
  return data.kind === 'link' && typeof data.sourceOriginalText === 'string';
}

/**
 * The first heading of the text when it only repeats the card title shown above the article — or, in a TXT file,
 * a first line on its own that is the title (INSP-11). It stays in the text and keeps its paragraph number
 * (paragraphIndexAt decides what counts), it is just not shown twice.
 */
export function duplicateTitleFrom(document: ReadingDocument, title: string): number | null {
  const first = document.parts.find(part => part.kind !== 'gap');
  const wanted = title.trim();
  if (!first || !wanted) return null;
  if (first.kind === 'heading') return first.text === wanted ? first.from : null;
  if (first.kind !== 'paragraph') return null;
  const line = document.text.slice(first.from, first.to).trim();
  return !/\n/.test(line) && line === wanted ? first.from : null;
}

/**
 * “10 月 2 日 22:15 收进这块画布”（§6.18.3 元信息第二行，INSP-21）。读卡片上的 `collectedAt`（ISO 时间，导入时写入；
 * 字段由 core 接入存储，见 integration/round3-fix-panels.md）；没有这项的旧卡片不写这一行。
 */
export function collectedLine(value: unknown, now = new Date()): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const day = `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${date.getFullYear() === now.getFullYear() ? day : `${date.getFullYear()} 年 ${day}`} ${time} 收进这块画布`;
}

function hostName(url?: string): string | undefined {
  if (!url) return undefined;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return undefined; }
}

/** Focus a field of the panel that is about to open (the quote just excerpted, “摘录并写理解”). */
function focusUnderstanding(tries = 40) {
  const tick = () => {
    const label = document.querySelector('.inspector label[for="card-body"]');
    const field = document.querySelector<HTMLTextAreaElement>('.inspector textarea#card-body');
    if (field && label?.textContent === '我的理解') { field.focus(); return; }
    if (--tries > 0) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Text material (note/link): reading/editing switch, quote location notice and the body (DESIGN_SYSTEM §6.18.3).
 * Both surfaces report selections as UTF-16 offsets into the LF-normalized body (contract A1). Mode switching,
 * scroll and selection carry-over live in the Inspector shell.
 */
export default function TextSourceSection({
  data, editorRef, normalizedBody, reading, setReading, changeReadingMode, setTextSelection, patch,
  sourceReveal, setSourceReveal, sourceLocation, sourceRange, revealCitation, chosenSourceMatch, setChosenSourceMatch,
  nodeId: nodeIdProp, textSelection,
}: {
  data: CardData;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  normalizedBody: string;
  reading: boolean;
  setReading: Dispatch<SetStateAction<boolean>>;
  changeReadingMode: (next: boolean) => void;
  setTextSelection: Dispatch<SetStateAction<TextSelection | null>>;
  patch: PatchCard;
  sourceReveal: SourceReveal | null;
  setSourceReveal: Dispatch<SetStateAction<SourceReveal | null>>;
  sourceLocation: TextAnchorResolution | null;
  sourceRange: TextAnchorMatch | null | undefined;
  revealCitation: Citation | undefined;
  chosenSourceMatch: number | null;
  setChosenSourceMatch: Dispatch<SetStateAction<number | null>>;
  /** The card being read (integration request); falls back to the inspected card. */
  nodeId?: string;
  /** The shell's current text selection (integration request); a local mirror is used until it is passed. */
  textSelection?: TextSelection | null;
}) {
  const board = useBoard() as RevealBoard;
  const layout = useInspectorLayout();
  const nodeId = nodeIdProp ?? board.inspectedId ?? '';
  const bodyRef = useRef<HTMLDivElement>(null);
  const document = useMemo(() => parseReadingDocument(normalizedBody), [normalizedBody]);
  const hiddenHeading = useMemo(() => duplicateTitleFrom(document, data.title), [document, data.title]);
  /** Contents without the hidden duplicate title (one object per text and title, so the contents never re-subscribe). */
  const headings = useMemo(() => (hiddenHeading === null ? document : { ...document, headings: document.headings.filter(heading => heading.blockFrom !== hiddenHeading) }), [document, hiddenHeading]);
  const characters = useMemo(() => Array.from(plainMarkdown(normalizedBody).replace(/\s+/g, '')).length, [normalizedBody]);

  // PR-M1 until the shell opens text materials in reading itself: switch once on the first visit of this card.
  const defaulted = useRef(false);
  useLayoutEffect(() => {
    if (defaulted.current) return;
    if (reading || !nodeId || !readsByDefault(data) || inspectorSessions.has(nodeId) || board.sourceTextReveal?.nodeId === nodeId) { defaulted.current = true; return; }
    setReading(true);
  });

  // Selection: the shell's value when it is passed, otherwise a mirror of what this section reported.
  const [mirror, setMirror] = useState<TextRange | null>(null);
  useEffect(() => { setMirror(null); }, [normalizedBody]);
  const selection: TextRange | null = textSelection !== undefined
    ? (textSelection && textSelection.bodySnapshot === data.body ? { from: textSelection.from, to: textSelection.to } : null)
    : mirror;
  const reportSelection = useCallback((range: TextRange | null) => {
    const trimmed = range ? trimToVisible(document, range.from, range.to) : null;
    const valid = trimmed && normalizedBody.slice(trimmed.from, trimmed.to).trim() ? trimmed : null;
    setMirror(previous => (previous?.from === valid?.from && previous?.to === valid?.to ? previous : valid));
    setTextSelection(previous => (previous && valid && previous.from === valid.from && previous.to === valid.to && previous.bodySnapshot === data.body ? previous : valid ? { ...valid, bodySnapshot: data.body } : null));
  }, [document, normalizedBody, data.body, setTextSelection]);

  // Quote cards cut from this text: traces in the article, the “本文已摘录” list, “第 N 段”.
  const quotes = useMemo(() => board.nodes.filter((node): node is BoardNode & { data: { citation: Citation } } => node.data.kind === 'quote' && node.data.citation?.nodeId === nodeId && !!node.data.citation), [board.nodes, nodeId]);
  const resolved = useMemo(() => quotes.map(quote => {
    const location = resolveTextAnchor(normalizedBody, quote.data.citation);
    const match = location.status === 'matched' ? location.matches[0] : undefined;
    const visible = match ? trimToVisible(document, match.from, match.to) : null;
    return { quote, visible, paragraph: match ? paragraphIndexAt(normalizedBody, match.from) : undefined };
  }), [quotes, normalizedBody, document]);
  const tracesKey = resolved.filter(item => item.visible).map(item => `${item.quote.id}:${item.visible!.from}-${item.visible!.to}`).join('|');
  const traces = useMemo<ReadingTrace[]>(() => {
    const byRange = new Map<string, ReadingTrace>();
    for (const item of resolved) {
      if (!item.visible) continue;
      const key = `${item.visible.from}-${item.visible.to}`;
      const existing = byRange.get(key);
      if (existing) existing.quoteIds.push(item.quote.id);
      else byRange.set(key, { ...item.visible, quoteIds: [item.quote.id] });
    }
    return [...byRange.values()].sort((a, b) => a.from - b.from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracesKey]);
  const excerpts = useMemo<ReadingExcerpt[]>(() => resolved
    .slice()
    .sort((a, b) => (a.visible?.from ?? Number.MAX_SAFE_INTEGER) - (b.visible?.from ?? Number.MAX_SAFE_INTEGER))
    .map(item => ({
      id: item.quote.id,
      text: plainMarkdown(item.quote.data.citation.text ?? item.quote.data.body).replace(/\n{2,}/g, '\n').trim(),
      understanding: item.quote.data.citation.text !== undefined ? item.quote.data.body.trim() || undefined : undefined,
      paragraph: item.visible ? item.paragraph : undefined,
      from: item.visible?.from,
    })), [resolved]);
  const quoteTitle = useCallback((id: string) => {
    const quote = quotes.find(item => item.id === id);
    return quote ? quoteDisplayTitle(quote.data) : '摘录';
  }, [quotes]);

  // “摘录并写理解”: open the new quote card with the caret in 我的理解.
  const pendingUnderstanding = useRef<Set<string> | null>(null);
  useEffect(() => {
    const before = pendingUnderstanding.current;
    if (!before) return;
    const created = quotes.find(quote => !before.has(quote.id));
    if (!created) return;
    pendingUnderstanding.current = null;
    board.openCard(created.id);
    focusUnderstanding();
  }, [quotes, board]);

  const excerpt = useCallback((understand: boolean) => {
    if (!selection || board.readOnly || !nodeId) return;
    const before = new Set(quotes.map(quote => quote.id));
    if (!board.addTextQuote(nodeId, { ...selection, bodySnapshot: data.body })) return;
    window.getSelection()?.removeAllRanges();
    reportSelection(null);
    if (understand) pendingUnderstanding.current = before;
    // Back to the article without lighting its keyboard-focus rule: E is a reading key, not a move into the text (INSP-23).
    else bodyRef.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  }, [selection, board, nodeId, quotes, data.body, reportSelection]);

  const revealQuote = useCallback((id: string) => {
    if (board.revealCard) board.revealCard(id);
    else board.openCard(id);
  }, [board]);

  // PR-m2: back to the quote card that sent the reader here (not on a draft trip, which has “返回文稿”).
  const returnQuoteId = sourceReveal?.quoteNodeId && revealCitation && !board.draftReturn && board.nodes.some(node => node.id === sourceReveal.quoteNodeId) ? sourceReveal.quoteNodeId : null;
  const returnToQuote = useCallback(() => { if (returnQuoteId) board.openCard(returnQuoteId); }, [returnQuoteId, board]);
  const latestReturn = useRef(returnToQuote);
  latestReturn.current = returnToQuote;
  useEffect(() => {
    if (!returnQuoteId) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.key !== 'ArrowLeft' || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      if (isEditableTarget(event.target) || window.document.querySelector('dialog[open]')) return;
      event.preventDefault(); event.stopPropagation();
      latestReturn.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [returnQuoteId]);

  /** Keyboard selection by sentence and the article's own keys (PR-M3, §6.28 `e`). */
  const selectRange = useCallback((range: TextRange) => {
    const body = bodyRef.current;
    if (!body) return;
    const dom = restoreReadingSelection(body, range);
    const scroller = body.closest<HTMLElement>('.inspector-scroll');
    if (dom && scroller) {
      const rect = dom.getBoundingClientRect(), box = scroller.getBoundingClientRect();
      if (rect.top < box.top + 96 || rect.bottom > box.bottom - 72) scroller.scrollTop += rect.top - box.top - scroller.clientHeight / 3;
    }
    reportSelection(range);
  }, [reportSelection]);
  /** A caret placed in the article (a click): sentence selection starts there, not at the top of the text (INSP-07). */
  const caretOffset = (): number | null => {
    const body = bodyRef.current, current = window.getSelection();
    if (!body || !current?.rangeCount || !current.isCollapsed) return null;
    const range = current.getRangeAt(0);
    if (!body.contains(range.startContainer)) return null;
    return offsetOfPoint(body as unknown as TextWalkNode, range.startContainer as unknown as TextWalkNode, range.startOffset);
  };
  const firstVisibleOffset = () => {
    const body = bodyRef.current, scroller = body?.closest<HTMLElement>('.inspector-scroll');
    if (!body || !scroller) return 0;
    const top = scroller.getBoundingClientRect().top + 60;
    const block = [...body.querySelectorAll<HTMLElement>(':scope > [data-from]')].find(element => element.getBoundingClientRect().bottom > top && element.offsetParent !== null);
    return block ? Number(block.dataset.from) : 0;
  };
  /** Start of the sentence that contains `offset` (so Alt+↓ from a caret mid-sentence selects that sentence). */
  const sentenceStartBefore = (offset: number) => {
    const before = adjacentSentence(document, offset, -1, hiddenHeading);
    const after = before ? adjacentSentence(document, before.to, 1, hiddenHeading) : adjacentSentence(document, 0, 1, hiddenHeading);
    return after && after.from <= offset && offset < after.to ? after.from : offset;
  };
  const onCommand = (event: ReactKeyboardEvent<HTMLDivElement>): boolean => {
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey;
    if (plain && (event.key === 'e' || event.key === 'E')) {
      if (!selection || board.readOnly) return false;
      excerpt(false);
      return true;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const caret = selection ? null : caretOffset();
      // From a caret, ↓ takes the sentence the caret is in (its start lies before the caret) and ↑ the one before it.
      const anchor = selection ? (direction === 1 ? selection.to : selection.from)
        : caret !== null ? (direction === 1 ? sentenceStartBefore(caret) : caret) : firstVisibleOffset();
      const next = adjacentSentence(document, anchor, direction, hiddenHeading);
      if (!next) return true;
      selectRange(event.shiftKey && selection ? { from: Math.min(selection.from, next.from), to: Math.max(selection.to, next.to) } : next);
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
      const all = trimToVisible(document, 0, normalizedBody.length);
      if (all) selectRange(all);
      return true;
    }
    if (event.key === 'Escape' && selection) {
      window.getSelection()?.removeAllRanges();
      reportSelection(null);
      event.stopPropagation();
      return true;
    }
    return false;
  };

  /** Editing in the reading split: a contents entry puts the caret at that heading and brings it under the header. */
  const jumpInEditor = useCallback((offset: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(offset, offset);
    const scroller = editor.closest<HTMLElement>('.inspector-scroll');
    if (!scroller) return;
    const top = scroller.scrollTop + editor.getBoundingClientRect().top - scroller.getBoundingClientRect().top + caretTopInTextarea(editor, offset);
    scroller.scrollTo({ top: Math.max(0, top - READING_SCROLL_MARGIN), behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [editorRef]);

  // The left column stays while editing too, so switching 阅读 / 编辑 never shifts the article sideways.
  const showLead = layout === 'reading' && !!normalizedBody && (document.headings.length > 0 || excerpts.length > 0 || characters >= 1200);
  const toolbar = <div className="inspector-reading-toolbar" role="group" aria-label="资料阅读工具">
    {showLead && <ReadingLeadPopover document={headings} excerpts={excerpts} characters={characters} bodyRef={bodyRef} onJump={reading ? undefined : jumpInEditor} />}
    <div className="seg inspector-reading-switch" role="group" aria-label="正文查看方式">
      <button type="button" className="seg__item" aria-pressed={reading} onPointerDown={keepEditorFocus} onClick={() => changeReadingMode(true)}>阅读</button>
      <button type="button" className="seg__item" aria-pressed={!reading} onPointerDown={keepEditorFocus} onClick={() => changeReadingMode(false)}>编辑</button>
    </div>
    {layout !== 'reading' && characters > 0 && <span className="inspector-reading-count"><span className="tabular">{formatCount(characters)}</span> 字</span>}
  </div>;

  const localFile = data.kind === 'note' && data.tags?.includes('文字资料');
  const site = data.kind === 'link' && typeof data.sourceAuthor !== 'string' ? hostName(data.url || data.sourceUrl) : undefined;
  // §6.18.3：标题下两行短句——作者与出处一行，收进时间一行（有记录时）。
  const author = localFile && typeof data.sourceAuthor === 'string' ? data.sourceAuthor.trim() : '';
  const origin = localFile ? (data.tags?.includes('Markdown') ? 'Markdown 文件' : '纯文本文件') : site ? <>来自 <span lang="en">{site}</span></> : null;
  const collected = collectedLine(data.collectedAt);
  const meta = layout === 'reading' && (origin || collected)
    ? <div className="reading-meta">
      {origin && <p className="reading-meta__line">{author && <span className="reading-meta__author">{author}</span>}<span>{origin}</span></p>}
      {collected && <p className="reading-meta__when">{collected}</p>}
    </div>
    : null;

  const notice = sourceReveal ? <SourceLocationNotice
    normalizedBody={normalizedBody}
    sourceLocation={sourceLocation}
    revealCitation={revealCitation}
    chosenSourceMatch={chosenSourceMatch}
    setChosenSourceMatch={setChosenSourceMatch}
    setSourceReveal={setSourceReveal}
    setReading={setReading}
    paragraph={sourceRange ? paragraphIndexAt(normalizedBody, sourceRange.from) : undefined}
    onReturnToQuote={returnQuoteId ? returnToQuote : undefined}
    origin={!sourceReveal.quoteNodeId && sourceReveal.quoteText ? 'search' : undefined}
  /> : null;
  const locatedNotice = !!revealCitation && sourceLocation?.status === 'matched' && !sourceLocation.changed;

  return <section className={`inspector-section inspector-text-source${reading ? ' is-reading' : ' is-editing'}`}>
    {meta}
    {layout === 'reading' ? <InspectorSlot name="header-actions" fallback={toolbar}>{toolbar}</InspectorSlot> : toolbar}
    {sourceReveal && (layout === 'reading' && locatedNotice
      // Located: one short line in the sticky header instead of a pill over the first line of text (INSP-05).
      ? <InspectorSlot name="header-meta" fallback={notice}>{notice}</InspectorSlot>
      : notice)}
    {reading ? normalizedBody ? <TextReading
      document={document}
      range={sourceRange ?? null}
      traces={traces}
      selection={selection}
      readOnly={!!board.readOnly}
      hiddenHeading={hiddenHeading}
      onSelection={reportSelection}
      onExcerpt={excerpt}
      onRevealQuote={revealQuote}
      revealsOnCanvas={!!board.revealCard}
      onCommand={onCommand}
      getMediaUrl={board.getMediaUrl}
      bodyRef={bodyRef}
      quoteLabel={quoteTitle}
      rangeOrigin={sourceReveal && !sourceReveal.quoteNodeId && sourceReveal.quoteText ? 'search' : undefined}
    /> : <div className="inspector-reading-empty">
      <BookOpen size={24} aria-hidden="true" />
      <h3>给这份资料留下文字</h3>
      <p>粘贴文章、整理观察，或记下一个想法。选中的原文可以摘录到画布。</p>
      <button type="button" className="btn btn--line btn--sm" onClick={() => changeReadingMode(false)}><Pencil size={14} aria-hidden="true" />开始编辑</button>
    </div> : <textarea
      ref={editorRef}
      id="card-body"
      className="inspector-text-editor"
      maxLength={100000}
      readOnly={board.readOnly}
      aria-label="资料正文"
      value={data.body}
      onSelect={event => {
        const editor = event.currentTarget;
        const from = editor.selectionStart, to = editor.selectionEnd;
        setTextSelection(editor.value === normalizedBody && from < to && editor.value.slice(from, to).trim() ? { from, to, bodySnapshot: data.body } : null);
      }}
      onChange={event => {
        setTextSelection(null);
        patch({ body: event.target.value });
      }}
      placeholder="粘贴一段资料，或写下值得留下的想法……"
      spellCheck={false}
    />}
    {(data.kind === 'note' || data.kind === 'link') && <TranslationForCard data={data} surface={data.kind === 'link' ? 'link' : 'note'} nodeId={nodeId} readOnly={!!board.readOnly} update={(_id, next) => patch(next)} />}
    {showLead && <InspectorSlot name="lead"><ReadingLead document={headings} excerpts={excerpts} characters={characters} bodyRef={bodyRef} onJump={reading ? undefined : jumpInEditor} /></InspectorSlot>}
  </section>;
}
