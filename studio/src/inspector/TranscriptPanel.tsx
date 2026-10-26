import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, DragEvent, KeyboardEvent, MouseEvent, ReactNode, SetStateAction } from 'react';
import { ArrowDownToLine, Check, ChevronDown, Clapperboard, Copy, Ellipsis, FileText, LoaderCircle, MessageSquareQuote, PenLine, Pencil, Plus, Search, Upload, X } from 'lucide-react';
import type { CardData, TranscriptLine } from '../model';
import { timecode } from '../model';
import { useBoard } from '../board-context';
import type { BoardActions } from '../board-context';
import type { TripWriteMode } from '../draft-navigation';
import { transcriptRevision, transcriptSentence, transcriptToSrt, transcriptToText, type TranscriptScript } from '../transcript-tools';
import { saveExport } from '../file-export';
import { timeRangeLabel } from '../source-location';
import { closeDetailsOnEscape, InspectorSlot, isEditableTarget } from './shared';
import { withShortcut } from '../dialogs/shortcuts';
import { runBreaks, sentenceNodes, transcriptRuns } from './transcript-wrap';
import { Words } from '../cards/Words';
import type { EditingTranscriptLine, ReplaceAction } from './shared';
import { TranslationForCard } from './EnglishTranslation';
import {
  corrections, lineIndexAt, lineMarks, prefersReducedMotion, publishPlayhead, readFollowPreference, selections, transcriptTimeLabels, transcriptViews,
  useCorrection, usePlayhead, videoQuotes, watchableVideoUrl, writeFollowPreference,
} from './video-watch';

/** Optional App action (integration request inspector-video): excerpt, then open the new quote with “我的理解” focused. */
type WatchBoardActions = BoardActions & { addQuoteAndAnnotate?: (nodeId: string, lines: TranscriptLine[]) => boolean };

/** Lists this long render in chunks; chunks far from the viewport keep only their measured height (PV-M1). */
const VIRTUAL_MIN = 240;
const CHUNK = 50;
const ROW_ESTIMATE = 42;

/**
 * Transcript column of the watching workbench (§6.18.2). One Tab stop per sentence (↑ ↓ move, Enter jumps,
 * Space ticks, → reaches the row's correction button); only the current sentence is weighted; tick circles appear
 * on hover, focus or once something is selected; Shift extends over visible sentences (PV-m3); the selection gets
 * one inline action row. Playback re-renders this list once per sentence, never per timeupdate (PV-M1).
 * Seeking goes through board.playVideo only (K9-15). Export scope is whole or selected, never narrowed by search (K9-16).
 */
