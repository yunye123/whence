import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { BookOpen, Captions, CircleAlert, Film, LoaderCircle, Play, RotateCcw, ScrollText } from 'lucide-react';
import { timecode, type TranscriptLine, type VideoImportState } from '../model';
import { getSourceUrl } from '../media-source';
import { timeRangeLabel } from '../source-location';
import { formatCount, importStateLabels, isImportPending, isImportStopped, platformLabel, webLink } from './card-utils';
import { getZoomTier, subscribeZoomTier, useCanvasLod } from '../canvas/lod';
import { canMeasureText, measureTextLines, type TextOptions } from './text-measure';
import { Words } from './Words';
import { CardHandle } from './CardShell';
import { CardPlayer } from './CardPlayer';
import { MediaProblem, mediaProblem, mediaProblemKind } from './MediaProblem';
import type { CardBodyProps, CardMedia, ExcerptMark } from './types';

interface VideoCardBodyProps extends CardBodyProps {
  media: CardMedia;
  activeVideo: boolean;
  playable: boolean;
  bindPlayer: (player: HTMLVideoElement | null) => void;
  capturePlayer: (player: HTMLVideoElement) => void;
  beginPlayback: () => void;
  marks: readonly ExcerptMark[];
  connectable: boolean;
  /** The poster's or the playing film's own width / height (CanvasCard clamps, caches and decides). */
  onRatio: (ratio: number, from: 'poster' | 'film') => void;
  playing: boolean;
}

/** Duration chip text: mm:ss, or H:MM:SS from one hour (PV-m1). */
const durationLabel = (seconds: number) => timeRangeLabel(seconds) ?? timecode(seconds);

/** Time geometry is proportional to the film, never to sentence count. One band per valid excerpt. */
export function videoExcerptBands(duration: number, marks: readonly ExcerptMark[]) {
  if (!(duration > 0)) return [];
  return marks.flatMap((mark, index) => {
    if (!Number.isFinite(mark.start) || !Number.isFinite(mark.end) || mark.end! <= mark.start!) return [];
    const left = Math.max(0, Math.min(duration, mark.start!));
    const right = Math.max(left, Math.min(duration, mark.end!));
    if (right <= left) return [];
    return [{ key: `${mark.quoteId ?? index}-${index}`, quoteId: mark.quoteId, left: left / duration * 100, width: (right - left) / duration * 100 }];
  });
}

export type VideoPreviewRow = { kind: 'line'; index: number; line: TranscriptLine; quoteIds: string[]; lines: number }
  | { kind: 'gap'; from: number; to: number; start: number; end: number; count: number };

/** Whole original sentences only; gaps also spend a line. No canvas in SSR means deferred planning. */
export function planVideoTranscript(transcript: readonly TranscriptLine[], marks: readonly ExcerptMark[], options: TextOptions, context = true, maxLines = 6): VideoPreviewRow[] {
  if (!transcript.length || !marks.length || !canMeasureText()) return [];
  const quoteIds = transcript.map(line => marks.filter(mark => mark.quoteId && mark.start !== undefined && mark.end !== undefined
    && line.end > mark.start && line.start < mark.end).map(mark => mark.quoteId!));
  const selected = new Map<number, number>();
  const rows = (): VideoPreviewRow[] => {
    const result: VideoPreviewRow[] = [];
    let from = 0;
    for (const [index, lines] of [...selected].sort(([a], [b]) => a - b)) {
      if (index > from) result.push({ kind: 'gap', from, to: index, start: transcript[from].start, end: transcript[index - 1].end, count: index - from });
      result.push({ kind: 'line', index, line: transcript[index], quoteIds: quoteIds[index], lines });
      from = index + 1;
    }
    if (from < transcript.length) result.push({ kind: 'gap', from, to: transcript.length, start: transcript[from].start, end: transcript.at(-1)!.end, count: transcript.length - from });
    return result;
  };
  const accept = (index: number) => {
    if (index < 0 || index >= transcript.length || selected.has(index)) return;
    const lines = Math.max(1, measureTextLines(transcript[index].text, options).length);
    selected.set(index, lines);
    if (rows().reduce((sum, row) => sum + (row.kind === 'line' ? row.lines : 1), 0) > maxLines) selected.delete(index);
  };
  quoteIds.forEach((ids, index) => { if (ids.length) accept(index); });
  if (context) for (const index of [...selected.keys()]) { accept(index - 1); accept(index + 1); }
  return selected.size ? rows() : [{ kind: 'gap', from: 0, to: transcript.length, start: transcript[0].start, end: transcript.at(-1)!.end, count: transcript.length }];
}

