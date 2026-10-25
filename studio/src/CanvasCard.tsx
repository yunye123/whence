import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import { useCard } from './board-context';
import type { CardData } from './model';
import { canActivateCard, canKeepNoteEditing } from './card-interaction';
import { isSampleAsset } from './templates';
import { getCardBounds } from './card-placement';
import { CardShell } from './cards/CardShell';
import { CardOverview } from './cards/CardOverview';
import { VideoCardActions, VideoCardBody, VideoCardFooter, videoTitle } from './cards/VideoCardBody';
import { ImageCardBody } from './cards/ImageCardBody';
import { NoteCardActions, NoteCardBody } from './cards/NoteCardBody';
import { ArticleCardActions, ArticleCardBody, ArticleCardFooter } from './cards/ArticleCardBody';
import { QuoteCardBody, QuoteCardFooter, QuoteSource, QuoteTag } from './cards/QuoteCardBody';
import { DraftCardActions, DraftCardBody, DraftCardMeta, useDraftFontVersion } from './cards/DraftCardBody';
import { LinkCardActions, LinkCardBody, LinkCardFooter } from './cards/LinkCardBody';
import { FrameCardBody, FrameCount, TrayGlyph } from './cards/FrameCardBody';
import { excerptDisplayTitle, hasNoteTitle, isImportPending, isImportStopped, isLatinText, isTextSource, kindDisplayName, platformLabel } from './cards/card-utils';
import { cardExtras, type CardBodyProps, type CardLod, type CardMedia, type ExcerptMark } from './cards/types';
import { useCanvasLod } from './canvas/lod';
import { isLocalVideoSource, knownMediaRatio, probeVideoRatio, rememberMediaRatio } from './cards/media-ratio';
import { firstCardPicture } from './pictures';

const NO_MARKS: readonly ExcerptMark[] = [];

/**
 * The single React Flow node renderer. Owns per-card state (menu, note editing, media errors, playback)
 * and composes CardShell (material, header, actions, footer) with one kind body from `./cards`.
 */