export default function TranscriptPanel({
  nodeId, data, transcript, query, setQuery, selectedLines, setSelectedLines, lastSelected, setLastSelected,
  currentTime, setCurrentTime, videoUrl, mediaError, transcriptBusy, transcriptProcessing, canRetryImport,
  exporting, setExporting, onNativeTranscribe, runNativeTranscribe, onImportSubtitles, setReplaceAction, setEditingLine, onNotify,
}: {
  nodeId: string;
  data: CardData;
  transcript: TranscriptLine[];
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  selectedLines: Set<string>;
  setSelectedLines: Dispatch<SetStateAction<Set<string>>>;
  lastSelected: number | null;
  setLastSelected: Dispatch<SetStateAction<number | null>>;
  currentTime: number;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  videoUrl?: string;
  mediaError: boolean;
  transcriptBusy: boolean;
  transcriptProcessing: boolean;
  canRetryImport: boolean;
  exporting: boolean;
  setExporting: Dispatch<SetStateAction<boolean>>;
  onNativeTranscribe?: (nodeId: string) => void | Promise<void>;
  runNativeTranscribe: () => Promise<void>;
  onImportSubtitles: (nodeId: string) => void;
  setReplaceAction: Dispatch<SetStateAction<ReplaceAction | null>>;
  setEditingLine: Dispatch<SetStateAction<EditingTranscriptLine | null>>;
  onNotify: (message: string) => void;
}) {
  const board = useBoard() as WatchBoardActions;
  const videoImport = data.videoImport;
  const describeId = useId();
  const canSeek = !!watchableVideoUrl(videoUrl, data) && !mediaError;
  const needle = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => needle ? transcript.filter(line => `${line.text}\n${line.translation ?? ''}`.toLocaleLowerCase().includes(needle)) : transcript, [transcript, needle]);
  const indexById = useMemo(() => new Map(transcript.map((line, index) => [line.id, index])), [transcript]);
  const positionById = useMemo(() => new Map(filtered.map((line, index) => [line.id, index])), [filtered]);
  const labels = transcriptTimeLabels(transcript);
  const quotes = useMemo(() => videoQuotes(board.nodes, nodeId), [board.nodes, nodeId]);
  const marks = useMemo(() => lineMarks(transcript, quotes), [transcript, quotes]);
  const selectedTranscript = useMemo(() => transcript.filter(line => selectedLines.has(line.id)), [transcript, selectedLines]);
  const correction = useCorrection('active');
  // A sentence is “current” once this card owns the player (before the first play there is no playhead to follow).
  const live = canSeek && board.activeVideo === nodeId;
  const currentIndex = usePlayhead(nodeId, time => (live ? lineIndexAt(transcript, time) : -1), currentTime);
  const currentId = currentIndex >= 0 ? transcript[currentIndex]?.id : undefined;
  const correctedCount = useMemo(() => transcript.reduce((count, line) => count + (line.originalText !== undefined ? 1 : 0), 0), [transcript]);
  const hasTranslation = useMemo(() => transcript.some(line => !!line.translation?.trim()), [transcript]);
  const [scriptChoices, setScriptChoices] = useState<ReadonlyMap<string, TranscriptScript>>(() => new Map());
  // Once a Chinese line exists, the column opens on it. A choice stays with this card for the session only.
  const script: TranscriptScript = hasTranslation ? (scriptChoices.get(nodeId) ?? 'translation') : 'source';
  const chooseScript = (next: TranscriptScript) => {
    setScriptChoices(previous => {
      if (previous.get(nodeId) === next) return previous;
      const map = new Map(previous);
      map.set(nodeId, next);
      return map;
    });
  };

  // Shared with the timeline and the footer (they live outside this component).
  useLayoutEffect(() => { selections.set(nodeId, selectedLines); }, [nodeId, selectedLines]);
  useLayoutEffect(() => { transcriptViews.set(nodeId, { query: needle, visibleIds: needle ? filtered.map(line => line.id) : null }); }, [nodeId, needle, filtered]);
  useEffect(() => () => { selections.delete(nodeId); transcriptViews.delete(nodeId); }, [nodeId]);

  // ---------- Output: copy and export (K4 names, K9-16 scope) ----------
  const copyTranscript = async (scope: 'all' | 'selected') => {
    const lines = scope === 'selected' ? selectedTranscript : transcript;
    if (!lines.length) return;
    try {
      await navigator.clipboard.writeText(transcriptToText(lines));
      onNotify(scope === 'all' ? `已复制全文，共 ${lines.length} 句` : `已复制所选 ${lines.length} 句`);
    } catch { onNotify('暂时无法写入剪贴板，请使用 TXT 导出保存文字'); }
  };
  const exportTranscript = async (format: 'txt' | 'srt', scope: 'all' | 'selected') => {
    if (exporting) return;
    const lines = scope === 'selected' ? selectedTranscript : transcript;
    if (!lines.length) return;
    let content: string;
    try { content = format === 'srt' ? transcriptToSrt(lines) : transcriptToText(lines); }
    catch (error) { onNotify(`导出未完成：${error instanceof Error ? error.message : String(error)}`); return; }
    const safeTitle = (data.title || '逐字稿').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 90);
    const scopeLabel = scope === 'selected' ? `所选${lines.length}句` : '全文';
    setExporting(true);
    try {
      const result = await saveExport({ format, suggestedName: `${safeTitle}-${scopeLabel}.${format}`, data: new TextEncoder().encode(content) });
      onNotify(result.status === 'saved'
        ? `已保存${scope === 'selected' ? `所选 ${lines.length} 句` : `全文 ${lines.length} 句`} ${format.toUpperCase()}`
        : result.status === 'cancelled' ? '导出已取消' : `已开始下载 ${format.toUpperCase()} 逐字稿`);
    } catch (error) { onNotify(`导出未完成：${error instanceof Error ? error.message : String(error)}`); }
    finally { setExporting(false); }
  };
  const requestReplacement = (action: ReplaceAction) => {
    if (transcriptBusy || correction) return;
    if (transcript.length) { setReplaceAction(action); return; }
    if (action === 'subtitles') onImportSubtitles(nodeId);
    else void runNativeTranscribe();
  };
  /**
   * On a trip that picks a shot for a script line (§6.29), the selection becomes that line's picture (“配给这一行”, the
   * main action) or is written in as a new line after it (“另起一行写进原话”); the way back opens the script. Not offered
   * in a read-only window or on an ordinary trip.
   */
  const tripLine = board.draftReturn?.insert && board.draftReturn.draftId !== nodeId && !board.readOnly && board.writeLinesToDraft ? board.draftReturn.insert : null;
  const writeSelection = (mode: TripWriteMode) => {
    const lines = transcript.filter(line => selectedLines.has(line.id));
    if (!lines.length || !tripLine) return;
    if (board.writeLinesToDraft!(nodeId, lines, mode)) { setSelectedLines(new Set()); setLastSelected(null); }
  };
  const makeQuote = (annotate = false) => {
    const lines = transcript.filter(line => selectedLines.has(line.id));
    if (!lines.length || board.readOnly) return;
    // The action row disappears with the selection: hand keyboard focus to the last excerpted sentence first, so it
    // never falls to the page (and removing a focused element does not force an extra style pass mid-commit).
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.watch-selection')) {
      scrollerRef.current?.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(lines.at(-1)!.id)}"] .watch-line__text`)?.focus({ preventScroll: true });
    }
    const done = annotate && board.addQuoteAndAnnotate ? board.addQuoteAndAnnotate(nodeId, lines, script) : board.addQuote(nodeId, lines, undefined, script);
    if (!done) return;
    setSelectedLines(new Set()); setLastSelected(null);
  };

  // ---------- Follow playback: keep the current sentence centred until the reader scrolls away ----------
  const scrollerRef = useRef<HTMLDivElement>(null);
  /**
   * How many em a sentence line holds, in half-em steps: rows choose their break points from it (transcript-wrap.ts).
   * Measured before paint and again when the column changes width, never during playback or scrolling.
   */
  const [capacity, setCapacity] = useState(0);
  const hasRows = transcript.length > 0;
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () => {
      const text = scroller.querySelector<HTMLElement>('.inspector-transcript-line:not(.is-used-start) .watch-line__text') ?? scroller.querySelector<HTMLElement>('.watch-line__text');
      if (!text || !text.clientWidth) return;
      const size = parseFloat(getComputedStyle(text).fontSize) || 16;
      const next = Math.floor((text.clientWidth / size) * 2) / 2;
      setCapacity(previous => previous === next ? previous : next);
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    document.fonts?.addEventListener('loadingdone', measure);
    return () => { observer.disconnect(); document.fonts?.removeEventListener('loadingdone', measure); };
  }, [hasRows]);
  const [follow, setFollow] = useState(readFollowPreference);
  const [detached, setDetached] = useState(false);
  const hovering = useRef(false);
  const followRef = useRef(follow);
  followRef.current = follow;
  /** The sentence this list just sought to itself: its own echo through the Inspector's time must not re-centre it. */
  const localSeek = useRef<{ lineId: string; at: number } | null>(null);
  /** Transcript index of the sentence last clicked to listen: Shift extends from it while nothing is ticked (FV-M3). */
  const seekAnchor = useRef<number | null>(null);
  const rowElement = (lineId: string) => scrollerRef.current?.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(lineId)}"]`) ?? null;
  const centre = useCallback((lineId: string | undefined, behavior: ScrollBehavior, onlyIfOutside = false) => {
    const scroller = scrollerRef.current;
    const row = lineId ? rowElement(lineId) : null;
    if (!scroller || !row) return;
    const box = scroller.getBoundingClientRect(), rect = row.getBoundingClientRect();
    if (onlyIfOutside && rect.top >= box.top && rect.bottom <= box.bottom) return;
    const top = scroller.scrollTop + rect.top - box.top - (scroller.clientHeight - rect.height) / 2;
    scroller.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? 'auto' : behavior });
  }, []);
  // The Inspector's time changes on open, on a jump from a quote or a draft, and on seeks: centre at once (PV-B1).
  const jumpLineId = canSeek ? transcript[lineIndexAt(transcript, currentTime)]?.id : undefined;
  /**
   * Arriving from a quote or a draft (§8.3 #7, INSP-12): the film opens playing at the excerpt's second. That one
   * arrival is announced (“已回到原片 01:12”) and the keyboard lands on that sentence instead of the close button.
   */
  const opened = useRef({ nodeId, at: performance.now(), arrived: false });
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setAnnouncement(''), 5000);
    return () => window.clearTimeout(timer);
  }, [announcement]);
  useLayoutEffect(() => {
    const own = localSeek.current;
    if (own && own.lineId === jumpLineId && performance.now() - own.at < 1500) return;
    localSeek.current = null;
    // A jump from elsewhere (timeline, step buttons, a quote) moves the reader: Shift then extends from the playing sentence.
    seekAnchor.current = null;
    if (!jumpLineId) return;
    setDetached(false);
    if (opened.current.nodeId !== nodeId) opened.current = { nodeId, at: performance.now(), arrived: false };
    const arriving = !opened.current.arrived && currentTime > 0.5 && latest.current.board.activeVideo === nodeId && performance.now() - opened.current.at < 2500;
    if (arriving) { opened.current.arrived = true; setAnnouncement(`已回到原片 ${timecode(currentTime)}`); setRovingId(jumpLineId); }
    const frame = requestAnimationFrame(() => {
      centre(jumpLineId, 'auto');
      if (!arriving) return;
      const active = document.activeElement;
      if (!active || active === document.body || active.closest('.inspector-header')) rowElement(jumpLineId)?.querySelector<HTMLElement>('.watch-line__text')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentTime, nodeId]);
  // Smooth for speech-paced changes; when sentences change faster than a smooth scroll can finish, follow instantly
  // instead of restarting the animation each time (it would never catch up).
  const lastFollow = useRef(0);
  // While a sentence is being corrected the list holds still: the dialog opens under that row (INSP-01), and a
  // follow scroll would carry the row, and the modal with it, out of the window. Read at event time, not render time.
  const correcting = () => !!corrections.get('active');
  useEffect(() => {
    if (!follow || detached || !currentId || correcting()) return;
    const now = performance.now();
    centre(currentId, now - lastFollow.current < 450 ? 'auto' : 'smooth', hovering.current);
    lastFollow.current = now;
  }, [currentId]);
  const detach = useCallback(() => { if (followRef.current) setDetached(true); }, []);
  const returnToCurrent = () => { setDetached(false); centre(currentId, 'smooth'); };
  const toggleFollow = () => {
    const next = !follow;
    setFollow(next); writeFollowPreference(next); setDetached(false);
    if (next) centre(currentId, 'smooth');
  };

  // ---------- Selection, seeking and the reader's place (also pins its virtual chunk) ----------
  const [rovingId, setRovingId] = useState<string | null>(null);
  const pendingFocus = useRef<{ id: string; part: 'text' | 'edit' } | null>(null);
  const latest = useRef({ filtered, indexById, positionById, lastSelected, canSeek, transcriptBusy, transcript, selectedLines, board, data, currentIndex });
  latest.current = { filtered, indexById, positionById, lastSelected, canSeek, transcriptBusy, transcript, selectedLines, board, data, currentIndex };
  useEffect(() => { seekAnchor.current = null; }, [transcript]);
  const actions = useMemo<RowActions>(() => {
    const lineOf = (id: string) => latest.current.transcript.find(line => line.id === id);
    const toggle = (id: string, extend: boolean) => {
      const { filtered: visible, indexById: indexes, lastSelected: ticked, selectedLines: picked, currentIndex: playing, transcript: lines } = latest.current;
      const index = indexes.get(id);
      if (index === undefined) return;
      // Shift extends from the last ticked sentence; with nothing ticked yet, from the sentence last clicked to listen,
      // else the one playing — the usual list range selection (FV-M3: click a sentence, listen, Shift-click the end).
      const candidate = !extend ? null
        : picked.size && ticked !== null ? ticked
          : seekAnchor.current ?? ticked ?? (playing >= 0 ? playing : null);
      const anchor = candidate !== null && candidate < lines.length ? candidate : null;
      setSelectedLines(previous => {
        const next = new Set(previous);
        if (extend && anchor !== null) {
          // Shift only reaches sentences the search leaves visible (PV-m3).
          const from = Math.min(index, anchor), to = Math.max(index, anchor);
          for (const line of visible) { const at = indexes.get(line.id)!; if (at >= from && at <= to) next.add(line.id); }
        } else if (next.has(id) && !extend) next.delete(id);
        else next.add(id);
        return next;
      });
      setLastSelected(index);
    };
    const seek = (id: string) => {
      const line = lineOf(id);
      if (!line || !latest.current.canSeek) return;
      seekAnchor.current = latest.current.indexById.get(id) ?? null;
      localSeek.current = { lineId: line.id, at: performance.now() };
      publishPlayhead(nodeId, line.start);
      latest.current.board.playVideo(nodeId, line.start);
      setCurrentTime(line.start);
    };
    const moveTo = (position: number) => {
      const visible = latest.current.filtered;
      if (!visible.length) return;
      const target = visible[Math.min(visible.length - 1, Math.max(0, position))];
      pendingFocus.current = { id: target.id, part: 'text' };
      setRovingId(target.id);
      detach();
    };
    return {
      toggle,
      seek,
      press(event) {
        // Shift-click picks a run of sentences; it must never also stretch the browser's text selection over the rows
        // in between, which would paint sentences that are not picked (FV-M3). With no selection left to extend, the
        // press only places the caret, and focus still moves the ordinary way.
        if (event.shiftKey && event.button === 0) window.getSelection()?.removeAllRanges();
      },
      activate(id, event) {
        if (event.shiftKey) { toggle(id, true); return; }
        if (event.ctrlKey || event.metaKey) { toggle(id, false); return; }
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return;
        if (latest.current.canSeek) seek(id); else toggle(id, false);
      },
      key(id, event) {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        const position = latest.current.positionById.get(id) ?? 0;
        const last = latest.current.filtered.length - 1;
        switch (event.key) {
          case 'ArrowDown': event.preventDefault(); moveTo(position + 1); break;
          case 'ArrowUp': event.preventDefault(); moveTo(position - 1); break;
          case 'PageDown': event.preventDefault(); moveTo(position + 10); break;
          case 'PageUp': event.preventDefault(); moveTo(position - 10); break;
          case 'Home': event.preventDefault(); moveTo(0); break;
          case 'End': event.preventDefault(); moveTo(last); break;
          case ' ': event.preventDefault(); toggle(id, event.shiftKey); break;
          case 'ArrowRight': {
            const edit = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('.inspector-line-edit');
            if (edit && !edit.disabled) { event.preventDefault(); edit.focus(); }
            break;
          }
        }
      },
      editKey(id, event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        if (event.key === 'ArrowLeft') { event.currentTarget.closest('.inspector-transcript-line')?.querySelector<HTMLElement>('.watch-line__text')?.focus(); return; }
        const position = latest.current.positionById.get(id) ?? 0;
        const target = latest.current.filtered[position + (event.key === 'ArrowDown' ? 1 : -1)];
        if (!target) return;
        pendingFocus.current = { id: target.id, part: 'edit' };
        setRovingId(target.id);
      },
      focus(id) { setRovingId(id); },
      edit(id) {
        const line = lineOf(id);
        if (!line || latest.current.transcriptBusy) return;
        setRovingId(id);
        setEditingLine({ nodeId, line: { ...line }, revision: transcriptRevision(latest.current.data) });
      },
    };
    // Everything that changes is read through `latest` at event time, so rows never re-render for new callbacks.
  }, [nodeId, setSelectedLines, setLastSelected, setCurrentTime, setEditingLine, detach]);
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const row = rowElement(pending.id);
    if (!row) return;
    pendingFocus.current = null;
    row.querySelector<HTMLElement>(pending.part === 'edit' ? '.inspector-line-edit:not(:disabled)' : '.watch-line__text')?.focus();
  });
  // Keep the reader's chunk mounted; every rendered sentence owns its complete-row Tab stop.
  const tabId = (rovingId && positionById.has(rovingId) ? rovingId : undefined) ?? (currentId && positionById.has(currentId) ? currentId : filtered[0]?.id);

  // E excerpts the selection anywhere in the workbench outside text fields (§6.28).
  const sectionRef = useRef<HTMLElement>(null);
  const excerptRef = useRef(makeQuote);
  excerptRef.current = makeQuote;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'e' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat) return;
      const target = event.target instanceof Element ? event.target : null;
      const workbench = sectionRef.current?.closest('.inspector--video');
      if (!workbench || !target || !workbench.contains(target) || isEditableTarget(target) || document.querySelector('dialog[open]')) return;
      if (!latest.current.selectedLines.size) return;
      event.preventDefault();
      event.stopPropagation();
      excerptRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // ---------- Long transcripts: chunked rendering ----------
  const chunking = useChunkWindow(filtered.length, scrollerRef);
  const selectionAnchor = (() => {
    if (!selectedLines.size) return -1;
    for (let position = filtered.length - 1; position >= 0; position--) if (selectedLines.has(filtered[position].id)) return position;
    return -1;
  })();
  const forcedChunks = new Set<number>();
  for (const id of [currentId, tabId, jumpLineId, correction?.lineId, pendingFocus.current?.id]) {
    const position = id ? positionById.get(id) : undefined;
    if (position !== undefined) forcedChunks.add(Math.floor(position / CHUNK));
  }
  const anchorChunk = selectionAnchor >= 0 ? Math.floor(selectionAnchor / CHUNK) : -1;
  if (anchorChunk >= 0) forcedChunks.add(anchorChunk);
  // When the sentence just ticked sits at the bottom edge, nudge the list so its action row fits below it instead of
  // sticking over the selected sentences. A selection that runs far below (select all) keeps the sticky row.
  const anchorId = selectionAnchor >= 0 ? filtered[selectionAnchor].id : undefined;
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const row = anchorId ? rowElement(anchorId) : null;
    const bar = scroller?.querySelector<HTMLElement>('.watch-selection');
    if (!scroller || !row || !bar) return;
    const box = scroller.getBoundingClientRect(), rowBox = row.getBoundingClientRect();
    const need = rowBox.bottom + bar.offsetHeight + 16 - box.bottom;
    if (need > 0 && rowBox.top >= box.top && rowBox.top < box.bottom) scroller.scrollBy({ top: need, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [anchorId]);

  const editTitle = (line: TranscriptLine) => board.readOnly ? '此窗口只读，请在编辑窗口校对'
    : transcriptProcessing ? '任务完成后可校对'
      : line.originalText !== undefined ? '已校对，可查看原文' : '校对这一句';
  const selectionContiguous = (() => {
    if (selectedTranscript.length < 2) return 1;
    let runs = 1;
    for (let index = 1; index < selectedTranscript.length; index++) {
      if (indexById.get(selectedTranscript[index].id)! !== indexById.get(selectedTranscript[index - 1].id)! + 1) runs++;
    }
    return runs;
  })();
  const selectionBar = selectedTranscript.length ? <SelectionBar
    count={selectedTranscript.length}
    range={selectionContiguous === 1 ? timeRangeLabel(selectedTranscript[0].start, selectedTranscript.at(-1)!.end) ?? '' : `分 ${selectionContiguous} 段`}
    readOnly={!!board.readOnly}
    onCopy={() => void copyTranscript('selected')}
    onExcerpt={() => makeQuote()}
    // Opening the new quote would end the trip: on a “补一个镜头” trip the bar gives the selection to the line instead.
    onAnnotate={board.addQuoteAndAnnotate && !board.readOnly && !tripLine ? () => makeQuote(true) : undefined}
    onWrite={tripLine ? writeSelection : undefined}
    writeLine={tripLine?.line}
    onDragStart={event => {
      if (!selectedLines.size || board.readOnly) { event.preventDefault(); return; }
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-field-quote', JSON.stringify({ nodeId, lineIds: [...selectedLines], script }));
    }}
  /> : null;

  const renderRow = (line: TranscriptLine, position: number) => {
    const index = indexById.get(line.id)!;
    const mark = marks[index];
    return <TranscriptRow
      key={line.id}
      line={line}
      label={labels[index]}
      current={line.id === currentId}
      selected={selectedLines.has(line.id)}
      used={!!mark?.used}
      usedStart={!!mark?.usedStart}
      editing={correction?.lineId === line.id}
      canSeek={canSeek}
      editDisabled={transcriptBusy}
      editTitle={editTitle(line)}
      query={needle}
      script={script}
      capacity={capacity}
      actions={actions}
      after={position === selectionAnchor ? selectionBar : null}
    />;
  };

  const outputControls = transcript.length ? <div className="watch-output" role="group" aria-label="逐字稿复制与导出">
    <button type="button" className="btn btn--sm watch-output__copy" onClick={() => void copyTranscript('all')}><Copy size={14} aria-hidden="true" />复制全文</button>
    <details className="inspector-transcript-export" onKeyDown={closeDetailsOnEscape}>
      <summary className="btn btn--sm btn--line"><ArrowDownToLine size={14} aria-hidden="true" />导出逐字稿<ChevronDown size={13} aria-hidden="true" /></summary>
      <div className="inspector-transcript-export-menu">
        <p>{selectedTranscript.length ? `已选择 ${selectedTranscript.length} 句，请选择导出范围` : `全文包含全部 ${transcript.length} 句`}</p>
        {/* Nothing ticked: one line says how to get a selection instead of three “0 句” rows (the controls stay, hidden). */}
        {!selectedTranscript.length && <p className="watch-menu__hint">勾选句子后，可以只复制或导出所选的句子。</p>}
        <div className="watch-menu__group" hidden={!selectedTranscript.length}>
          <button type="button" aria-label="复制所选" disabled={!selectedTranscript.length} onClick={() => void copyTranscript('selected')}>
            复制所选<span className="tabular">{selectedTranscript.length} 句</span>
          </button>
          <button type="button" aria-label="导出所选 TXT" disabled={!selectedTranscript.length || exporting} onClick={() => void exportTranscript('txt', 'selected')}>
            导出所选 TXT<span className="tabular">{selectedTranscript.length} 句</span>
          </button>
          <button type="button" aria-label="导出所选 SRT" disabled={!selectedTranscript.length || exporting} onClick={() => void exportTranscript('srt', 'selected')}>
            导出所选 SRT<span className="tabular">{selectedTranscript.length} 句</span>
          </button>
        </div>
        <hr />
        <div className="watch-menu__group">
          <button type="button" aria-label="导出全文 TXT" disabled={exporting} onClick={() => void exportTranscript('txt', 'all')}>导出全文 TXT<span className="tabular">{transcript.length} 句</span></button>
          <button type="button" aria-label="导出全文 SRT" disabled={exporting} onClick={() => void exportTranscript('srt', 'all')}>导出全文 SRT<span className="tabular">{transcript.length} 句</span></button>
        </div>
        <small>搜索不会缩小全文范围。TXT 是纯文字；SRT 是带时间的字幕文件，可以直接拖进剪映或 Premiere。</small>
      </div>
    </details>
  </div> : null;

  const toolsBlocked = transcriptBusy || !!correction;
  // FD-07: a film known to have no audio track is not offered a transcription that can only fail.
  const silent = data.nativeHasAudio === false;
  const nativeReady = !!onNativeTranscribe && !!(data.nativeAssetId || data.mediaId) && !silent;
  // PV-M3: without local transcription, importing subtitles is the empty state's main action.
  const offerTranscribe = !videoImport && !!(data.mediaId || data.nativeAssetId) && !silent;
  const offerSubtitles = !transcriptProcessing && !board.readOnly;
  // One place says each state (QA polish 1): a local transcription in this window is reported here, in the column
  // its sentences will fill; a download task (with its percentage and “取消处理”) is reported under the player, and
  // this column only says where the transcript will appear.
  const localRun = transcriptProcessing && !videoImport;
  const importRun = transcriptProcessing && !!videoImport;
  const runMessage = board.transcriptionMessage?.(nodeId) || '正在准备本机转写…';

  return <section ref={sectionRef} className="inspector-section inspector-transcript-section" aria-label="逐字稿">
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    {outputControls && <InspectorSlot name="header-actions" fallback={outputControls}>{outputControls}</InspectorSlot>}
    <header className="watch-tr-head">
      <h3>逐字稿</h3>
      <span className="watch-tr-head__count tabular">{transcript.length ? `${transcript.length} 句` : ''}</span>
      {hasTranslation && <TranscriptScriptSwitch script={script} onChange={chooseScript} />}
      {transcript.length > 0 && <label className="inspector-search watch-search">
        <Search size={14} aria-hidden="true" />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape' && query && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }}
          placeholder="查找"
          aria-label="在字幕中查找"
        />
        {query && <span className="watch-search__count tabular" aria-live="polite">{filtered.length} 句</span>}
        {query && <button type="button" className="icon-btn icon-btn--xs" onClick={() => setQuery('')} aria-label="清除字幕搜索"><X size={13} aria-hidden="true" /></button>}
      </label>}
      {transcript.length > 0 && <span className="watch-follow">
        {/* The words toggle the switch too (a bigger target than the 28×16 track, INSP-34). */}
        <span id={`${describeId}-follow`} className="watch-follow__label" onClick={toggleFollow}>跟随播放</span>
        <button type="button" className="switch" role="switch" aria-checked={follow} aria-labelledby={`${describeId}-follow`} title={follow ? '播放时当前句保持在中间' : '不自动滚动'} onClick={toggleFollow} />
      </span>}
    </header>
    <TranslationForCard
      data={data}
      surface="transcript"
      nodeId={nodeId}
      readOnly={!!board.readOnly}
      suspended={transcriptProcessing || !!correction}
      update={(id, next) => board.updateCard(id, next)}
    />
    <details className="inspector-transcript-tools" onKeyDown={closeDetailsOnEscape}>
      <summary className="icon-btn" title="字幕与转写工具"><Ellipsis size={16} aria-hidden="true" /><span className="sr-only">字幕与转写工具</span></summary>
      <div className="watch-tools">
        <p>
          {board.readOnly ? '此窗口只读，请在编辑窗口补充或替换逐字稿。'
            : transcriptProcessing ? '当前任务完成前暂停手动操作，避免覆盖正在生成的逐字稿。'
              : correction ? '先保存或取消正在校对的句子，再替换逐字稿。'
                : onNativeTranscribe ? '需要补充或替换逐字稿时，可导入 SRT、VTT 字幕，或在本机重新转写。' : '需要补充或替换逐字稿时，可导入 SRT、VTT 字幕。'}
        </p>
        <div className="watch-tools__actions">
          <button type="button" className="btn btn--sm btn--line" disabled={toolsBlocked} onClick={() => requestReplacement('subtitles')}>
            <Upload size={14} aria-hidden="true" />{transcript.length ? '更新字幕' : '导入字幕'}
          </button>
          {onNativeTranscribe && (data.nativeAssetId || data.mediaId) && <button type="button" className="btn btn--sm btn--line" disabled={toolsBlocked} onClick={() => requestReplacement('transcribe')}>
            <FileText size={14} aria-hidden="true" />{transcript.length ? '重新转写' : '本机转写'}
          </button>}
        </div>
        {!transcript.length && !data.nativeAssetId && !data.mediaId && !videoImport && <p className="watch-tools__hint">先粘贴视频链接或导入本机视频，再点“生成逐字稿”。</p>}
      </div>
    </details>
    {localRun && transcript.length > 0 && <div className="watch-tr-progress" role="group" aria-label="本机转写状态" aria-busy="true">
      <LoaderCircle size={14} className="inspector-is-processing" aria-hidden="true" />
      <strong>正在重新生成逐字稿</strong>
      <span role="status" className="tabular">{runMessage}</span>
    </div>}
    {transcript.length ? <div className="watch-tr-body">
      <div
        ref={scrollerRef}
        className={`inspector-transcript watch-transcript nowheel${selectedLines.size ? ' is-selecting' : ''}`}
        role="group"
        aria-label="视频字幕"
        aria-describedby={`${describeId}-help`}
        onWheel={detach}
        onTouchMove={detach}
        onPointerDown={event => { if (event.target === event.currentTarget) detach(); }}
        onPointerEnter={() => { hovering.current = true; }}
        onPointerLeave={() => { hovering.current = false; if (follow && !detached && !correcting()) centre(currentId, 'smooth', true); }}
      >
        <span id={`${describeId}-help`} className="sr-only">上下方向键换句，回车跳到这一句，空格勾选，Shift 加空格连选，E 摘录到画布。</span>
        {chunking.enabled
          ? chunking.chunks(filtered.length).map(chunk => {
            const show = chunking.isNear(chunk) || forcedChunks.has(chunk);
            const from = chunk * CHUNK, to = Math.min(filtered.length, from + CHUNK);
            // The chunk that holds the selection's action row opens up (display: contents), so the row can stay in
            // view at the bottom of the list while the selection runs on below it (sticky needs the list as its box).
            const open = chunk === anchorChunk;
            return <div key={chunk} ref={chunking.refFor(chunk)} className={`watch-chunk${open ? ' is-open' : ''}`} data-chunk={chunk} style={show ? undefined : { height: chunking.heightOf(chunk, to - from) }}>
              {show && filtered.slice(from, to).map((line, offset) => renderRow(line, from + offset))}
            </div>;
          })
          : filtered.map(renderRow)}
        {selectionBar && selectionAnchor < 0 && <div className="watch-selection-host">{selectionBar}</div>}
        {!filtered.length && <p className="watch-transcript__empty">没有找到“{query}”。试试其他关键词。</p>}
        {/* The list ends with half a screen of room so the last sentences can sit in the middle; this says where the text ends. */}
        {!needle && <p className="watch-transcript__end" aria-hidden="true">以上是全部 <span className="tabular">{transcript.length}</span> 句</p>}
      </div>
      {follow && detached && currentId && <button type="button" className="watch-return" onClick={returnToCurrent}>回到当前句</button>}
    </div> : <div className={`watch-tr-empty${localRun ? ' is-processing' : ''}`} {...(localRun ? { role: 'group', 'aria-label': '本机转写状态', 'aria-busy': true } : {})}>
      {localRun ? <LoaderCircle size={22} className="inspector-is-processing" aria-hidden="true" /> : <MessageSquareQuote size={22} aria-hidden="true" />}
      <h4>
        {localRun ? '正在生成逐字稿'
          : importRun ? '逐字稿会出现在这里'
            : canRetryImport ? '逐字稿还未准备好'
              : videoImport?.status === 'completed' ? '这段视频暂无可读的逐字稿' : '从值得留下的一句话开始'}
      </h4>
      {/* Breaks between words (§3.4): never “每一 / 句”. */}
      <Words as="p" text={localRun ? '可以先看视频、记观看笔记。生成以后，每一句都能回到原片的那一秒。'
          : importRun ? (videoUrl ? '处理进度在视频下方。可以先看视频、记观看笔记。' : '视频下载完以后会接着生成逐字稿，进度在视频下方，不必停在这里等。')
          : board.readOnly ? '此窗口可以播放与阅读。需要添加逐字稿时，请回到编辑窗口。'
            : canRetryImport ? '处理状态中保留了原因。重试后，已有视频与笔记会继续留在画布。'
              : silent ? '这条视频没有音轨，不能转写。导入它的 SRT 或 VTT 字幕后，每一句都能回到原片的那一秒。'
              : nativeReady ? '在本机生成逐字稿，或导入已有的 SRT、VTT 字幕。每一句都能回到原片的那一秒。'
                : '导入这段视频的 SRT 或 VTT 字幕，每一句都能回到原片的那一秒。桌面版还能在本机自动生成逐字稿。'} />
      {(offerTranscribe || offerSubtitles) && <div className={`watch-tr-empty__actions${nativeReady ? ' is-native' : ''}`}>
        {/* K6: `.field-card__transcribe` holds the button and its reason; it stays (disabled) while a task runs or the window is read-only. */}
        {offerTranscribe && <div className="field-card__transcribe">
          <button type="button" className={`btn ${nativeReady ? 'btn--soft' : 'btn--line'}`} disabled={!onNativeTranscribe || transcriptBusy} onClick={() => void runNativeTranscribe()}>
            <FileText size={15} aria-hidden="true" />生成逐字稿
          </button>
          <p role="status" className={localRun ? 'tabular' : undefined}>
            {localRun ? runMessage : board.readOnly ? '此窗口只读，请在编辑窗口生成逐字稿。' : onNativeTranscribe ? '在本机转写，可以继续观看视频或整理画布。' : '生成逐字稿需要桌面版'}
          </p>
        </div>}
        {offerSubtitles && <button type="button" className={`btn watch-tr-empty__subtitles ${nativeReady ? 'btn--line' : 'btn--soft'}`} disabled={toolsBlocked} onClick={() => requestReplacement('subtitles')}>
          <Upload size={15} aria-hidden="true" />导入字幕
        </button>}
      </div>}
    </div>}
  </section>;
}