/** Resolve the font token, not element geometry. Font arrival re-plans against the shared invalidated LRU. */
function useVideoTextPlan() {
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setFontRevision(value => value + 1);
    document.fonts?.addEventListener('loadingdone', refresh);
    return () => document.fonts?.removeEventListener('loadingdone', refresh);
  }, []);
  const fontFamily = useMemo(() => typeof document === 'undefined' ? 'sans-serif' : getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif', [fontRevision]);
  return { fontFamily, fontRevision };
}

/**
 * Video card (§6.9): the poster bleeds to the card edges at the film's own ratio with the play glyph
 * (the one control a resting card shows, P1) and the duration. The ruler paints one band per excerpt;
 * the archive strip includes the bounded original transcript preview and provenance.
 */
export function VideoCardBody(props: VideoCardBodyProps) {
  const { id, data, board, activate, openCard, media, activeVideo, playable, bindPlayer, capturePlayer, beginPlayback, marks, connectable, onRatio, playing } = props;
  const { source, poster, mediaError, loadingMedia, unavailableMedia, setMediaError, setPosterError } = media;
  const importTask = data.videoImport;
  const importPending = isImportPending(importTask);
  const importStopped = isImportStopped(importTask);
  const lod = useCanvasLod();
  const tier = useSyncExternalStore(subscribeZoomTier, getZoomTier, () => 1);
  const { fontFamily, fontRevision } = useVideoTextPlan();
  const duration = Math.max(data.duration ?? 0, data.transcript?.at(-1)?.end ?? 0, ...marks.map(mark => mark.end ?? 0));
  const bands = useMemo(() => videoExcerptBands(duration, marks), [duration, marks]);
  // The default source card width is 290px (board-utils); no mount-time geometry read.
  const textScale = lod === 'simple' ? 1 / tier : 1;
  // Fixed columns reserve the compensated clock's ink width at full-tier minimum, including hours.
  const timeColumn = duration >= 3600 ? (textScale === 1 ? 60 : 52) : (textScale === 1 ? 42 : 36);
  const textWidth = Math.max(1, ((props.previewWidth ?? 290) - 16) / textScale - timeColumn - 6);
  const textOptions = useMemo<TextOptions>(() => ({ font: `400 14px ${fontFamily}`, width: textWidth, mode: 'word', minRun: 3, whiteSpace: 'pre-wrap', letterSpacing: 0, wordSpacing: 0 }), [fontFamily, textWidth]);
  // The hidden full face keeps its natural box in far tier; removing its rows would shrink the node.
  const rows = useMemo(() => importStopped ? [] : planVideoTranscript(data.transcript ?? [], marks, textOptions, lod !== 'simple'), [data.transcript, marks, textOptions, importStopped, lod, fontRevision]);
  const nonPlayableDemo = !!data.demo && !playable && !importTask;
  // Missing, unreadable or undecodable, said once with the one useful action (CORE-08).
  const problem = unavailableMedia || mediaError ? mediaProblemKind(mediaError, data.mediaId ? board.getMediaStatus?.(data.mediaId) : undefined) ?? 'undecodable' : undefined;
  const problemCopy = problem && mediaProblem('video', problem, id, data, board, openCard, () => setMediaError(false));
  const [nowTime, setNowTime] = useState<number>();
  const currentTime = activeVideo ? nowTime ?? board.getVideoPlayback(id).time : undefined;

  return (
    <>
      <div className={`field-card__video card-drag-content${poster ? ' has-poster' : ''}`}>
        {activeVideo && !mediaError ? (
          <CardPlayer
            title={data.title}
            source={source}
            poster={poster}
            storedDuration={data.duration}
            initialTime={board.getVideoPlayback(id).time}
            activate={activate}
            bindPlayer={bindPlayer}
            capturePlayer={capturePlayer}
            onMetadata={player => {
              if (player.videoWidth && player.videoHeight) onRatio(player.videoWidth / player.videoHeight, 'film');
              board.restoreVideoPlayback(id, 'canvas', player);
              capturePlayer(player);
            }}
            onError={() => {
              setMediaError(true);
              board.playVideo(null);
            }}
            onClock={clock => setNowTime(clock.time)}
            playing={playing}
          />
        ) : (
          <div className="field-card__poster-button card-drag-content">
            {poster ? (
              <img
                src={poster}
                alt=""
                draggable={false}
                onLoad={event => {
                  const image = event.currentTarget;
                  if (image.naturalWidth && image.naturalHeight) onRatio(image.naturalWidth / image.naturalHeight, 'poster');
                }}
                onError={() => setPosterError(true)}
              />
            ) : (
              <VideoPlaceholder
                data={data}
                source={source}
                mediaError={mediaError}
                loadingMedia={loadingMedia}
                unavailableMedia={unavailableMedia}
                importTask={importTask}
                mediaStateMessage={media.mediaStateMessage}
              />
            )}
            {playable ? (
              <button
                className="field-card__play nodrag nowheel"
                onClick={event => activate(event, beginPlayback)}
                aria-label={`播放：${data.title}`}
                title="播放"
              >
                <Play size={13} fill="currentColor" strokeWidth={0} />
              </button>
            ) : nonPlayableDemo ? (
              <button
                className="field-card__play nodrag nowheel"
                onClick={event => activate(event, openCard)}
                aria-label={`阅读示例：${data.title}`}
                title="阅读示例"
              >
                <BookOpen size={13} strokeWidth={2} />
              </button>
            ) : null}
            {!!data.duration && !importPending && <span className="field-card__duration">{durationLabel(data.duration)}</span>}
          </div>
        )}
        {importTask && !importStopped && (
          <VideoImportBlock id={id} data={data} board={board} activate={activate} openCard={openCard} importTask={importTask} />
        )}
        {!source && !loadingMedia && !unavailableMedia && !importTask && !data.demo && (
          <button
            className="field-card__media-cta nodrag nowheel"
            onClick={event => activate(event, openCard)}
            aria-label="打开并添加视频"
          >
            添加视频
          </button>
        )}
      </div>
      <div className="field-card__ruler card-drag-content">
        <time aria-hidden="true">00:00</time>
        <div className="field-card__rail" style={{ '--ruler-step': `${duration > 0 ? Math.min(100, 1000 / duration) : 100}%` } as CSSProperties}>
          {bands.map(band => <span key={band.key} className="field-card__rail-band is-marked" data-quote-id={band.quoteId} style={{ left: `${band.left}%`, width: `${band.width}%` }} aria-hidden="true" />)}
          {currentTime !== undefined && duration > 0 && <span className="field-card__rail-head is-current" style={{ left: `${Math.max(0, Math.min(100, currentTime / duration * 100))}%` }} aria-hidden="true" />}
        <CardHandle type="source" connectable={connectable} />
        </div>
        <time aria-hidden="true">{durationLabel(duration)}</time>
      </div>
      {problemCopy && !importTask && <MediaProblem message={problemCopy.message} detail={problemCopy.detail} action={problemCopy.action} activate={activate} />}
      {importTask && importStopped && <VideoImportBlock id={id} data={data} board={board} activate={activate} openCard={openCard} importTask={importTask} />}
      {!problemCopy && rows.length > 0 && <div className="field-card__transcript" style={{ '--transcript-time': `${timeColumn}px` } as CSSProperties}><div className="field-card__transcript-lines">
        {rows.map(row => row.kind === 'gap'
          ? <div key={`gap-${row.from}`} className="field-card__transcript-gap">… {durationLabel(row.start)}–{durationLabel(row.end)} · {formatCount(row.count)} 句</div>
          : <button key={row.index} type="button" className="field-card__line card-drag-content nodrag nowheel nopan" tabIndex={-1} title={`跳转至 ${timecode(row.line.start)}`} aria-label={`${durationLabel(row.line.start)} ${row.line.text}`} onClick={event => {
            // A completed native text selection is a copy gesture; a plain click still jumps to this line.
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed && selection.containsNode(event.currentTarget, true)) {
              event.stopPropagation();
              return;
            }
            activate(event, () => board.playVideo(id, row.line.start));
          }}>
            <span className="field-card__line-play" aria-hidden="true" />
            <time>{durationLabel(row.line.start)}</time>
            {row.quoteIds.length ? <mark data-quote-id={row.quoteIds[0]} data-edge-anchor="excerpt-row"><Words text={row.line.text} minRun={3} {...textOptions} />{row.quoteIds.slice(1).map(quoteId => <span key={quoteId} data-quote-id={quoteId} data-edge-anchor="excerpt-row" className="field-card__line-anchor" />)}</mark> : <Words text={row.line.text} minRun={3} {...textOptions} />}
          </button>)}
      </div></div>}
      <VideoArchive {...props} platform={platformLabel(data, !!data.demo)} mediaMissing={!!problemCopy} />
    </>
  );
}

