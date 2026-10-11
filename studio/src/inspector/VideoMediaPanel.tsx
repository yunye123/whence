import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, KeyboardEvent, PointerEvent as ReactPointerEvent, SetStateAction } from 'react';
import { ArrowUpRight, Captions, CaptionsOff, Film, LoaderCircle, Maximize, Minimize, Pause, Play, RotateCcw, StepBack, StepForward, Volume2, VolumeX } from 'lucide-react';
import type { CardData, TranscriptLine } from '../model';
import { useBoard } from '../board-context';
import ProvenanceTag from '../components/ProvenanceTag';
import { Words } from '../cards/Words';
import { InspectorSlot } from './shared';
import type { MediaStatus, PatchCard } from './shared';
import VideoProvenance from './VideoProvenance';
import VideoFillEmpty from './VideoFillEmpty';
import { chordTitle, withShortcut } from '../dialogs/shortcuts';
import {
  clockLabel, collectedLabel, lineIndexAt, neighbourLine, playheads, publishPlayhead, readCaptionsPreference, usePlayhead, useSelectedLines, videoQuotes, videoRatios,
  watchableVideoUrl, writeCaptionsPreference,
} from './video-watch';
import type { VideoQuote } from './video-watch';

const EMPTY_LINES: TranscriptLine[] = [];
const RATES = [1, 1.25, 1.5, 2, 0.75];

/**
 * Watching workbench, left column (DESIGN_SYSTEM §6.18.2): the player at the film's own shape, the sentence
 * timeline, the transport row and “来历”. The player stays pinned while the rest of the column scrolls (PV-B1),
 * portrait films get their own column instead of a 16:9 letterbox (PV-M2).
 *
 * Playback ownership (K9-15, unchanged): the ref binds through `playerRef`, every media event is forwarded to
 * captureVideoPlayback, loadedmetadata restores first, and every seek or start goes through board.playVideo.
 * The <video> renders only while this card owns playback. Pausing, muting and the playback rate act on the
 * element the way its native controls would; the session captures them from the media events.
 */