interface RowActions {
  toggle(id: string, extend: boolean): void;
  seek(id: string): void;
  press(event: MouseEvent<HTMLDivElement>): void;
  activate(id: string, event: MouseEvent<HTMLButtonElement>): void;
  key(id: string, event: KeyboardEvent<HTMLButtonElement>): void;
  editKey(id: string, event: KeyboardEvent<HTMLButtonElement>): void;
  focus(id: string): void;
  edit(id: string): void;
}

const SCRIPT_OPTIONS: { value: TranscriptScript; label: string }[] = [
  { value: 'source', label: '原文' },
  { value: 'translation', label: '中文稿' },
];

/** “原文 / 中文稿”: one Tab stop on the current wording; ← → switch it. Shown only after a translation exists. */
function TranscriptScriptSwitch({ script, onChange }: { script: TranscriptScript; onChange: (script: TranscriptScript) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = SCRIPT_OPTIONS.findIndex(option => option.value === script);
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? Math.min(SCRIPT_OPTIONS.length - 1, index + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? SCRIPT_OPTIONS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (next !== index) onChange(SCRIPT_OPTIONS[next].value);
    const group = event.currentTarget;
    requestAnimationFrame(() => group.querySelectorAll<HTMLButtonElement>('button')[next]?.focus());
  };
  return <div className="seg watch-script" role="group" aria-label="逐字稿稿面" onKeyDown={onKeyDown}>
    {SCRIPT_OPTIONS.map(option => <button
      key={option.value}
      type="button"
      className="seg__item"
      aria-pressed={script === option.value}
      tabIndex={script === option.value ? 0 : -1}
      onClick={() => { if (option.value !== script) onChange(option.value); }}
    >{option.label}</button>)}
  </div>;
}

/** One sentence. Re-renders only when its own state changes (memo; callbacks come from one stable object). */
const TranscriptRow = memo(function TranscriptRow({
  line, label, current, selected, used, usedStart, editing, canSeek, editDisabled, editTitle, query, script, capacity, actions, after,
}: {
  line: TranscriptLine;
  label: string;
  current: boolean;
  selected: boolean;
  used: boolean;
  usedStart: boolean;
  editing: boolean;
  canSeek: boolean;
  editDisabled: boolean;
  editTitle: string;
  query: string;
  script: TranscriptScript;
  /** Line length of the text column in em (0 before it is measured); the “已摘录” flag takes about 3 em of it. */
  capacity: number;
  actions: RowActions;
  after: ReactNode;
}) {
  const time = timecode(line.start);
  const sentence = transcriptSentence(line, script);
  const gloss = script === 'source' && !!line.translation?.trim();
  const breaks = useMemo(() => runBreaks(transcriptRuns(sentence, capacity > 0 && usedStart ? capacity - 3.5 : capacity)), [sentence, capacity, usedStart]);
  const corrected = line.originalText !== undefined;
  const state = [current && '正在播放', selected && '已选', used && '已摘录', corrected && '已校对'].filter(Boolean).join('，');
  const className = ['inspector-transcript-line', current && 'is-current', selected && 'is-selected', used && 'is-used', usedStart && 'is-used-start', corrected && 'is-corrected', editing && 'is-editing'].filter(Boolean).join(' ');
  return <>
    <div className={className} data-line-id={line.id} onMouseDown={actions.press}>
      <button
        type="button"
        className="inspector-line-check"
        tabIndex={-1}
        aria-label={`${selected ? '取消选择' : '选择'} ${time} 的字幕`}
        aria-pressed={selected}
        onClick={event => actions.toggle(line.id, event.shiftKey)}
      ><span aria-hidden="true">{selected && <Check size={11} strokeWidth={3} />}</span></button>
      <button type="button" className="watch-line__time tabular" tabIndex={-1} title={`跳转至 ${time}`} disabled={!canSeek} onClick={() => actions.seek(line.id)}>{label}</button>
      <button
        type="button"
        className="watch-line__text"
        tabIndex={0}
        aria-current={current ? 'time' : undefined}
        aria-description={state || undefined}
        onClick={event => actions.activate(line.id, event)}
        onKeyDown={event => actions.key(line.id, event)}
        onKeyUp={event => { if (event.key === ' ') event.preventDefault(); }}
        onFocus={() => actions.focus(line.id)}
      ><span className="watch-line__original" lang={script === 'translation' && line.translation?.trim() ? 'zh-CN' : undefined}>{sentenceNodes(sentence, query, breaks)}</span>{gloss && <span className="watch-line__translation" lang="zh-CN">{line.translation}</span>}</button>
      <span className="watch-line__aside">
        {usedStart && <span className="watch-line__flag">已摘录</span>}
        <button
          type="button"
          className={`inspector-line-edit${corrected ? ' is-corrected' : ''}`}
          tabIndex={-1}
          disabled={editDisabled}
          title={editTitle}
          aria-label={`校对 ${time} 的字幕`}
          data-testid={`edit-transcript-${line.id}`}
          onClick={() => actions.edit(line.id)}
          onKeyDown={event => actions.editKey(line.id, event)}
        ><Pencil size={13} aria-hidden="true" /></button>
      </span>
    </div>
    {after}
  </>;
});

/** “已选 2 句 01:45–01:54” + copy, (excerpt with a note), excerpt to canvas. Sits right under the selection (§6.18.2). */
function SelectionBar({ count, range, readOnly, onCopy, onExcerpt, onAnnotate, onWrite, writeLine, onDragStart }: {
  count: number;
  range: string;
  readOnly: boolean;
  onCopy: () => void;
  onExcerpt: () => void;
  onAnnotate?: () => void;
  /** On a “补一个镜头” trip: give the selection to script line `writeLine` (`shot`) or write it in after that line (`line`). */
  onWrite?: (mode: TripWriteMode) => void;
  writeLine?: number;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  const row = writeLine ? `第 ${writeLine} 行` : '这一行';
  // The time range is never cut (FV-M8): count and range wrap onto two lines before anything is shortened, and a
  // narrow column shows “摘录并写理解” as its icon (name and tooltip kept). On a “补一个镜头” trip “摘录到画布” is its icon,
  // so the two trip actions keep their words.
  return <div className={`watch-selection${onWrite ? ' is-trip' : ''}`} role="group" aria-label="所选句子">
    <span className="watch-selection__what">
      <span className="watch-selection__count">已选 <b className="tabular">{count}</b> 句</span>
      {range && <span className="watch-selection__range tabular">{range}</span>}
    </span>
    <button type="button" className="icon-btn icon-btn--sm" aria-label="复制所选" title="复制所选" onClick={onCopy}><Copy size={15} aria-hidden="true" /></button>
    {onAnnotate && <button type="button" className="btn btn--sm watch-selection__annotate" aria-label="摘录并写理解" title="摘录并写理解" onClick={onAnnotate}>
      <PenLine size={14} aria-hidden="true" /><span className="watch-selection__label">摘录并写理解</span>
    </button>}
    <button
      type="button"
      className={`btn btn--sm ${onWrite ? '' : 'btn--soft '}watch-selection__excerpt`}
      aria-label="摘录到画布"
      title={readOnly ? '此窗口只读' : `${withShortcut('摘录到画布', 'excerpt')}，也可以拖到画布上`}
      disabled={readOnly}
      draggable={!readOnly}
      onDragStart={onDragStart}
      onClick={onExcerpt}
    ><Plus size={14} aria-hidden="true" /><span className="watch-selection__excerpt-label">摘录到画布</span><kbd aria-hidden="true">E</kbd></button>
    {/* “补一个镜头”往返（§6.29）：主按钮把所选片段作为出发那一行的画面；次要按钮把原话另起一行写在它后面 */}
    {onWrite && <button type="button" className="btn btn--sm watch-selection__newline" aria-label={`另起一行写进原话，在${row}之后`} title={`把原话和出处写成${row}之后的新一行，然后回到脚本`} onClick={() => onWrite('line')}>
      <PenLine size={14} aria-hidden="true" /><span className="watch-selection__label">另起一行写进原话</span>
    </button>}
    {onWrite && <button type="button" className="btn btn--sm btn--soft watch-selection__write" aria-label={`配给${row}`} title={`把所选片段作为${row}的画面，旁白不变，然后回到脚本`} onClick={() => onWrite('shot')}>
      <Clapperboard size={14} aria-hidden="true" />配给这一行
    </button>}
  </div>;
}

/** Chunk visibility for long lists: chunks near the viewport render rows, the rest keep their measured height. */
function useChunkWindow(count: number, scrollerRef: { current: HTMLDivElement | null }) {
  const enabled = count >= VIRTUAL_MIN;
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set([0, 1]));
  const heights = useRef(new Map<number, number>());
  const elements = useRef(new Map<number, HTMLElement>());
  const refs = useRef(new Map<number, (element: HTMLDivElement | null) => void>());
  const intersection = useRef<IntersectionObserver | null>(null);
  const resize = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver !== 'function') return;
    intersection.current = new IntersectionObserver(entries => {
      setNear(previous => {
        const next = new Set(previous);
        for (const entry of entries) {
          const chunk = Number((entry.target as HTMLElement).dataset.chunk);
          if (entry.isIntersecting) next.add(chunk); else next.delete(chunk);
        }
        return next.size === previous.size && [...next].every(chunk => previous.has(chunk)) ? previous : next;
      });
    }, { root: scrollerRef.current, rootMargin: '900px 0px' });
    resize.current = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        // An opened chunk (display: contents) has no box of its own: keep its last real height.
        if (element.childElementCount && element.offsetHeight > 0) heights.current.set(Number(element.dataset.chunk), element.offsetHeight);
      }
    }) : null;
    for (const element of elements.current.values()) { intersection.current.observe(element); resize.current?.observe(element); }
    return () => { intersection.current?.disconnect(); resize.current?.disconnect(); intersection.current = null; resize.current = null; };
  }, [enabled, scrollerRef]);
  const refFor = (chunk: number) => {
    let ref = refs.current.get(chunk);
    if (!ref) {
      ref = (element: HTMLDivElement | null) => {
        const previous = elements.current.get(chunk);
        if (previous && previous !== element) { intersection.current?.unobserve(previous); resize.current?.unobserve(previous); elements.current.delete(chunk); }
        if (element) { elements.current.set(chunk, element); intersection.current?.observe(element); resize.current?.observe(element); }
      };
      refs.current.set(chunk, ref);
    }
    return ref;
  };
  return {
    enabled,
    chunks: (total: number) => Array.from({ length: Math.ceil(total / CHUNK) }, (_, index) => index),
    isNear: (chunk: number) => near.has(chunk),
    heightOf: (chunk: number, rows: number) => heights.current.get(chunk) ?? rows * ROW_ESTIMATE,
    refFor,
  };
}
