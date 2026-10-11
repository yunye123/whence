import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { LoaderCircle, Pause, Play, RotateCcw } from 'lucide-react';
import { timecode } from '../model';
import { timeRangeLabel } from '../source-location';
import type { CardActivate } from './types';

/** mm:ss, or H:MM:SS from one hour (PV-m1). */
const clockLabel = (seconds: number) => timeRangeLabel(Math.max(0, seconds)) ?? timecode(seconds);

/** What the controls show; read from the element on its own media events. */
export interface PlayerClock {
  time: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  /** Play was asked for but the picture is still waiting for data (first play of a local file can take seconds). */
  waiting: boolean;
}

export function readClock(player: HTMLVideoElement, fallbackDuration = 0): PlayerClock {
  const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : fallbackDuration;
  return {
    time: Number.isFinite(player.currentTime) ? player.currentTime : 0,
    duration,
    paused: player.paused,
    ended: player.ended,
    waiting: !player.paused && player.readyState < 3,
  };
}

interface CardPlayerProps {
  title: string;
  source?: string;
  poster?: string;
  /** The film length stored on the card, until the element reads its own. */
  storedDuration?: number;
  initialTime: number;
  activate: CardActivate;
  /** CanvasCard's stable ref: binds this element as the canvas surface of the playback session (K9-15). */
  bindPlayer: (player: HTMLVideoElement | null) => void;
  /** Forwards play/pause/timeupdate/ended/volumechange/ratechange to the session (K9-15). */
  capturePlayer: (player: HTMLVideoElement) => void;
  /** loadedmetadata: ratio, then restore the saved position before anything else (K9-15). */
  onMetadata: (player: HTMLVideoElement) => void;
  onError: () => void;
  onClock: (clock: PlayerClock) => void;
  playing: boolean;
}

/**
 * The card's own playback (CANVAS-14): the same `<video class="nodrag nowheel nokey">` as before, without the
 * browser's control strip (its gradient, overflow menu, download and picture-in-picture looked nothing like the
 * watch page). On the picture, media colours that do not follow the theme: the round play glyph stays where the
 * resting card had it and turns into pause; a thin position line and the time sit beside it. While the film plays
 * the strip fades away until the pointer or the keyboard comes back; paused, it stays. Clicking the picture plays
 * or pauses. Everything is a real control: Tab reaches the button and the position slider; on the slider the
 * arrows step 5 seconds, Home / End go to the ends, Space plays or pauses. The element is never autoplayed: it
 * starts only through the session's restore after an explicit “播放” (K9-15).
 */
export function CardPlayer(props: CardPlayerProps) {
  const { title, source, poster, storedDuration = 0, initialTime, activate, bindPlayer, capturePlayer, onMetadata, onError, onClock, playing } = props;
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const [clock, setClock] = useState<PlayerClock>(() => ({
    time: initialTime, duration: storedDuration, paused: true, ended: false, waiting: false,
  }));
  // One stable ref callback: an inline one would unbind and rebind the session on every render.
  const attach = useCallback((player: HTMLVideoElement | null) => {
    playerRef.current = player;
    bindPlayer(player);
  }, [bindPlayer]);
  const sync = (player: HTMLVideoElement, forward = true) => {
    if (forward) capturePlayer(player);
    const next = readClock(player, storedDuration);
    setClock(next);
    onClock(next);
  };
  const toggle = () => {
    const player = playerRef.current;
    if (!player) return;
    if (player.paused || player.ended) void Promise.resolve(player.play()).catch(() => sync(player));
    else player.pause();
  };
  const seek = (time: number) => {
    const player = playerRef.current;
    if (!player || !Number.isFinite(time)) return;
    const end = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : clock.duration;
    player.currentTime = Math.max(0, end ? Math.min(time, end) : time);
    sync(player);
  };
  const onSliderKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -5 : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 5 : 0;
    if (step) { event.preventDefault(); seek(clock.time + step); return; }
    if (event.key === ' ' || event.key === 'k') { event.preventDefault(); toggle(); }
  };

  const { time, duration, paused, ended, waiting } = clock;
  const share = duration > 0 ? Math.max(0, Math.min(1, time / duration)) : 0;
  const glyph = waiting
    ? <LoaderCircle size={14} strokeWidth={2.2} className="spin" aria-hidden="true" />
    : !paused ? <Pause size={13} fill="currentColor" strokeWidth={0} aria-hidden="true" />
      : ended ? <RotateCcw size={13} strokeWidth={2.4} aria-hidden="true" />
        : <Play size={13} fill="currentColor" strokeWidth={0} aria-hidden="true" />;
  const action = paused ? (ended ? '重新播放' : '播放') : '暂停';
  const timeText = `${clockLabel(time)} / ${clockLabel(duration)}`;

  return (
    <>
      <video
        ref={attach}
        className="nodrag nowheel nokey"
        src={source}
        poster={poster}
        playsInline
        preload="metadata"
        disablePictureInPicture
        aria-label={title}
        onClick={event => { event.stopPropagation(); activate(event, toggle); }}
        onPlay={event => sync(event.currentTarget)}
        onPause={event => sync(event.currentTarget)}
        onTimeUpdate={event => sync(event.currentTarget)}
        onEnded={event => sync(event.currentTarget)}
        onVolumeChange={event => sync(event.currentTarget)}
        onRateChange={event => sync(event.currentTarget)}
        // Buffering only changes what the button shows; the session hears nothing new from these.
        onWaiting={event => sync(event.currentTarget, false)}
        onPlaying={event => sync(event.currentTarget, false)}
        onCanPlay={event => sync(event.currentTarget, false)}
        onSeeked={event => sync(event.currentTarget, false)}
        onLoadedMetadata={event => {
          onMetadata(event.currentTarget);
          sync(event.currentTarget, false);
        }}
        onError={onError}
      />
      {playing && <span className="field-card__live" aria-hidden="true"><span className="field-card__live-dot" />播放中</span>}
      <div className={`field-card__player${paused ? ' is-paused' : ''}`}>
        <button
          type="button"
          className="field-card__play nodrag nowheel"
          aria-label={`${action}：${title}`}
          title={waiting ? '正在载入视频' : action}
          onClick={event => activate(event, toggle)}
        >
          {glyph}
        </button>
        <div className="field-card__player-bar">
          <input
            type="range"
            className="field-card__seek nodrag nowheel"
            min={0}
            max={duration > 0 ? duration : 0}
            step="any"
            value={duration > 0 ? Math.min(time, duration) : 0}
            disabled={!(duration > 0)}
            aria-label={`播放位置：${title}`}
            aria-valuetext={timeText}
            style={{ '--seek': `${(share * 100).toFixed(2)}%` } as CSSProperties}
            onChange={event => seek(Number(event.currentTarget.value))}
            onKeyDown={onSliderKey}
          />
          <span className="field-card__player-time tabular" aria-hidden="true">{timeText}</span>
        </div>
      </div>
    </>
  );
}