interface VideoPlaceholderProps {
  data: CardBodyProps['data'];
  source?: string;
  mediaError: boolean;
  loadingMedia: boolean;
  unavailableMedia: boolean;
  importTask?: VideoImportState;
  mediaStateMessage: string;
}

/** Canvas-coloured stand-in for a film without a poster. It says nothing a status line already says. */
function VideoPlaceholder({ data, source, mediaError, loadingMedia, unavailableMedia, importTask }: VideoPlaceholderProps) {
  if (loadingMedia) return <div className="field-card__media-placeholder"><LoaderCircle size={22} strokeWidth={1.6} className="spin" /></div>;
  if (unavailableMedia || mediaError || isImportStopped(importTask)) return <div className="field-card__media-placeholder" />;
  return (
    <div className="field-card__media-placeholder">
      <Film size={24} strokeWidth={1.5} />
      {!source && !importTask && !data.demo && <span>还没有视频文件</span>}
    </div>
  );
}

/**
 * Link-import task (K3 `card-video-import-{id}`): while it runs, a 2px progress bar on the media edge and
 * a cancel action on hover; when it stopped, one reason and one retry; nothing extra once completed.
 * The status words live once, on the meta line (VideoCardFooter).
 */
function VideoImportBlock({ id, data, board, activate, importTask }: CardBodyProps & { importTask: VideoImportState }) {
  const pending = isImportPending(importTask);
  const stopped = isImportStopped(importTask);
  const importSource = webLink(getSourceUrl(data));
  const actionPending = board.videoImportActionPending(id);
  const progress = importTask.progress;
  const known = pending && progress !== undefined && Number.isFinite(progress);

  return (
    <div className={`field-card__import nodrag nowheel is-${importTask.status}`} data-testid={`card-video-import-${id}`}>
      {pending && (
        <>
          <div
            className={`field-card__progress${known ? '' : ' is-indeterminate'}`}
            role="progressbar"
            aria-label={`${data.title} 导入进度`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={known ? Math.round(progress!) : undefined}
          >
            <span style={known ? { width: `${Math.max(2, Math.min(100, progress!))}%` } : undefined} />
          </div>
          <div className="field-card__import-actions">
            <button
              className="field-card__btn"
              disabled={board.readOnly || actionPending}
              onClick={event => activate(event, () => board.cancelVideoImport(id))}
              aria-label={`取消视频导入：${data.title}`}
              title={board.readOnly ? '当前窗口只读' : undefined}
            >
              {actionPending ? '正在取消…' : '取消'}
            </button>
          </div>
        </>
      )}
      {stopped && (
        <div className="field-card__problem" role="status">
          <span className="field-card__problem-text" title={importTask.error || importTask.message}>
            <CircleAlert size={14} aria-hidden="true" />
            <span>{importTask.error || importTask.message || '链接打不开。检查网络后重试，或改用本机文件。'}</span>
          </span>
          <span className="field-card__problem-actions">
            <button
              className="field-card__btn"
              disabled={board.readOnly || actionPending || !board.videoImportAvailable}
              title={board.readOnly ? '当前窗口只读' : board.videoImportAvailable ? undefined : '需要桌面版'}
              onClick={event => activate(event, () => board.retryVideoImport(id))}
              aria-label={`重试视频导入：${data.title}`}
            >
              <RotateCcw size={13} aria-hidden="true" />
              {actionPending ? '正在重试…' : importTask.mediaReady ? '继续提取逐字稿' : '重试'}
            </button>
            {!board.videoImportAvailable && <span className="field-card__why">需要桌面版</span>}
            {importSource && board.videoImportAvailable && (
              <a className="field-card__quiet-link" href={importSource.href} target="_blank" rel="noopener noreferrer">原始来源</a>
            )}
          </span>
        </div>
      )}
      {importTask.status === 'completed' && <span className="sr-only" role="status">视频导入已完成</span>}
      {importTask.status === 'cancelled' && <span className="sr-only" role="status">视频导入已取消</span>}
    </div>
  );
}

interface VideoCardFooterProps extends CardBodyProps {
  platform: string;
  activeVideo: boolean;
  playing: boolean;
  currentTime: number;
  playable: boolean;
  mediaMissing: boolean;
}

/**
 * The title row's single status slot: playback, import, stopped import, transcription, count or empty.
 * Provenance and the existing transcription next step belong to the archive row below the ruler.
 */
export function VideoCardFooter({ id, data, board, activate, activeVideo, playing, currentTime }: VideoCardFooterProps) {
  const task = data.videoImport;
  const lines = data.transcript?.length ?? 0;
  const message = board.transcriptionMessage?.(id);

  if (activeVideo) {
    // “播放中” is said once, by the chip on the picture (§6.8); the meta line only keeps the time. Paused has
    // no chip, so the line says so — without the light dot, which belongs to “now” (CANVAS-13).
    return (
      <span className="field-card__status-slot" data-video-status="playback">
        <span className="field-card__meta-state is-live">
          {playing ? <span className="sr-only">播放中 </span> : '已暂停 '}
          <span className="tabular">{timecode(currentTime)}</span>
        </span>
        <button className="field-card__text-btn nodrag nowheel" onClick={event => activate(event, () => board.playVideo(null))} aria-label="收起视频">收起视频</button>
      </span>
    );
  }
  if (task && isImportPending(task)) {
    const progress = task.progress !== undefined && Number.isFinite(task.progress) ? ` ${Math.round(task.progress)}%` : '';
    const label = task.status === 'transcribing' && lines ? `转写中 ${formatCount(lines)} 句` : `${importStateLabels[task.status]}${progress}`;
    return <span className="field-card__status-slot" data-video-status="import"><span className="field-card__meta-state" role="status"><LoaderCircle size={12} className="spin" aria-hidden="true" />{label}</span></span>;
  }
  if (task && isImportStopped(task)) return <span className="field-card__status-slot" data-video-status="stopped"><span className="field-card__meta-state is-danger"><CircleAlert size={12} aria-hidden="true" />{importStateLabels[task.status]}</span></span>;
  if (message) {
    return (
      <span className="field-card__status-slot" data-video-status="transcription"><span className="field-card__meta-state" role="status"><LoaderCircle size={12} className="spin" aria-hidden="true" />{message}</span></span>
    );
  }
  if (lines) {
    return (
      <span className="field-card__status-slot" data-video-status="transcript"><span className="field-card__meta-state">逐字稿 {formatCount(lines)} 句</span></span>
    );
  }
  return <span className="field-card__status-slot" data-video-status="empty" />;
}

/** The archive owns provenance/date and the existing next-step action; the header slot only owns state. */
function VideoArchive({ id, data, board, activate, openCard, platform, mediaMissing }: CardBodyProps & { platform: string; mediaMissing: boolean }) {
  const lines = data.transcript?.length ?? 0;
  const date = typeof data.collectedAt === 'string' && /^\d{4}-\d{2}-\d{2}/u.test(data.collectedAt) ? data.collectedAt.slice(0, 10) : undefined;
  const first = data.body.split(/\r\n|[\r\n]/u).find(line => line.trim());
  const nextStep = !lines && !mediaMissing && !board.transcriptionMessage?.(id) && !isImportPending(data.videoImport) && !isImportStopped(data.videoImport) && !!(data.mediaId || data.url || data.nativeAssetId);
  // No transcript yet: the next step, once (PV-M3). The desktop app can transcribe on this machine.
  return (
    <div className="field-card__archive card-drag-content">
      <span className="field-card__meta-source" title={first || platform}>{first || platform}</span>
      {nextStep && <span className="field-card__transcribe nodrag nowheel">
        {board.nativeTranscribeAvailable && !board.readOnly && data.nativeHasAudio !== false ? (
          <button
            className="field-card__btn field-card__btn--sm"
            onClick={event => activate(event, () => board.transcribeVideo?.(id))}
            aria-label={`生成逐字稿：${data.title}`}
          >
            <ScrollText size={13} aria-hidden="true" />生成逐字稿
          </button>
        ) : (
          <button
            className="field-card__btn field-card__btn--sm"
            onClick={event => activate(event, openCard)}
            aria-label={`导入字幕：${data.title}`}
            title={board.readOnly ? '当前窗口只读' : data.nativeHasAudio === false ? '这条视频没有音轨，不能转写；可以导入它的 SRT / VTT 字幕' : '在面板里导入 SRT / VTT 字幕'}
          >
            {/* FD-07: a film known to have no audio track offers its subtitles instead of a transcription that fails. */}
            <Captions size={13} aria-hidden="true" />{data.nativeHasAudio === false ? '无音轨 · 导入字幕' : '导入字幕'}
          </button>
        )}
      </span>}
      {date && <time dateTime={data.collectedAt}>{date}</time>}
    </div>
  );
}

/** Hover action: open the transcript (“查看逐字稿：<标题>”, like every other card action, CANVAS-17). */
export function VideoCardActions({ data, activate, openCard }: CardBodyProps) {
  if (!data.transcript?.length) return null;
  return (
    <button className="field-card__chip nodrag nowheel" onClick={event => activate(event, openCard)} aria-label={`查看逐字稿：${data.title}`} title="查看逐字稿">
      <ScrollText size={14} aria-hidden="true" />
    </button>
  );
}

/** “导入未完成：<原标题>” while a stopped import owns the card (IM-M2). */
export function videoTitle(data: CardBodyProps['data']) {
  const title = data.title || '未命名';
  return isImportStopped(data.videoImport) ? `导入未完成：${title}` : title;
}