export default function VideoMediaPanel({
  nodeId, data, videoUrl: inspectorVideoUrl, sourceUrl, nativeMediaUrl, canPlay, playerRef, currentTime, setCurrentTime,
  mediaError, setMediaError, mediaStatus, mediaLoading, mediaUnavailable, importBusy, retryMedia, patch, onNotify,
}: {
  nodeId: string;
  data: CardData;
  videoUrl?: string;
  sourceUrl?: string;
  nativeMediaUrl?: string;
  canPlay: boolean;
  playerRef: (player: HTMLVideoElement | null) => void;
  currentTime: number;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  mediaError: boolean;
  setMediaError: Dispatch<SetStateAction<boolean>>;
  mediaStatus: MediaStatus;
  mediaLoading: boolean;
  mediaUnavailable: boolean;
  importBusy: boolean;
  retryMedia: () => void;
  patch: PatchCard;
  onNotify: (message: string) => void;
}) {
  const board = useBoard();
  const videoImport = data.videoImport;
  const videoUrl = watchableVideoUrl(inspectorVideoUrl, data);
  const lines = data.transcript ?? EMPTY_LINES;
  const playable = !!videoUrl && !mediaError;
  // No film at all yet (a template slot, a new card): the player itself offers to fill this card (FV-M5).
  const fillable = !videoUrl && !data.mediaId && !nativeMediaUrl && !data.nativeAssetId && !videoImport && !board.readOnly;
  const player = useRef<HTMLVideoElement | null>(null);
  const watchRef = useRef<HTMLElement>(null);

  // ---- The film's own shape (PV-M2): measured from the video, else its poster, remembered for this session.
  const ratioKey = data.mediaId || videoUrl || nodeId;
  const [ratio, setRatio] = useState(() => videoRatios.get(ratioKey) ?? 16 / 9);
  const measureRatio = useCallback((element: HTMLVideoElement) => {
    if (!element.videoWidth || !element.videoHeight) return;
    const natural = element.videoWidth / element.videoHeight;
    videoRatios.set(ratioKey, natural);
    setRatio(natural);
  }, [ratioKey]);
  useEffect(() => { setRatio(videoRatios.get(ratioKey) ?? 16 / 9); }, [ratioKey]);
  useEffect(() => {
    if (videoRatios.has(ratioKey) || !data.poster || typeof Image === 'undefined') return;
    const image = new Image();
    image.onload = () => { if (!videoRatios.has(ratioKey) && image.naturalWidth && image.naturalHeight) setRatio(image.naturalWidth / image.naturalHeight); };
    image.src = data.poster;
    return () => { image.onload = null; };
  }, [ratioKey, data.poster]);
  // Before this card owns the player (only a poster button is shown), read the film's shape from a detached probe
  // that loads metadata only, so a portrait film opens in its own column instead of a 16:9 frame.
  useEffect(() => {
    if (canPlay || !videoUrl || mediaError || videoRatios.has(ratioKey) || typeof document === 'undefined') return;
    const probe = document.createElement('video');
    const onMetadata = () => { if (!videoRatios.has(ratioKey)) measureRatio(probe); };
    probe.preload = 'metadata';
    probe.muted = true;
    probe.addEventListener('loadedmetadata', onMetadata, { once: true });
    probe.src = videoUrl;
    return () => { probe.removeEventListener('loadedmetadata', onMetadata); probe.removeAttribute('src'); probe.load(); };
  }, [canPlay, videoUrl, mediaError, ratioKey, measureRatio]);
  const portrait = ratio < 0.95;

  /** Duration and shape, read on loadedmetadata (K9-15 order: duration patch, restore, then the Inspector's time). */
  const metadata = useRef<(element: HTMLVideoElement) => void>(() => {});
  metadata.current = element => {
    const length = element.duration;
    if (Number.isFinite(length) && length > 0 && Math.abs((data.duration || 0) - length) > 1) patch({ duration: length });
    board.restoreVideoPlayback(nodeId, 'inspector', element);
    setCurrentTime(element.currentTime);
    syncAudio(element);
    measureRatio(element);
  };
  const bindPlayer = useCallback((element: HTMLVideoElement | null) => {
    player.current = element;
    playerRef(element);
    // A local file can finish loading its metadata before React commits the element, and React drops media events
    // for an element it has not committed yet: read the metadata here as the loadedmetadata handler would.
    if (element && element.readyState >= 1) metadata.current(element);
  }, [playerRef]);

  // ---- Playhead store: the Inspector's time is authoritative when it changes (open, restore, seek).
  useLayoutEffect(() => { publishPlayhead(nodeId, currentTime); }, [nodeId, currentTime]);
  useEffect(() => () => { playheads.delete(nodeId); }, [nodeId]);
  const playing = usePlayhead(nodeId, (_time, isPlaying) => isPlaying && canPlay);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  // Portrait clips from short-video platforms usually carry burned-in subtitles, so the on-picture caption starts off
  // there; once the viewer chooses, the choice holds for every film.
  const [captionsChoice, setCaptionsChoice] = useState(readCaptionsPreference);
  const captions = captionsChoice ?? !portrait;
  const toggleCaptions = () => { const next = !captions; setCaptionsChoice(next); writeCaptionsPreference(next); };
  const [fullscreen, setFullscreen] = useState(false);
  const capturePlayback = (element: HTMLVideoElement) => {
    board.captureVideoPlayback(nodeId, 'inspector', element);
    publishPlayhead(nodeId, element.currentTime, !element.paused && !element.ended);
  };
  const syncAudio = (element: HTMLVideoElement) => { setMuted(element.muted); setRate(element.playbackRate); };

  // In fullscreen the transport row is off screen, so the element shows its own controls there.
  useEffect(() => {
    const onChange = () => {
      const element = player.current;
      const active = !!element && document.fullscreenElement === element;
      if (element) element.controls = active;
      setFullscreen(active);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // The whole left column shares the film's width budget (CSS --watch-w reads the ratio from the column).
  useLayoutEffect(() => {
    const stage = watchRef.current?.closest<HTMLElement>('.inspector-stage');
    if (!stage) return;
    stage.style.setProperty('--video-ratio', String(ratio));
    return () => { stage.style.removeProperty('--video-ratio'); };
  }, [ratio]);

  /**
   * Portrait films in the wide layout stand in their own column, the card's notes beside them (QA round 3 P6). The
   * notes column ends where the player's controls end: the stage's bottom padding leaves exactly the room below the
   * controls (`--watch-tail`), and the notes sheet takes the rest of the column (inspector-video.css). Only the stage's
   * border box is observed, so the padding written here never re-triggers the observer.
   */
  useLayoutEffect(() => {
    const watch = watchRef.current;
    const stage = watch?.closest<HTMLElement>('.inspector-stage');
    if (!watch || !stage || !portrait) return;
    const fit = () => {
      const style = getComputedStyle(watch);
      const below = parseFloat(style.paddingBottom) + parseFloat(style.marginBottom) || 0;
      const top = parseFloat(getComputedStyle(stage).paddingTop) || 0;
      const tail = Math.max(0, Math.round(stage.clientHeight - top - watch.offsetHeight + below));
      stage.style.setProperty('--watch-tail', `${tail}px`);
    };
    fit();
    if (typeof ResizeObserver !== 'function') return () => { stage.style.removeProperty('--watch-tail'); };
    const observer = new ResizeObserver(fit);
    observer.observe(watch, { box: 'border-box' });
    observer.observe(stage, { box: 'border-box' });
    return () => { observer.disconnect(); stage.style.removeProperty('--watch-tail'); };
  }, [portrait]);

  // The column header gets a hairline once content scrolls under the pinned player.
  useEffect(() => {
    const watch = watchRef.current;
    const stage = watch?.closest<HTMLElement>('.inspector-stage');
    if (!watch || !stage) return;
    let frame = 0;
    const measure = () => { frame = 0; watch.toggleAttribute('data-scrolled', stage.scrollTop > watch.offsetTop + 1); };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    stage.addEventListener('scroll', onScroll, { passive: true });
    measure();
    return () => { stage.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, []);

  const duration = data.duration && data.duration > 0 ? data.duration : lines.at(-1)?.end ?? 0;
  const timeNow = () => (player.current && canPlay ? player.current.currentTime : playheads.get(nodeId)?.time ?? board.getVideoPlayback(nodeId).time);
  /** Every seek and start goes through board.playVideo (K9-15); the store moves first so the UI answers at once. */
  const seek = (time: number) => {
    if (!playable) return;
    const target = Math.max(0, duration ? Math.min(time, duration) : time);
    publishPlayhead(nodeId, target);
    board.playVideo(nodeId, target);
    setCurrentTime(target);
  };
  const togglePlay = () => {
    if (!playable) return;
    const element = player.current;
    if (element && canPlay && !element.paused && !element.ended) { element.pause(); return; }
    board.playVideo(nodeId, element && canPlay && element.ended ? 0 : timeNow());
  };
  const seekRef = useRef(seek);
  seekRef.current = seek;
  const stableSeek = useCallback((time: number) => seekRef.current(time), []);
  const step = (direction: -1 | 1) => { const line = neighbourLine(lines, timeNow(), direction); if (line) seek(line.start); };
  const cycleRate = () => {
    const element = player.current;
    if (!element) return;
    const next = RATES[(RATES.indexOf(element.playbackRate) + 1) % RATES.length] ?? 1;
    element.playbackRate = next;
  };
  const toggleMute = () => { const element = player.current; if (element) element.muted = !element.muted; };
  const toggleFullscreen = () => {
    const element = player.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void element.requestFullscreen?.().catch(() => {});
  };
  /**
   * Space plays or pauses and ↑ ↓ move by sentence anywhere in the workbench (§6.18.2), except where a control owns
   * those keys: buttons and links, text fields, the timeline slider, switches, the transcript list (↑ ↓ move between
   * rows there) and open dialogs.
   */
  const keys = useRef({ togglePlay, step });
  keys.current = { togglePlay, step };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      if (event.key !== ' ' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const target = event.target instanceof Element ? event.target : null;
      const workbench = watchRef.current?.closest('.inspector--video');
      if (!workbench || !target || !workbench.contains(target) || document.querySelector('dialog[open]')) return;
      if (target.closest('button, a, input, textarea, select, summary, [contenteditable="true"], [role="slider"], [role="switch"], [role="menu"], .inspector-transcript')) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === ' ') { if (!event.repeat) keys.current.togglePlay(); }
      else keys.current.step(event.key === 'ArrowUp' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const playerStyle = { '--video-ratio': String(ratio) } as CSSProperties;
  // A link import keeps its task's start; other videos use `collectedAt` once core stores it (INSP-21, integration request).
  const collected = collectedLabel(videoImport?.createdAt ?? (typeof data.collectedAt === 'string' ? data.collectedAt : undefined));
  const sourceLink = sourceUrl ? <a className="watch-source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">打开原视频<ArrowUpRight size={13} aria-hidden="true" /></a> : null;

  return <>
    <section ref={watchRef} className="inspector-watch" data-orientation={portrait ? 'portrait' : 'landscape'} style={playerStyle} aria-label="播放器">
      {(sourceLink || collected) && <InspectorSlot name="header-meta" fallback={sourceLink}>{collected && <span className="watch-collected">{collected}</span>}{sourceLink}</InspectorSlot>}
      <div className={`inspector-player${playing ? ' is-playing' : ''}`}>
        {playable ? canPlay ? <video
          key={`${nodeId}-${videoUrl}`}
          ref={bindPlayer}
          src={videoUrl}
          poster={data.poster || undefined}
          playsInline
          preload="metadata"
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          onError={() => setMediaError(true)}
          onTimeUpdate={event => capturePlayback(event.currentTarget)}
          onPlay={event => capturePlayback(event.currentTarget)}
          onPause={event => capturePlayback(event.currentTarget)}
          onEnded={event => capturePlayback(event.currentTarget)}
          onVolumeChange={event => { capturePlayback(event.currentTarget); syncAudio(event.currentTarget); }}
          onRateChange={event => { capturePlayback(event.currentTarget); syncAudio(event.currentTarget); }}
          onSeeked={event => publishPlayhead(nodeId, event.currentTarget.currentTime, !event.currentTarget.paused)}
          onLoadedMetadata={event => metadata.current(event.currentTarget)}
          onResize={event => measureRatio(event.currentTarget)}
        /> : <button type="button" className="inspector-play-placeholder" onClick={() => board.playVideo(nodeId, board.getVideoPlayback(nodeId).time)}>
          {data.poster && <img src={data.poster} alt="" draggable={false} />}
          <span className="watch-poster__play" aria-hidden="true"><Play size={18} /></span>
          <span className="watch-poster__label">播放视频</span>
        </button> : fillable ? <VideoFillEmpty nodeId={nodeId} data={data} sourceUrl={sourceUrl} patch={patch} onNotify={onNotify} /> : <div className="inspector-media-empty">
          {(importBusy || mediaLoading) && !mediaError ? <LoaderCircle size={24} className="inspector-is-processing" aria-hidden="true" /> : <Film size={24} aria-hidden="true" />}
          <strong>
            {mediaError ? '这段视频无法播放'
              : mediaLoading ? '正在读取视频'
                : mediaStatus === 'missing' ? '视频文件未找到'
                  : mediaStatus === 'error' ? '视频文件读取失败'
                    : importBusy ? (videoImport?.status === 'queued' ? '视频正在排队' : '正在准备可播放的视频')
                      : data.mediaId || nativeMediaUrl ? '这段视频暂时不可用' : '这张卡还没有视频'}
          </strong>
          <Words text={mediaError ? (lines.length ? '请检查文件格式或重新导入视频。已准备好的逐字稿仍可阅读。' : '这个文件可能已损坏或格式不受支持，请换一个文件重新导入。')
              : mediaLoading ? '读取完成后即可播放，文字与观看笔记始终可用。'
                : mediaUnavailable || data.mediaId || nativeMediaUrl ? '可以重新读取或导入原文件。逐字稿、摘录与观看笔记仍保留。'
                  : importBusy ? '下载完成后即可播放，逐字稿会继续在后台准备。'
                    : videoImport ? '可以重试处理，或从上方打开原视频查看。' : '添加视频链接或本机视频，就能在这里观看、转写和摘录。'} />
          {(mediaError || mediaUnavailable) && data.mediaId && board.retryMedia && <button type="button" className="btn btn--sm btn--line" onClick={retryMedia}>
            <RotateCcw size={14} aria-hidden="true" />重新读取
          </button>}
        </div>}
        {playing && <span className="watch-onair">播放中</span>}
        {playable && canPlay && captions && lines.length > 0 && <WatchCaption nodeId={nodeId} lines={lines} fallbackTime={currentTime} />}
      </div>
      {duration > 0 && <WatchTimeline nodeId={nodeId} lines={lines} duration={duration} fallbackTime={currentTime} live={playable && canPlay} disabled={!playable} onSeek={stableSeek} />}
      {playable && <div className="watch-controls">
        <button type="button" className="watch-transport" aria-label={playing ? '暂停' : '播放'} title={withShortcut(playing ? '暂停' : '播放', 'play-pause')} disabled={!playable} onClick={togglePlay}>
          {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        </button>
        <WatchClock nodeId={nodeId} duration={duration} fallbackTime={currentTime} />
        <button type="button" className="btn watch-step" aria-label="上一句" title={chordTitle('上一句', { key: 'ArrowUp' })} disabled={!playable || !lines.length} onClick={() => step(-1)}><StepBack size={15} aria-hidden="true" /><span className="watch-step__label">上一句</span></button>
        <button type="button" className="btn watch-step" aria-label="下一句" title={chordTitle('下一句', { key: 'ArrowDown' })} disabled={!playable || !lines.length} onClick={() => step(1)}><StepForward size={15} aria-hidden="true" /><span className="watch-step__label">下一句</span></button>
        <div className="watch-controls__end">
          <button type="button" className="btn watch-replay" aria-label="后退 5 秒" title="后退 5 秒并播放" disabled={!playable} onClick={() => seek(timeNow() - 5)}><RotateCcw size={15} aria-hidden="true" /><span className="tabular">5</span> 秒</button>
          <button type="button" className="btn watch-rate tabular" aria-label={`播放速度 ${rate}×，点按切换`} title="切换播放速度" disabled={!playable || !canPlay} onClick={cycleRate}>{Number.isInteger(rate) ? rate.toFixed(1) : String(rate)}×</button>
          <button type="button" className="icon-btn" aria-label="画面字幕" title={captions ? '隐藏画面字幕' : '在画面上显示当前句'} aria-pressed={captions} disabled={!lines.length} onClick={toggleCaptions}>
            {captions ? <Captions size={16} aria-hidden="true" /> : <CaptionsOff size={16} aria-hidden="true" />}
          </button>
          <button type="button" className="icon-btn" aria-label="静音" title={muted ? '取消静音' : '静音'} aria-pressed={muted} disabled={!playable || !canPlay} onClick={toggleMute}>
            {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
          </button>
          <button type="button" className="icon-btn" aria-label={fullscreen ? '退出全屏' : '全屏'} title={fullscreen ? '退出全屏' : '全屏，也可以双击画面'} disabled={!playable || !canPlay} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>}
    </section>
    <VideoProvenance nodeId={nodeId} onSeek={stableSeek} />
  </>;
}

/** The sentence on screen, as a subtitle without a black bar (§6.18.2). Re-renders once per sentence. */
function WatchCaption({ nodeId, lines, fallbackTime }: { nodeId: string; lines: TranscriptLine[]; fallbackTime: number }) {
  const index = usePlayhead(nodeId, time => lineIndexAt(lines, time), fallbackTime);
  if (index < 0) return null;
  return <p className="watch-caption" aria-hidden="true"><Words text={lines[index].text} /></p>;
}

/** “01:33 / 02:20”, re-rendered once per second. */
function WatchClock({ nodeId, duration, fallbackTime }: { nodeId: string; duration: number; fallbackTime: number }) {
  const second = usePlayhead(nodeId, time => Math.floor(time), fallbackTime);
  const hours = duration >= 3600;
  return <div className="watch-clock tabular" role="timer" aria-label={`当前 ${clockLabel(second, hours)}，共 ${clockLabel(duration, hours)}`}>
    <span className="watch-clock__now">{clockLabel(second, hours)}</span><span className="watch-clock__total">/ {clockLabel(duration, hours)}</span>
  </div>;
}

/**
 * Long transcripts draw one continuous rail. Cells are drawn per sentence only while each keeps about 4px of its own
 * on average (6px share minus the 2px gap): below that the rail turns into a barcode (INSP-31). Before the width is
 * known, up to SEGMENT_LIMIT sentences are drawn as cells.
 */
const MIN_CELL_PX = 6;
const SEGMENT_LIMIT = 160;
const TAG_GAP = 8;
// Standard stamp: 22px icon cell + 16px body padding + two 1px borders (components/tag.css).
const STAMP_CHROME = 40;

type Span = { left: number; width: number; key: string };
function spanStyle(span: Span): CSSProperties { return { left: `${span.left}%`, width: `max(1px, calc(${span.width}% - 2px))` }; }

/**
 * Timeline = the sentence rail (§6.18.2, D2 margin marks): one cell per sentence sized by its length, with excerpted
 * (blue-print), selected (ink) and current (light) on the same axis as the playhead. Excerpts hang a provenance tag;
 * the selection is named in plain text. The playhead moves through a CSS variable, never through React.
 */
const WatchTimeline = memo(function WatchTimeline({ nodeId, lines, duration, fallbackTime, live, disabled, onSeek }: {
  nodeId: string;
  lines: TranscriptLine[];
  duration: number;
  fallbackTime: number;
  /** The player belongs to this card: only then is there a current sentence to light. */
  live: boolean;
  disabled: boolean;
  onSeek: (time: number) => void;
}) {
  const board = useBoard();
  const selected = useSelectedLines(nodeId);
  const quotes = useMemo(() => videoQuotes(board.nodes, nodeId), [board.nodes, nodeId]);
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const dragging = useRef(false);
  const latestSeek = useRef(onSeek);
  latestSeek.current = onSeek;
  const pct = (time: number) => Math.min(100, Math.max(0, (time / duration) * 100));
  const currentIndex = usePlayhead(nodeId, time => (live ? lineIndexAt(lines, time) : -1), fallbackTime);

  // Width for tag placement.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    setWidth(root.clientWidth);
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // Playhead and slider value follow the store directly (no React render per timeupdate, PV-M1).
  useLayoutEffect(() => {
    const root = rootRef.current, track = trackRef.current;
    if (!root || !track) return;
    let second = -1;
    const apply = () => {
      const time = playheads.get(nodeId)?.time ?? fallbackTime;
      root.style.setProperty('--progress', `${pct(time)}%`);
      const whole = Math.floor(time);
      if (whole === second) return;
      second = whole;
      const hours = duration >= 3600;
      track.setAttribute('aria-valuenow', String(Math.min(Math.floor(duration), whole)));
      track.setAttribute('aria-valuetext', `${clockLabel(time, hours)} / ${clockLabel(duration, hours)}`);
    };
    apply();
    return playheads.subscribe(nodeId, apply);
  }, [nodeId, duration, fallbackTime]);

  const segmented = lines.length > 0 && (width ? width / lines.length >= MIN_CELL_PX : lines.length <= SEGMENT_LIMIT);
  const cells = useMemo<(Span & { line: TranscriptLine })[]>(() => segmented
    ? lines.map(line => ({ line, key: line.id, left: pct(line.start), width: Math.max(0, pct(line.end) - pct(line.start)) }))
    : [], [lines, segmented, duration]);
  const usedSpans = useMemo<Span[]>(() => {
    if (segmented) {
      return cells.filter(cell => quotes.some(quote => cell.line.start < quote.end - 0.01 && cell.line.end > quote.start + 0.01));
    }
    return quotes.map(quote => ({ key: quote.id, left: pct(quote.start), width: Math.max(0.2, pct(quote.end) - pct(quote.start)) }));
  }, [cells, quotes, segmented, duration]);
  const selectedRuns = useMemo(() => {
    const picked = lines.filter(line => selected?.has(line.id));
    if (!picked.length) return { spans: [] as Span[], count: 0, from: 0, to: 0 };
    if (segmented) return { spans: cells.filter(cell => selected?.has(cell.line.id)), count: picked.length, from: picked[0].start, to: picked.at(-1)!.end };
    // A long transcript draws one continuous rail: neighbouring selected sentences become one span (1800 → 1).
    const runs: { key: string; from: number; to: number }[] = [];
    let open = false;
    for (const line of lines) {
      if (!selected?.has(line.id)) { open = false; continue; }
      if (open) runs[runs.length - 1].to = line.end;
      else { runs.push({ key: line.id, from: line.start, to: line.end }); open = true; }
    }
    const spans = runs.map(run => ({ key: run.key, left: pct(run.from), width: Math.max(0.2, pct(run.to) - pct(run.from)) }));
    return { spans, count: picked.length, from: picked[0].start, to: picked.at(-1)!.end };
  }, [lines, selected, cells, segmented, duration]);

  // Tags hang above excerpts, left-aligned to their start; overlapping ones stay as rail colour only (all are in 来历).
  const flags = useMemo(() => {
    if (!width) return [] as (VideoQuote & { x: number })[];
    const placed: (VideoQuote & { x: number; right: number })[] = [];
    for (const quote of quotes) {
      const tagWidth = STAMP_CHROME + quote.label.length * 7.2;
      const x = Math.min(Math.max(0, (pct(quote.start) / 100) * width - 2), Math.max(0, width - tagWidth));
      if (placed.length && x < placed.at(-1)!.right + TAG_GAP) continue;
      placed.push({ ...quote, x, right: x + tagWidth });
    }
    return placed;
  }, [quotes, width, duration]);
  // “已选 N 句” sits centred over the selection, else just after a tag; it never lies under a tag (the transcript
  // row and footer still name the count when no free spot is left).
  const pickedLabel = selectedRuns.count ? (() => {
    const labelWidth = 64;
    const clamp = (x: number) => Math.min(Math.max(0, x), Math.max(0, width - labelWidth));
    const tagEnd = (flag: (typeof flags)[number]) => flag.x + STAMP_CHROME + flag.label.length * 7.2;
    const free = (x: number) => !flags.some(flag => x < tagEnd(flag) + TAG_GAP && x + labelWidth > flag.x - TAG_GAP);
    const centred = ((pct(selectedRuns.from) + pct(selectedRuns.to)) / 200) * width - labelWidth / 2;
    const spots = [centred, ...flags.map(flag => tagEnd(flag) + TAG_GAP), ...flags.map(flag => flag.x - TAG_GAP - labelWidth)].map(clamp).filter(free);
    if (!spots.length) return null;
    return { x: spots.reduce((best, spot) => Math.abs(spot - centred) < Math.abs(best - centred) ? spot : best) };
  })() : null;

  const ticks = useMemo(() => {
    const steps = [60, 120, 300, 600, 900, 1800, 3600];
    const stepSize = steps.find(size => duration / size <= 6) ?? 3600;
    const hours = duration >= 3600;
    const values: number[] = [];
    for (let time = 0; time < duration; time += stepSize) values.push(time);
    if (values.length > 1 && (duration - values.at(-1)!) / duration < 0.08) values.pop();
    return [...values, duration].map(time => ({ time, label: clockLabel(time, hours) }));
  }, [duration]);

  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration));
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    dragging.current = true;
    const time = timeAt(event.clientX);
    rootRef.current?.style.setProperty('--progress', `${pct(time)}%`);
    setHover({ x: event.clientX - trackRef.current!.getBoundingClientRect().left, time });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const time = timeAt(event.clientX);
    if (dragging.current) rootRef.current?.style.setProperty('--progress', `${pct(time)}%`);
    setHover({ x: event.clientX - trackRef.current!.getBoundingClientRect().left, time });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    latestSeek.current(timeAt(event.clientX));
  };
  const keyTimer = useRef(0);
  const keyTarget = useRef<number | null>(null);
  useEffect(() => () => window.clearTimeout(keyTimer.current), []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const base = keyTarget.current ?? playheads.get(nodeId)?.time ?? fallbackTime;
    const index = lineIndexAt(lines, base);
    let next: number | undefined;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = base - 5;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = base + 5;
    else if (event.key === 'PageUp') next = (index > 0 ? lines[index - 1] : neighbourLine(lines, base, -1))?.start;
    else if (event.key === 'PageDown') next = neighbourLine(lines, base, 1)?.start;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = Math.max(0, duration - 1);
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const target = Math.min(duration, Math.max(0, next));
    keyTarget.current = target;
    rootRef.current?.style.setProperty('--progress', `${pct(target)}%`);
    // Repeated keys preview immediately and seek once they settle, so holding an arrow does not flood playback.
    window.clearTimeout(keyTimer.current);
    keyTimer.current = window.setTimeout(() => { keyTarget.current = null; latestSeek.current(target); }, 140);
  };

  const hoverLine = hover ? lines[lineIndexAt(lines, hover.time)] : undefined;
  const hours = duration >= 3600;
  const current = currentIndex >= 0 ? lines[currentIndex] : undefined;
  return <div ref={rootRef} className="watch-timeline" data-segmented={segmented || undefined} data-disabled={disabled || undefined}>
    <div className="watch-timeline__flags">
      {flags.map(flag => <span key={flag.id} className="watch-timeline__flag" style={{ left: `${flag.x}px` }}>
        <ProvenanceTag kind="video" label={flag.label} actionLabel={`回到原片 ${clockLabel(flag.start, hours)}`} title={`跳转至 ${clockLabel(flag.start, hours)}`} onActivate={() => onSeek(flag.start)} />
      </span>)}
      {pickedLabel && <span className="watch-timeline__picked" style={{ left: `${pickedLabel.x}px` }}>已选 <span className="tabular">{selectedRuns.count}</span> 句</span>}
    </div>
    <div
      ref={trackRef}
      className="watch-track"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="播放位置"
      aria-valuemin={0}
      aria-valuemax={Math.floor(duration)}
      aria-disabled={disabled || undefined}
      aria-keyshortcuts="ArrowLeft ArrowRight PageUp PageDown Home End"
      title="点按或拖动定位；← → 5 秒，PageUp / PageDown 按句"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragging.current = false; }}
      onPointerLeave={() => { if (!dragging.current) setHover(null); }}
      onKeyDown={onKeyDown}
    >
      <div className="watch-rail" aria-hidden="true">
        {segmented ? cells.map(cell => <i key={cell.key} style={spanStyle(cell)} />) : <i className="watch-rail__bar" />}
      </div>
      <div className="watch-rail watch-rail--played" aria-hidden="true">
        {segmented ? cells.map(cell => <i key={cell.key} style={spanStyle(cell)} />) : <i className="watch-rail__bar" />}
      </div>
      <div className="watch-rail watch-rail--marks" aria-hidden="true">
        {usedSpans.map(span => <i key={`u-${span.key}`} className="is-used" style={spanStyle(span)} />)}
        {selectedRuns.spans.map(span => <i key={`s-${span.key}`} className="is-picked" style={spanStyle(span)} />)}
        {current && <i className="is-now" style={spanStyle({ key: 'now', left: pct(current.start), width: Math.max(0.25, pct(current.end) - pct(current.start)) })} />}
      </div>
      <i className="watch-playhead" aria-hidden="true" />
      {hover && <span className="watch-scrub-tip" style={{ left: `${hover.x}px` }} aria-hidden="true">
        <span className="tabular">{clockLabel(hover.time, hours)}</span>{hoverLine && <span className="watch-scrub-tip__line">{hoverLine.text}</span>}
      </span>}
    </div>
    <div className="watch-scale tabular" aria-hidden="true">
      {ticks.map((tick, index) => <span key={tick.time} data-edge={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : undefined} style={{ left: `${pct(tick.time)}%` }}>{tick.label}</span>)}
    </div>
  </div>;
});
