import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { BoardNode, CardData } from './model';
import { timecode } from './model';
import { formatCount, kindDisplayName } from './cards/card-utils';
import { useBoard } from './board-context';
import type { BoardActions } from './board-context';
import { editTranscriptLine, transcriptRevision } from './transcript-tools';
import type { DraftEditorState } from './draft-navigation';
import { getSourceUrl } from './media-source';
import { resolveTextAnchor } from './text-anchor';
import { plainMarkdown } from './source-location';
import { isSampleAsset } from './templates';
import { registerCanvasOverlay } from './canvas/safe-area';
import { directVideoUrl, inspectorLayoutFor, InspectorShellContext, isEditableTarget, safeWebUrl } from './inspector/shared';
import type { EditingTranscriptLine, ImageSize, InspectorLayout, InspectorShellContextValue, InspectorSlotName, ReplaceAction, SourceReveal, TextSelection } from './inspector/shared';
import { clampPanelWidth, draftScrollAnchors, inspectorPresence, inspectorSessions, PANEL_WIDTH, readPanelWidth, rememberInspectorSession, writePanelWidth } from './inspector/session-cache';
import { captureScrollAnchor, restoreScrollAnchor } from './inspector/draft-editor/scroll-anchor';
import type { InspectorSession } from './inspector/session-cache';
import { restoreReadingSelection } from './inspector/reading-selection';
import { videoQuotes } from './inspector/video-watch';
import { useXPostView } from './inspector/x-post-view';
import InspectorHeader from './inspector/InspectorHeader';
import InspectorTitle from './inspector/InspectorTitle';
import XProvenanceSection from './inspector/XProvenanceSection';
import VideoMediaPanel from './inspector/VideoMediaPanel';
import XPostSection from './inspector/XPostSection';
import VideoProcessingStatus from './inspector/VideoProcessingStatus';
import TranscriptPanel from './inspector/TranscriptPanel';
import VideoNotesSection from './inspector/VideoNotesSection';
import TranscriptExcerptFooter from './inspector/TranscriptExcerptFooter';
import SaveRecoveryNotice from './inspector/SaveRecoveryNotice';
import ImageSourcePanel from './inspector/ImageSourcePanel';
import QuoteCitationPanel from './inspector/QuoteCitationPanel';
import DraftWritingSection from './inspector/DraftWritingSection';
import TextSourceSection, { readsByDefault } from './inspector/TextSourceSection';
import CardBodySection from './inspector/CardBodySection';
import DraftExportFooter from './inspector/DraftExportFooter';
import TextExcerptFooter from './inspector/TextExcerptFooter';
import SourceUrlField from './inspector/SourceUrlField';
import TagsField, { editableTags } from './inspector/TagsField';
import ImagePreviewDialog from './inspector/ImagePreviewDialog';
import TranscriptCorrectionDialog from './inspector/TranscriptCorrectionDialog';
import ReplaceTranscriptDialog from './inspector/ReplaceTranscriptDialog';
import type { DraftEditorHandle } from './inspector/draft-editor/handle';

export { insertDraftText } from './inspector/draft-text';

/** Optional App action (integration request inspector-shell): pan the canvas so this card is in view, select and focus it. */
type ShellBoardActions = BoardActions & { revealCard?: (id: string) => void };

const PLATFORM_HOSTS: [RegExp, string][] = [
  [/(?:^|\.)douyin\.com$|(?:^|\.)iesdouyin\.com$/, '抖音'], [/(?:^|\.)bilibili\.com$|(?:^|\.)b23\.tv$/, '哔哩哔哩'],
  [/(?:^|\.)youtube\.com$|(?:^|\.)youtu\.be$/, 'YouTube'], [/(?:^|\.)x\.com$|(?:^|\.)twitter\.com$/, 'X'],
  [/(?:^|\.)xiaohongshu\.com$|(?:^|\.)xhslink\.com$/, '小红书'], [/(?:^|\.)kuaishou\.com$/, '快手'],
  [/(?:^|\.)weixin\.qq\.com$/, '公众号'], [/(?:^|\.)vimeo\.com$/, 'Vimeo'],
];
/** A platform name for header meta; site names only, never the shape of a provenance tag (§6.7). */
function platformName(url?: string): string | undefined {
  if (!url) return undefined;
  try { const host = new URL(url).hostname.replace(/^www\./, ''); return PLATFORM_HOSTS.find(([pattern]) => pattern.test(host))?.[1]; }
  catch { return undefined; }
}

/** “读到 18%” follows the reading scroll on its own, so scrolling never re-renders the article. */
function ReadingProgress({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  const [percent, setPercent] = useState<number | null>(null);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const range = scroll.scrollHeight - scroll.clientHeight;
      // A text that fits without scrolling has no progress to report; a long one says so from the first screen (§6.18.3).
      setPercent(range > 8 ? Math.round(Math.min(1, Math.max(0, scroll.scrollTop / range)) * 100) : null);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    scroll.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onScroll) : null;
    observer?.observe(scroll);
    return () => { scroll.removeEventListener('scroll', onScroll); observer?.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [scrollRef]);
  if (percent === null) return null;
  return <span className="inspector-head-progress">{percent >= 100 ? '已读到结尾' : <>读到 <span className="tabular">{percent}%</span></>}</span>;
}