function CanvasCardView({ id, data, selected, width }: NodeProps<Node<CardData>>) {
  const board = useCard();
  const flow = useReactFlow<Node<CardData>>();
  const extras = cardExtras(board);
  // Subscribe to one enum, never the continuously changing viewport or all nodes (K9-7, §6.16).
  const lod: CardLod = useCanvasLod();
  const draftFontVersion = useDraftFontVersion(data.kind === 'draft');
  const overview = lod === 'far';
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [posterError, setPosterError] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => board.getVideoPlayback(id).time);
  const [playing, setPlaying] = useState(false);
  // A film's ratio is known per media for the session (FV-M1): a remounted or duplicated card starts at it.
  const mediaKey = data.kind === 'video' ? data.mediaId || data.url || data.poster : undefined;
  const [mediaRatio, setMediaRatio] = useState<number | undefined>(() => knownMediaRatio(mediaKey));
  const videoRef = useRef<HTMLVideoElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const isFrame = data.kind === 'frame';
  const article = isTextSource(data);
  const source = board.getMediaUrl(data.mediaId) || data.url;
  const cachedMediaStatus = data.mediaId ? board.getMediaStatus?.(data.mediaId) : undefined;
  // A usable native/remote URL remains a source even when its optional cache is absent.
  const unavailableMedia = !source && (cachedMediaStatus === 'missing' || cachedMediaStatus === 'error');
  const loadingMedia = !source && cachedMediaStatus === 'loading';
  const poster = !posterError ? data.poster : undefined;
  // Example films shipped under /assets/samples/ play like any local film; older demo cards only open details.
  const sampleVideo = data.kind === 'video' && isSampleAsset(data.url);
  const playableKind = data.kind === 'video' && (!data.demo || sampleVideo);
  const activeVideo = playableKind && !!source && board.activeVideo === id && board.inspectedId !== id;
  const playable = playableKind && !!source && !mediaError && !isImportPending(data.videoImport);
  const tone = data.tone || (data.kind === 'note' ? 'butter' : data.kind === 'quote' ? 'mint' : 'paper');
  const editable = !board.readOnly && board.tool !== 'hand';
  const hand = board.tool === 'hand';
  const mediaStateMessage = cachedMediaStatus === 'missing' ? '媒体文件未找到' : '媒体读取失败';
  const media: CardMedia = {
    source, poster, mediaError, loadingMedia, unavailableMedia, mediaStateMessage, setMediaError, setPosterError,
  };

  useEffect(() => { setMediaError(false); setPosterError(false); }, [source, data.poster]);
  useEffect(() => { setMediaRatio(knownMediaRatio(mediaKey)); }, [mediaKey]);
  /**
   * The poster sets the card's ratio; the playing film only fills in a ratio nobody knew yet, so playback inside
   * the card never changes its height once the ratio is known (FV-M1).
   */
  const learnRatio = useCallback((ratio: number, from: 'poster' | 'film') => {
    setMediaRatio(current => (from === 'film' && current ? current : rememberMediaRatio(mediaKey, ratio) ?? current));
  }, [mediaKey]);
  // A local film without a (working) poster reads its ratio at rest, before anyone plays it.
  const probeSource = data.kind === 'video' && !mediaRatio && !poster && !mediaError && !activeVideo
    && !isImportPending(data.videoImport) && isLocalVideoSource(source) ? source : undefined;
  useEffect(() => {
    if (!probeSource || !mediaKey) return;
    let alive = true;
    void probeVideoRatio(mediaKey, probeSource).then(ratio => { if (alive && ratio) setMediaRatio(current => current ?? ratio); });
    return () => { alive = false; };
  }, [probeSource, mediaKey]);
  useEffect(() => { if (overview || hand) setMenuOpen(false); }, [overview, hand]);
  useEffect(() => {
    if (!canKeepNoteEditing(selected, board.readOnly, board.tool, overview)) setNoteEditing(false);
  }, [selected, board.readOnly, board.tool, overview]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as globalThis.Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const bindPlayer = useCallback((player: HTMLVideoElement | null) => {
    videoRef.current = player;
    board.bindVideoPlayer(id, 'canvas', player);
  }, [id, source, board.bindVideoPlayer]);
  const capturePlayer = (player: HTMLVideoElement) => {
    board.captureVideoPlayback(id, 'canvas', player);
    setCurrentTime(Math.floor(player.currentTime));
    setPlaying(!player.paused);
  };
  useEffect(() => {
    const player = videoRef.current;
    if (!activeVideo || !player || player.readyState < 1) return;
    board.restoreVideoPlayback(id, 'canvas', player);
    setCurrentTime(Math.floor(player.currentTime));
    setPlaying(!player.paused);
  }, [activeVideo, board.videoPlaybackVersion, board.restoreVideoPlayback, id, source]);

  // The in-place editor grows with the note (same face and leading as the preview), up to a scroll limit.
  useEffect(() => {
    const note = noteRef.current;
    if (!note) return;
    note.style.height = 'auto';
    note.style.height = `${Math.max(28, Math.min(note.scrollHeight, 480))}px`;
  }, [data.body, data.kind, noteEditing]);

  function openCard() { setMenuOpen(false); board.openCard(id); }
  function activate(event: MouseEvent, action: () => void) {
    if (canActivateCard(board.tool, event) && event.detail < 2) action();
  }
  function beginNoteEditing() {
    if (!editable || overview || article) return;
    setNoteEditing(true);
    requestAnimationFrame(() => noteRef.current?.focus({ preventScroll: true }));
  }
  function finishNoteEditing(restoreFocus = false) {
    const wrapper = noteRef.current?.closest<HTMLElement>('.react-flow__node');
    setNoteEditing(false);
    if (restoreFocus) requestAnimationFrame(() => wrapper?.focus({ preventScroll: true }));
  }
  function beginPlayback() {
    if (!playableKind || !source) { openCard(); return; }
    setMediaError(false);
    board.playVideo(id);
  }

  // React Flow can pass width=0 before its first measurement. Read the already-stored node width
  // synchronously in that case, using the existing geometry defaults. No DOM read or node subscription.
  const hasWidth = typeof width === 'number' && Number.isFinite(width) && width > 0;
  const knownNode = !hasWidth || data.kind === 'draft' || article || data.kind === 'link' ? flow.getNode(id) : undefined;
  // An explicit text-card width is the input; a stale measured width after undo
  // must not replan its automatic height inside the next native observer delivery.
  const authoredTextWidth = (data.kind === 'draft' || article || data.kind === 'link') && typeof knownNode?.style?.width === 'number'
    && Number.isFinite(knownNode.style.width) && knownNode.style.width > 0 ? knownNode.style.width : undefined;
  const previewWidth = authoredTextWidth ?? (hasWidth ? width : knownNode ? getCardBounds({
    id, type: 'card', data, position: knownNode.position,
    style: typeof knownNode.style?.width === 'number' ? { width: knownNode.style.width } : undefined,
  }).width : undefined);
  // Only a stored explicit height constrains text planning. An automatic
  // React Flow measurement is its result and must never feed back into that budget.
  const previewHeight = (data.kind === 'draft' || article || data.kind === 'link') && typeof knownNode?.style?.height === 'number'
    && Number.isFinite(knownNode.style.height) && knownNode.style.height > 0 ? knownNode.style.height : undefined;
  const body: CardBodyProps = { id, data, board, activate, openCard, previewWidth, previewHeight };
  const marks = (data.kind === 'video' || data.kind === 'link' || article) ? extras.excerptMarks?.(id) ?? NO_MARKS : NO_MARKS;
  // W3-B receives the same text marks and connection contract for both folder source kinds.
  const sourceBody = { ...body, marks, connectable: editable && !overview };
  const videoBody = { ...body, transcript: data.transcript, marks };
  const sourceGone = data.kind === 'quote' && !!data.citation && !board.sourceNodeIds.has(data.citation.nodeId);
  const describedById = `card-source-${id}`;
  const noteBody = { ...body, lod, noteEditing, noteRef, beginNoteEditing, finishNoteEditing };

  // Per-kind slots of the shell: title as shown, header extras, hover actions and the one meta line.
  // An untitled draft reads the same on the card, in the list and in the panel (“未命名文稿”).
  let title = data.title || (isFrame ? '未命名分组' : data.kind === 'draft' ? '未命名文稿' : '未命名');
  let titleHidden = false;
  let lead: ReactNode = null, headerExtra: ReactNode = null, actions: ReactNode = null, footer: ReactNode = null;
  switch (data.kind) {
    case 'video':
      title = videoTitle(data);
      actions = <VideoCardActions {...body} />;
      footer = <VideoCardFooter {...body} platform={platformLabel(data, sampleVideo)} activeVideo={activeVideo} playing={playing} currentTime={currentTime} playable={playable} mediaMissing={unavailableMedia || mediaError} />;
      break;
    case 'image':
      footer = <span>{platformLabel(data, isSampleAsset(data.poster) || isSampleAsset(data.url))}</span>;
      break;
    case 'note':
      if (article) {
        actions = <ArticleCardActions {...body} />;
        footer = <ArticleCardFooter {...body} platform={platformLabel(data)} />;
      } else {
        titleHidden = !hasNoteTitle(data);
        actions = <NoteCardActions {...noteBody} />;
      }
      break;
    case 'quote':
      title = excerptDisplayTitle(data);
      titleHidden = true;
      lead = <QuoteTag {...body} />;
      headerExtra = <QuoteSource data={data} describedById={describedById} />;
      footer = <QuoteCardFooter data={data} board={board} />;
      break;
    case 'draft':
      headerExtra = <DraftCardMeta data={data} />;
      actions = <DraftCardActions {...body} />;
      break;
    case 'link':
      actions = <LinkCardActions data={data} />;
      footer = <LinkCardFooter data={data} />;
      break;
    case 'frame':
      headerExtra = <FrameCount count={extras.frameMemberCount?.(id)} />;
      break;
  }

  const states = [
    isImportPending(data.videoImport) && 'is-importing',
    isImportStopped(data.videoImport) && 'is-failed',
    (unavailableMedia || mediaError) && (data.kind === 'video' || data.kind === 'image') && 'is-media-missing',
    sourceGone && 'is-source-gone',
    extras.freshCardIds?.has(id) && 'is-fresh',
    extras.litSourceIds?.has(id) && 'is-lit-source',
  ];

  return (
    <CardShell
      id={id}
      data={data}
      board={board}
      tone={tone}
      selected={selected}
      activeVideo={activeVideo}
      overview={overview}
      lod={lod}
      hand={hand}
      editable={editable}
      noteEditing={noteEditing}
      menuOpen={menuOpen}
      setMenuOpen={setMenuOpen}
      menuRef={menuRef}
      activate={activate}
      openCard={openCard}
      beginNoteEditing={beginNoteEditing}
      kindName={kindDisplayName(data)}
      title={title}
      titleHidden={titleHidden}
      titleLang={data.kind === 'link' && isLatinText(data.title) ? 'en' : undefined}
      variant={article ? 'article' : undefined}
      states={states}
      lead={lead}
      headerExtra={headerExtra}
      actions={actions}
      footer={footer}
      describedBy={data.kind === 'quote' && data.citation ? describedById : undefined}
      bodySourceHandle={data.kind === 'video' || article || data.kind === 'link'}
      icon={isFrame ? <TrayGlyph /> : undefined}
      style={data.kind === 'video' && mediaRatio ? { '--media-ratio': String(mediaRatio) } as CSSProperties : undefined}
      contentKey={data.kind === 'video' ? mediaRatio : data.kind === 'draft'
        ? [data.body, previewWidth, previewHeight, draftFontVersion].join('\0') : undefined}
      overviewLayer={overview && <CardOverview id={id} data={data} media={media} title={title} previewWidth={previewWidth} cover={firstCardPicture(data, board.getMediaUrl)} playing={activeVideo && playing} frameCount={isFrame ? extras.frameMemberCount?.(id) : undefined} />}
    >
      {data.kind === 'video' && (
        <VideoCardBody
          {...videoBody}
          media={media}
          activeVideo={activeVideo}
          playable={playable}
          bindPlayer={bindPlayer}
          capturePlayer={capturePlayer}
          beginPlayback={beginPlayback}
          marks={marks}
          connectable={editable && !overview}
          onRatio={learnRatio}
          playing={playing}
        />
      )}
      {data.kind === 'image' && <ImageCardBody {...body} media={media} />}
      {data.kind === 'note' && (article ? <ArticleCardBody {...sourceBody} /> : <NoteCardBody {...noteBody} />)}
      {data.kind === 'quote' && <QuoteCardBody {...body} />}
      {data.kind === 'draft' && <DraftCardBody {...body} />}
      {data.kind === 'link' && <LinkCardBody {...sourceBody} media={media} />}
      {isFrame && <FrameCardBody lod={lod} title={title} count={extras.frameMemberCount?.(id)} />}
    </CardShell>
  );
}

// Position and height belong to the wrapper. Width changes also replan the stationery preview.
const CanvasCard = memo(
  CanvasCardView,
  (previous, next) => previous.id === next.id && previous.data === next.data && previous.selected === next.selected && previous.width === next.width,
);
export const nodeTypes = { card: CanvasCard };
export default CanvasCard;