interface InspectorProps {
  node: BoardNode;
  /** A pinned draft ignores Esc and the narrow scrim. A companion is the left column. */
  slot?: 'pinned' | 'companion';
  onClose: () => void;
  onImportSubtitles: (nodeId: string) => void;
  onNativeTranscribe?: (nodeId: string) => void | Promise<void>;
  onNotify: (message: string) => void;
  imagePreviewToken?: number;
}

/**
 * Inspector shell: owns per-card state, visit/draft/source restoration and the panel
 * frame, and dispatches each card kind to its sections in `./inspector/`.
 * Layouts, regions and slots: DESIGN_SYSTEM §6.18 and docs/redesign/integration/inspector-shell.md.
 */
export default function Inspector({ node, slot, onClose, onImportSubtitles, onNativeTranscribe, onNotify, imagePreviewToken = 0 }: InspectorProps) {
  const board = useBoard();
  const { data } = node;
  const nativeMediaUrl = data.url && /^(?:media|field-media):\/\//.test(data.url) ? data.url : undefined;
  const savedSourceUrl = getSourceUrl(data);
  const [query, setQuery] = useState('');
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(() => board.getVideoPlayback(node.id).time);
  const initialSession = inspectorSessions.get(node.id);
  const initialEditorState = board.draftRestore?.draftId === node.id ? board.draftRestore.editor : initialSession?.editor;
  const [showVersions, setShowVersions] = useState(() => !!initialEditorState?.versionsOpen);
  const [showReferences, setShowReferences] = useState(() => !!initialEditorState?.referencesOpen);
  const [writingExpanded, setWritingExpanded] = useState(() => !!initialEditorState?.writingExpanded);
  const [sourceReveal, setSourceReveal] = useState<SourceReveal | null>(() => board.sourceTextReveal?.nodeId === node.id ? board.sourceTextReveal : null);
  // A text source opens in reading on its first visit (PR-M1); a card the person switched to “编辑” stays in edit (session cache).
  const [reading, setReading] = useState(() => board.sourceTextReveal?.nodeId === node.id || (initialSession ? !!initialSession.reading : readsByDefault(data)));
  const [readingExpanded, setReadingExpanded] = useState(() => !!initialSession?.readingExpanded);
  const [xPostExpanded, setXPostExpanded] = useState(false);
  const [chosenSourceMatch, setChosenSourceMatch] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null);
  const [showImage, setShowImage] = useState(false);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [tagsInput, setTagsInput] = useState(() => editableTags(data.tags));
  const [urlInput, setUrlInput] = useState(savedSourceUrl);
  const [urlError, setUrlError] = useState('');
  const [mediaError, setMediaError] = useState(false);
  const [nativeTranscribeBusy, setNativeTranscribeBusy] = useState(false);
  const [editingLine, setEditingLine] = useState<EditingTranscriptLine | null>(null);
  const [replaceAction, setReplaceAction] = useState<ReplaceAction | null>(null);
  const nativeTranscribeLock = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);
  const resizeDrag = useRef<{ x: number; width: number; current: number } | null>(null);
  const [slots, setSlots] = useState<Partial<Record<InspectorSlotName, HTMLElement | null>>>({});
  const slotRefs = useMemo(() => {
    const bind = (name: InspectorSlotName) => (element: HTMLElement | null) => setSlots(current => current[name] === element ? current : { ...current, [name]: element });
    return { 'header-meta': bind('header-meta'), 'header-actions': bind('header-actions'), lead: bind('lead'), margin: bind('margin') };
  }, []);
  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    const resize = () => { title.style.height = '0px'; title.style.height = `${title.scrollHeight}px`; };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(title);
    return () => observer.disconnect();
  }, [node.id, data.title, readingExpanded, writingExpanded]);
  const liveSessions = useRef(new Map<string, InspectorSession>());
  const restoredVisit = useRef<string | null>(null);
  const transcript = data.transcript || [];
  const sourceUrl = safeWebUrl(savedSourceUrl);
  // Shipped example films (/assets/samples/*.mp4) play from the app itself (EXAMPLE_CONTENT §8.2).
  const videoUrl = board.getMediaUrl(data.mediaId) || nativeMediaUrl || directVideoUrl(data.url) || (isSampleAsset(data.url) ? data.url : undefined);
  const imageUrl = board.getMediaUrl(data.mediaId) || data.poster || sourceUrl;
  const mediaStatus = data.mediaId ? board.getMediaStatus?.(data.mediaId) : undefined;
  const mediaLoading = mediaStatus === 'loading';
  const mediaUnavailable = mediaStatus === 'missing' || mediaStatus === 'error';
  const isVideo = data.kind === 'video';
  const isDraft = data.kind === 'draft';
  const isTextSource = data.kind === 'note' || data.kind === 'link';
  const layout: InspectorLayout = inspectorLayoutFor(data.kind, writingExpanded, readingExpanded);
  // §7 motion: opening animates, a layout switch animates, a card switch inside an open panel does not.
  const [openedFresh] = useState(() => inspectorPresence.mounted === 0);
  const motion = useRef<{ layout: InspectorLayout; kind: 'open' | 'switch' | 'none' }>({ layout, kind: openedFresh ? 'open' : 'none' });
  if (motion.current.layout !== layout) motion.current = { layout, kind: 'switch' };
  useLayoutEffect(() => { inspectorPresence.mounted++; return () => { inspectorPresence.mounted--; }; }, []);
  const xView = useXPostView(node, savedSourceUrl, xPostExpanded);
  const normalizedBody = useMemo(() => data.body.replace(/\r\n?/g, '\n'), [data.body]);
  const canPlay = board.activeVideo === node.id;
  const savedTags = editableTags(data.tags);
  const videoImport = data.videoImport;
  const importBusy = !!videoImport && ['queued', 'downloading', 'transcribing'].includes(videoImport.status);
  const importActionPending = board.videoImportActionPending(node.id);
  const transcriptProcessing = importBusy || nativeTranscribeBusy || importActionPending;
  const transcriptBusy = transcriptProcessing || !!board.readOnly;
  const canRetryImport = !!videoImport && ['failed', 'cancelled', 'interrupted'].includes(videoImport.status);
  const revealQuote = sourceReveal?.quoteNodeId
    ? board.nodes.find(item => item.id === sourceReveal.quoteNodeId && item.data.kind === 'quote' && item.data.citation?.nodeId === node.id)
    : undefined;
  const revealCitation = useMemo(
    () => revealQuote?.data.citation || (!sourceReveal?.quoteNodeId && sourceReveal?.quoteText ? { nodeId: node.id, title: data.title, text: sourceReveal.quoteText } : undefined),
    [revealQuote?.data.citation, sourceReveal, node.id, data.title],
  );
  const sourceLocation = useMemo(() => isTextSource && revealCitation ? resolveTextAnchor(normalizedBody, revealCitation) : null, [isTextSource, normalizedBody, revealCitation]);
  const sourceRange = sourceLocation?.status === 'matched'
    ? sourceLocation.matches[0]
    : chosenSourceMatch !== null ? sourceLocation?.matches[chosenSourceMatch] ?? null : null;
  // Playback ownership (contract B5): this ref binds the Inspector surface for this card.
  const bindPlayer = useCallback((player: HTMLVideoElement | null) => {
    videoRef.current = player;
    board.bindVideoPlayer(node.id, 'inspector', player);
  }, [node.id, board.bindVideoPlayer]);

  useEffect(() => {
    setQuery(''); setSelectedLines(new Set()); setLastSelected(null); setCurrentTime(board.getVideoPlayback(node.id).time);
    const session = inspectorSessions.get(node.id);
    const restore = board.draftRestore?.draftId === node.id ? board.draftRestore.editor : session?.editor;
    setShowVersions(!!restore?.versionsOpen); setShowReferences(!!restore?.referencesOpen); setWritingExpanded(!!restore?.writingExpanded); setMediaError(false);
    setSourceReveal(board.sourceTextReveal?.nodeId === node.id ? board.sourceTextReveal : null); setChosenSourceMatch(null);
    setReading(board.sourceTextReveal?.nodeId === node.id || (session ? !!session.reading : readsByDefault(data))); setReadingExpanded(!!session?.readingExpanded); setXPostExpanded(false);
    setTagsInput(editableTags(data.tags)); setUrlInput(savedSourceUrl); setUrlError('');
  }, [node.id]);

  // Source text reveal token (contract C12): enter reading, then acknowledge the token.
  useLayoutEffect(() => {
    const request = board.sourceTextReveal;
    if (!isTextSource || !request || request.nodeId !== node.id) return;
    restoredVisit.current = node.id;
    setSourceReveal(request); setChosenSourceMatch(null); setReading(true);
    board.completeSourceTextReveal?.(request.token);
  }, [board.sourceTextReveal, board.completeSourceTextReveal, node.id, isTextSource]);

  // Visit cache (contract C19): remember positions, never the body, when the panel unmounts.
  useLayoutEffect(() => {
    const editor = editorRef.current;
    const scroll = scrollRef.current;
    return () => {
      const session = liveSessions.current.get(node.id);
      if (!session) return;
      rememberInspectorSession(node.id, { ...session, editor: { ...session.editor,
        selectionStart: editor?.selectionStart ?? session.editor.selectionStart,
        selectionEnd: editor?.selectionEnd ?? session.editor.selectionEnd,
        selectionDirection: editor?.selectionDirection ?? session.editor.selectionDirection,
        editorScrollTop: editor?.scrollTop ?? session.editor.editorScrollTop,
        editorScrollLeft: editor?.scrollLeft ?? session.editor.editorScrollLeft,
        inspectorScrollTop: scroll?.scrollTop ?? session.editor.inspectorScrollTop,
      }, ...(session.reading ? { readingScrollTop: scroll?.scrollTop ?? session.readingScrollTop } : { editingScrollTop: scroll?.scrollTop ?? session.editingScrollTop }) });
    };
  }, [node.id]);

  useLayoutEffect(() => {
    if (restoredVisit.current === node.id || board.draftRestore?.draftId === node.id || board.sourceTextReveal?.nodeId === node.id) return;
    const session = inspectorSessions.get(node.id);
    if (!session) { restoredVisit.current = node.id; return; }
    if (reading !== session.reading || readingExpanded !== session.readingExpanded || writingExpanded !== !!session.editor.writingExpanded) return;
    const frame = requestAnimationFrame(() => {
      const editor = editorRef.current;
      const state = session.editor;
      if (editor) {
        editor.setSelectionRange(Math.min(editor.value.length, state.selectionStart), Math.min(editor.value.length, state.selectionEnd), state.selectionDirection);
        editor.scrollTop = state.editorScrollTop; editor.scrollLeft = state.editorScrollLeft;
      }
      if (scrollRef.current) scrollRef.current.scrollTop = state.inspectorScrollTop;
      if (reading && state.selectionStart < state.selectionEnd) {
        const content = scrollRef.current?.querySelector<HTMLElement>('.inspector-reading-body');
        if (content && state.selectionEnd <= normalizedBody.length) {
          const range = { from: state.selectionStart, to: state.selectionEnd };
          if (restoreReadingSelection(content, range)) setTextSelection({ ...range, bodySnapshot: data.body });
        }
      }
      restoredVisit.current = node.id;
    });
    return () => cancelAnimationFrame(frame);
  }, [node.id, board.draftRestore, board.sourceTextReveal, reading, readingExpanded, writingExpanded]);

  // Draft restore token (contract C12): align the three panels first, restore after two frames, then acknowledge.
  useLayoutEffect(() => {
    const restore = board.draftRestore;
    if (!isDraft || !restore || restore.draftId !== node.id) return;
    const state = restore.editor;
    if (showReferences !== !!state.referencesOpen || showVersions !== !!state.versionsOpen || writingExpanded !== !!state.writingExpanded) {
      setShowReferences(!!state.referencesOpen); setShowVersions(!!state.versionsOpen); setWritingExpanded(!!state.writingExpanded);
      return;
    }
    let nextFrame = 0;
    const frame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const start = Math.min(editor.value.length, Math.max(0, state.selectionStart));
        const end = Math.min(editor.value.length, Math.max(start, state.selectionEnd));
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(start, end, state.selectionDirection);
        editor.scrollTop = state.editorScrollTop;
        editor.scrollLeft = state.editorScrollLeft;
        if (scrollRef.current) scrollRef.current.scrollTop = state.inspectorScrollTop;
        // The pixel offsets above are a fallback: the line that was at the top comes back to the same place (INSP-08).
        const anchor = draftScrollAnchors.get(node.id);
        const view = (editor as Partial<DraftEditorHandle>).view;
        if (anchor && view) { draftScrollAnchors.delete(node.id); restoreScrollAnchor(view, anchor); }
        // This visit is restored: the visit cache must not apply its own pixel offsets once the token is gone.
        restoredVisit.current = node.id;
        board.completeDraftRestore(restore.token);
      });
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame); };
  }, [board.draftRestore, board.completeDraftRestore, isDraft, node.id, showReferences, showVersions, writingExpanded]);

  useEffect(() => { setUrlInput(savedSourceUrl); setUrlError(''); }, [node.id, savedSourceUrl]);
  useEffect(() => { setTagsInput(savedTags); }, [node.id, savedTags]);
  useEffect(() => {
    setSelectedLines(previous => new Set([...previous].filter(id => data.transcript?.some(line => line.id === id))));
    setLastSelected(null);
  }, [node.id, data.transcript]);
  useEffect(() => { setMediaError(false); }, [videoUrl, imageUrl]);
  useEffect(() => { setTextSelection(null); }, [node.id, data.body]);
  useEffect(() => { setChosenSourceMatch(null); }, [node.id, data.body]);
  useEffect(() => { setShowImage(false); setImageSize(null); }, [node.id, imageUrl]);
  // Each open request shows the original once, as soon as its URL is known; a new URL later (the picture was replaced,
  // CORE-08) does not reopen a viewer that was closed.
  const shownPreviewToken = useRef(0);
  useEffect(() => {
    if (data.kind === 'image' && imagePreviewToken > shownPreviewToken.current && imageUrl) { shownPreviewToken.current = imagePreviewToken; setShowImage(true); }
  }, [data.kind, imagePreviewToken, node.id, imageUrl]);
  useEffect(() => {
    const player = videoRef.current;
    if (player && canPlay && player.readyState >= 1) {
      board.restoreVideoPlayback(node.id, 'inspector', player);
      setCurrentTime(player.currentTime);
    }
  }, [canPlay, node.id, videoUrl, board.videoPlaybackVersion, board.restoreVideoPlayback]);

  const patch = (value: Partial<CardData>) => board.updateCard(node.id, value);
  const retryMedia = () => {
    setMediaError(false);
    if (data.mediaId) board.retryMedia?.(data.mediaId);
  };
  const runNativeTranscribe = async () => {
    if (!onNativeTranscribe || (!data.nativeAssetId&&!data.mediaId) || importBusy || importActionPending || nativeTranscribeLock.current) return;
    nativeTranscribeLock.current = true;
    setNativeTranscribeBusy(true);
    try { await onNativeTranscribe(node.id); }
    catch (error) { onNotify(`转写未完成：${error instanceof Error ? error.message : String(error)}`); }
    finally { nativeTranscribeLock.current = false; setNativeTranscribeBusy(false); }
  };
  const saveCorrection = (text: string): string | void => {
    if (!editingLine) return '找不到正在校对的句子，请关闭后重新打开。';
    if (transcriptBusy) return '逐字稿正在处理中，请稍后再校对。';
    if (editingLine.nodeId !== node.id || editingLine.revision !== transcriptRevision(data)) return '这份逐字稿刚有更新。请保留需要的文字，取消后重新打开这一句。';
    const currentLine = transcript.find(line => line.id === editingLine.line.id);
    if (!currentLine || currentLine.text !== editingLine.line.text) return '这句话刚有更新。请保留需要的文字，取消后重新打开。';
    try {
      const correction = editTranscriptLine(data, currentLine.id, text);
      if (Object.keys(correction).length) {
        if (!board.updateCard(node.id, correction)) return '校对尚未保存，请检查画布提示后重试。';
        onNotify(lineExcerpted(currentLine) ? `已校对 ${timecode(currentLine.start)}，已有摘录保留原来的文字` : `已校对 ${timecode(currentLine.start)}`);
      }
      setEditingLine(null);
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  };
  /** Whether an excerpt of this film covers the sentence (only then do the correction notes mention excerpts). */
  const lineExcerpted = (line: { start: number; end: number }) => videoQuotes(board.nodes, node.id).some(quote => line.start < quote.end - 0.01 && line.end > quote.start + 0.01);
  const confirmReplacement = () => {
    if (transcriptBusy) return;
    const action = replaceAction;
    setReplaceAction(null);
    if (action === 'subtitles') onImportSubtitles(node.id);
    else void runNativeTranscribe();
  };
  /** The full DraftEditorState (9 fields) used by navigation and restore (contract C11). */
  const captureDraftEditor = (): DraftEditorState => {
    const editor = editorRef.current;
    const previous = liveSessions.current.get(node.id)?.editor;
    return {
      selectionStart: reading && textSelection?.bodySnapshot === data.body ? textSelection.from : editor?.selectionStart ?? previous?.selectionStart ?? normalizedBody.length,
      selectionEnd: reading && textSelection?.bodySnapshot === data.body ? textSelection.to : editor?.selectionEnd ?? previous?.selectionEnd ?? normalizedBody.length,
      selectionDirection: editor?.selectionDirection ?? previous?.selectionDirection ?? 'none',
      editorScrollTop: editor?.scrollTop ?? previous?.editorScrollTop ?? 0,
      editorScrollLeft: editor?.scrollLeft ?? previous?.editorScrollLeft ?? 0,
      inspectorScrollTop: scrollRef.current?.scrollTop ?? 0,
      referencesOpen: showReferences,
      versionsOpen: showVersions,
      writingExpanded,
    };
  };
  const visitSnapshot = (): InspectorSession => {
    const previous = liveSessions.current.get(node.id);
    const editor = captureDraftEditor();
    return { editor, reading, readingExpanded,
      readingScrollTop: reading ? editor.inspectorScrollTop : previous?.readingScrollTop,
      editingScrollTop: reading ? previous?.editingScrollTop : editor.inspectorScrollTop,
    };
  };
  liveSessions.current.set(node.id, visitSnapshot());
  const rememberVisit = () => rememberInspectorSession(node.id, visitSnapshot());
  const closeInspector = () => { rememberVisit(); onClose(); };
  const toggleWritingWidth = () => {
    const saved = captureDraftEditor();
    setWritingExpanded(value => !value);
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(saved.selectionStart, saved.selectionEnd, saved.selectionDirection);
      editor.scrollTop = saved.editorScrollTop;
      editor.scrollLeft = saved.editorScrollLeft;
      if (scrollRef.current) scrollRef.current.scrollTop = saved.inspectorScrollTop;
      // The other layout wraps lines differently: the draft editor centres the caret instead of a stale scroll offset.
      (editor as Partial<DraftEditorHandle>).revealSelection?.();
    });
  };
  const shellBoard = board as ShellBoardActions;
  /**
   * Bring this card into the visible canvas (the reading strip, §6.18.3). App's own reveal waits two frames,
   * so it measures the strip after the new layout and the reading panel's right-edge overlay are in place.
   * Without the optional `revealCard` action the shell reuses `openCard` on the same card, which selects it and
   * queues the same reveal; it is skipped on a draft source trip because `openCard` ends that trip.
   */
  const revealOnCanvas = shellBoard.revealCard
    ? () => shellBoard.revealCard!(node.id)
    : !board.draftReturn ? () => board.openCard(node.id) : undefined;
  const toggleReadingWidth = () => {
    const saved = captureDraftEditor();
    const expanding = !readingExpanded;
    setReadingExpanded(value => !value);
    if (expanding) revealOnCanvas?.();
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = saved.inspectorScrollTop; });
  };
  /**
   * Esc leaves one layer at a time (§6.18, KB-M1): focus writing or reading collapses first (the editor keeps its
   * selection), a focused field in the panel then gives up focus to the close button, and only then the panel
   * closes; App returns focus to the card on the canvas. Callers have already ruled out IME composition.
   */
  const tripBack = layout === 'video' && !!board.draftReturn && board.draftReturn.draftId !== node.id;
  const handleEscape = (target: EventTarget | null) => {
    if (layout === 'writing') { toggleWritingWidth(); return; }
    if (layout === 'reading') { toggleReadingWidth(); return; }
    if (isEditableTarget(target)) {
      const close = asideRef.current?.querySelector<HTMLElement>(tripBack ? '.inspector-head-return' : '.inspector-head-close');
      if (close) { close.focus(); return; }
      target.blur();
      return;
    }
    // On a trip from a draft the workbench's first button is “返回文稿 Esc”: Esc goes back to the draft (INSP-13).
    if (tripBack) { rememberVisit(); board.returnToDraft(); return; }
    // A pinned draft stays until its own close button. Esc has already collapsed writing or reading above.
    if (slot === 'pinned') return;
    closeInspector();
  };
  const latestEscape = useRef(handleEscape);
  latestEscape.current = handleEscape;
  // The reading strip keeps the canvas usable; Esc pressed there collapses reading instead of closing the panel.
  useEffect(() => {
    if (layout !== 'reading') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target && asideRef.current?.contains(target)) return;
      if (isEditableTarget(target) || document.fullscreenElement) return;
      if (document.querySelector('dialog[open], .modal, .context-menu, [role="menu"]')) return;
      event.preventDefault();
      event.stopPropagation();
      latestEscape.current(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [layout]);
  // The reading panel covers the right of a full-width canvas: register it so every reveal uses the strip.
  useLayoutEffect(() => {
    const aside = asideRef.current;
    if (!aside || layout !== 'reading') return;
    const release = registerCanvasOverlay(aside, 'right');
    return () => { release(); delete aside.dataset.canvasOverlay; };
  }, [layout]);
  /** Docked width: dragged on the left edge, applied to the CSS variable directly and committed on release. */
  const applyPanelWidth = (value: number) => { asideRef.current?.style.setProperty('--inspector-w', `${clampPanelWidth(value)}px`); };
  const commitPanelWidth = (value: number) => { const width = clampPanelWidth(value); applyPanelWidth(width); setPanelWidth(width); writePanelWidth(width); };
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeDrag.current = { x: event.clientX, width: panelWidth, current: panelWidth };
    asideRef.current?.classList.add('is-resizing');
  };
  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizeDrag.current;
    if (!drag) return;
    drag.current = clampPanelWidth(drag.width + drag.x - event.clientX);
    applyPanelWidth(drag.current);
  };
  const endResize = () => {
    const drag = resizeDrag.current;
    if (!drag) return;
    resizeDrag.current = null;
    asideRef.current?.classList.remove('is-resizing');
    commitPanelWidth(drag.current);
  };
  const resizeWithKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowLeft' ? panelWidth + PANEL_WIDTH.step : event.key === 'ArrowRight' ? panelWidth - PANEL_WIDTH.step
      : event.key === 'Home' ? PANEL_WIDTH.min : event.key === 'End' ? PANEL_WIDTH.max : event.key === 'Enter' ? PANEL_WIDTH.default : null;
    if (next === null) return;
    event.preventDefault();
    commitPanelWidth(next);
  };
  /** Switch text reading/editing while carrying the same LF offsets across both surfaces. */
  const changeReadingMode = (next: boolean) => {
    if (reading === next) return;
    const session = visitSnapshot();
    liveSessions.current.set(node.id, session);
    const saved = session.editor;
    setTextSelection(null); setReading(next);
    requestAnimationFrame(() => {
      if (next) {
        const content = scrollRef.current?.querySelector<HTMLElement>('.inspector-reading-body');
        content?.focus({ preventScroll: true });
        if (content && saved.selectionStart < saved.selectionEnd) {
          const range = { from: saved.selectionStart, to: saved.selectionEnd };
          const selection = restoreReadingSelection(content, range);
          if (selection) {
            setTextSelection({ ...range, bodySnapshot: data.body });
            if (session.readingScrollTop === undefined && scrollRef.current) {
              const rect = selection.getBoundingClientRect(), viewport = scrollRef.current.getBoundingClientRect();
              scrollRef.current.scrollTop += rect.top - viewport.top - scrollRef.current.clientHeight / 3;
              return;
            }
          }
        }
      }
      else if (editorRef.current) {
        const editor = editorRef.current;
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(saved.selectionStart, saved.selectionEnd, saved.selectionDirection);
        editor.scrollTop = saved.editorScrollTop; editor.scrollLeft = saved.editorScrollLeft;
      }
      if (scrollRef.current) scrollRef.current.scrollTop = (next ? session.readingScrollTop : session.editingScrollTop) ?? 0;
    });
  };
  /** Draft navigation (contract C11): remember the visit, then hand over the full editor state. */
  const openDraftSource = (sourceId: string, time?: number, quoteNodeId?: string, insert?: { insertAfter: number; line?: number }) => {
    const view = (editorRef.current as Partial<DraftEditorHandle> | null)?.view;
    if (view) draftScrollAnchors.set(node.id, captureScrollAnchor(view));
    rememberVisit();
    board.openDraftSource({ draftId: node.id, sourceId, time, quoteNodeId, editor: captureDraftEditor(), ...insert });
  };

  const shellClassName = [
    'inspector', `inspector--${layout === 'docked' ? 'docked' : layout === 'video' ? 'video' : layout === 'reading' ? 'reading-expanded' : 'writing-expanded'}`,
    slot === 'pinned' && 'inspector--pinned', slot === 'companion' && 'inspector--companion',
    isDraft && 'inspector--draft', isTextSource && reading && 'inspector--reading', `inspector--motion-${motion.current.kind}`,
  ].filter(Boolean).join(' ');
  const shellContext = useMemo<InspectorShellContextValue>(() => ({ layout, slots }), [layout, slots]);
  const headerTitle = layout === 'docked' || layout === 'video'
    ? <InspectorTitle nodeId={node.id} data={data} titleRef={titleRef} patch={patch} variant="header" />
    : undefined;
  const bodyTitle = layout === 'reading' || layout === 'writing'
    ? <InspectorTitle nodeId={node.id} data={data} titleRef={titleRef} patch={patch} variant={layout === 'writing' ? 'paper' : 'article'} />
    : null;
  const platform = isVideo || isTextSource ? platformName(savedSourceUrl) : undefined;
  const readingLength = useMemo(() => layout === 'reading' ? Array.from(plainMarkdown(normalizedBody).replace(/\s+/g, '')).length : 0, [layout, normalizedBody]);
  const headerMeta = layout === 'video' ? <>
    {platform && <span>{platform}</span>}
    {!!data.duration && <span className="tabular">{timecode(data.duration)}</span>}
  </> : layout === 'reading' ? <>
    {platform && <span>{platform}</span>}
    {readingLength > 0 && <span><span className="tabular">{formatCount(readingLength)}</span> 字</span>}
    <ReadingProgress key={layout} scrollRef={scrollRef} />
  </> : null;
  const findOnCanvas = layout === 'reading' ? revealOnCanvas
    : layout === 'video' && shellBoard.revealCard ? () => { closeInspector(); shellBoard.revealCard!(node.id); } : undefined;

  const xProvenance = (xView.showXProvenance || xView.xSnapshotEdited) ? <XProvenanceSection data={data} view={xView} /> : null;
  const sourceUrlField = (data.kind === 'link' || data.kind === 'image' || isVideo) ? <SourceUrlField
    data={data}
    sourceUrl={sourceUrl}
    urlInput={urlInput}
    setUrlInput={setUrlInput}
    urlError={urlError}
    setUrlError={setUrlError}
    importBusy={importBusy}
    patch={patch}
  /> : null;
  const tagsField = <TagsField tags={data.tags} tagsInput={tagsInput} setTagsInput={setTagsInput} patch={patch} />;

  return <InspectorShellContext.Provider value={shellContext}><aside
    ref={asideRef}
    className={shellClassName}
    data-layout={layout}
    data-kind={data.kind}
    data-paper={data.kind === 'draft' ? 'manuscript' : data.kind === 'note' && !data.tags?.includes('文字资料') ? 'note' : 'plain'}
    style={{ '--inspector-w': `${panelWidth}px` } as CSSProperties}
    aria-label={`${kindDisplayName(data)}编辑面板`}
    // Clicks on blank panel areas keep keyboard focus inside the panel, so its key routing still applies.
    tabIndex={-1}
    // Typing must never trigger canvas shortcuts; IME composition never closes the panel (contract D16).
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) { event.stopPropagation(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase()) && !target?.closest('input, textarea, [contenteditable="true"]')) return;
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); handleEscape(event.target); }
    }}
    onPointerDown={event => event.stopPropagation()}
    // Narrow windows show the docked panel over the canvas with a scrim (its ::before); a click there closes it.
    onClick={event => { if (slot === 'pinned' || layout !== 'docked' || event.target !== event.currentTarget || event.clientX >= event.currentTarget.getBoundingClientRect().left) return; closeInspector(); }}
  >
    {layout === 'docked' && <div
      className="inspector-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整面板宽度"
      aria-valuemin={PANEL_WIDTH.min}
      aria-valuemax={PANEL_WIDTH.max}
      aria-valuenow={panelWidth}
      title="拖动调整宽度，双击恢复默认"
      tabIndex={0}
      onPointerDown={startResize}
      onPointerMove={moveResize}
      onPointerUp={endResize}
      onPointerCancel={endResize}
      onLostPointerCapture={endResize}
      onDoubleClick={() => commitPanelWidth(PANEL_WIDTH.default)}
      onKeyDown={resizeWithKeys}
    />}
    {/* The transcript sits after the player's two dozen controls in Tab order: one stop takes the keyboard there (INSP-12). */}
    {isVideo && transcript.length > 0 && <button type="button" className="watch-skip" onClick={() => {
      asideRef.current?.querySelector<HTMLElement>('.inspector-transcript-section .watch-line__text[tabindex="0"]')?.focus();
    }}>跳到逐字稿</button>}
    <InspectorHeader
      nodeId={node.id}
      kind={data.kind}
      data={data}
      layout={layout}
      title={headerTitle}
      meta={headerMeta}
      writingExpanded={writingExpanded}
      readingExpanded={readingExpanded}
      onToggleWriting={toggleWritingWidth}
      onToggleReading={toggleReadingWidth}
      onFindOnCanvas={findOnCanvas}
      onClose={closeInspector}
      metaSlotRef={slotRefs['header-meta']}
      actionsSlotRef={slotRefs['header-actions']}
    />
    {/* The workbench covers the top bar and the canvas banner: a failed save is named here until it goes through (FD-02). */}
    {isVideo && <SaveRecoveryNotice />}
    {isVideo ? <div ref={scrollRef} className="inspector-scroll inspector-workbench">
      {/* Left column: player, timeline, provenance and the card's own fields (§6.18.2). */}
      <div className="inspector-stage">
        {xProvenance}
        <VideoMediaPanel
          nodeId={node.id}
          data={data}
          videoUrl={videoUrl}
          sourceUrl={sourceUrl}
          nativeMediaUrl={nativeMediaUrl}
          canPlay={canPlay}
          playerRef={bindPlayer}
          currentTime={currentTime}
          setCurrentTime={setCurrentTime}
          mediaError={mediaError}
          setMediaError={setMediaError}
          mediaStatus={mediaStatus}
          mediaLoading={mediaLoading}
          mediaUnavailable={mediaUnavailable}
          importBusy={importBusy}
          retryMedia={retryMedia}
          patch={patch}
          onNotify={onNotify}
        />
        {xView.xPostIdentity && <XPostSection
          nodeId={node.id}
          view={xView}
          xPostExpanded={xPostExpanded}
          onExpand={() => setXPostExpanded(true)}
          rememberVisit={rememberVisit}
        />}
        <VideoProcessingStatus
          nodeId={node.id}
          data={data}
          transcript={transcript}
          videoUrl={videoUrl}
          importBusy={importBusy}
          canRetryImport={canRetryImport}
          importActionPending={importActionPending}
          nativeTranscribeBusy={nativeTranscribeBusy}
        />
        <VideoNotesSection nodeId={node.id} data={data} patch={patch} />
        {sourceUrlField}
        {tagsField}
      </div>
      {/* Right column: the transcript and its selection footer (§6.18.2). */}
      <div className="inspector-side">
        <TranscriptPanel
          nodeId={node.id}
          data={data}
          transcript={transcript}
          query={query}
          setQuery={setQuery}
          selectedLines={selectedLines}
          setSelectedLines={setSelectedLines}
          lastSelected={lastSelected}
          setLastSelected={setLastSelected}
          currentTime={currentTime}
          setCurrentTime={setCurrentTime}
          videoUrl={videoUrl}
          mediaError={mediaError}
          transcriptBusy={transcriptBusy}
          transcriptProcessing={transcriptProcessing}
          canRetryImport={canRetryImport}
          exporting={exporting}
          setExporting={setExporting}
          onNativeTranscribe={onNativeTranscribe}
          runNativeTranscribe={runNativeTranscribe}
          onImportSubtitles={onImportSubtitles}
          setReplaceAction={setReplaceAction}
          setEditingLine={setEditingLine}
          onNotify={onNotify}
        />
        {!!transcript.length && <TranscriptExcerptFooter
          nodeId={node.id}
          transcript={transcript}
          selectedLines={selectedLines}
          setSelectedLines={setSelectedLines}
          setLastSelected={setLastSelected}
        />}
      </div>
    </div> : <div ref={scrollRef} className="inspector-scroll">
      {/* One tree for docked, reading and writing so editors never remount when the layout changes. */}
      <div className="inspector-layout">
        <div ref={slotRefs.lead} className="inspector-slot inspector-slot--lead" />
        <div className="inspector-column">
          {bodyTitle}
          {xProvenance}

          {data.kind === 'image' && <ImageSourcePanel
            data={data}
            imageUrl={imageUrl}
            imageSize={imageSize}
            setImageSize={setImageSize}
            mediaError={mediaError}
            setMediaError={setMediaError}
            mediaStatus={mediaStatus}
            mediaLoading={mediaLoading}
            mediaUnavailable={mediaUnavailable}
            retryMedia={retryMedia}
            onOpen={() => setShowImage(true)}
          />}

          {data.kind === 'quote' && <QuoteCitationPanel nodeId={node.id} data={data} rememberVisit={rememberVisit} />}

          {isDraft ? <DraftWritingSection
            key={node.id}
            nodeId={node.id}
            data={data}
            editorRef={editorRef}
            normalizedBody={normalizedBody}
            patch={patch}
            onNotify={onNotify}
            showReferences={showReferences}
            setShowReferences={setShowReferences}
            showVersions={showVersions}
            setShowVersions={setShowVersions}
            openDraftSource={openDraftSource}
          /> : isTextSource ? <TextSourceSection
            nodeId={node.id}
            textSelection={textSelection}
            data={data}
            editorRef={editorRef}
            normalizedBody={normalizedBody}
            reading={reading}
            setReading={setReading}
            changeReadingMode={changeReadingMode}
            setTextSelection={setTextSelection}
            patch={patch}
            sourceReveal={sourceReveal}
            setSourceReveal={setSourceReveal}
            sourceLocation={sourceLocation}
            sourceRange={sourceRange}
            revealCitation={revealCitation}
            chosenSourceMatch={chosenSourceMatch}
            setChosenSourceMatch={setChosenSourceMatch}
          /> : <CardBodySection nodeId={node.id} data={data} editorRef={editorRef} patch={patch} />}

          {sourceUrlField}

          {tagsField}
        </div>
        <div ref={slotRefs.margin} className="inspector-slot inspector-slot--margin" />
      </div>
    </div>}
    {isDraft && <DraftExportFooter node={node} exporting={exporting} setExporting={setExporting} onNotify={onNotify} />}
    {isTextSource && <TextExcerptFooter nodeId={node.id} data={data} normalizedBody={normalizedBody} textSelection={textSelection} setTextSelection={setTextSelection} />}
    {showImage && imageUrl && <ImagePreviewDialog src={imageUrl} title={data.title} initialSize={imageSize} onClose={() => setShowImage(false)} />}
    {editingLine && <TranscriptCorrectionDialog
      key={`${editingLine.nodeId}:${editingLine.line.id}`}
      line={editingLine.line}
      excerpted={lineExcerpted(editingLine.line)}
      busy={transcriptBusy}
      onSave={saveCorrection}
      onCancel={() => setEditingLine(null)}
      onDirtyChange={dirty => board.setPendingTranscriptEdit(`${editingLine.nodeId}:${editingLine.line.id}`, dirty)}
    />}
    {replaceAction && <ReplaceTranscriptDialog
      action={replaceAction}
      busy={transcriptBusy}
      onCancel={() => setReplaceAction(null)}
      onConfirm={confirmReplacement}
    />}
  </aside></InspectorShellContext.Provider>;
}
