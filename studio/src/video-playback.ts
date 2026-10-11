export type VideoPlayerSurface = 'canvas' | 'inspector';
export type VideoPlaybackSnapshot = { time: number; paused: boolean };
export type VideoPlaybackPlayer = Pick<HTMLVideoElement,
  'currentTime' | 'paused' | 'readyState' | 'duration' | 'muted' | 'volume' | 'playbackRate' | 'play' | 'pause'>;

type SavedPlayback = VideoPlaybackSnapshot & { fingerprint: string; muted: boolean; volume: number; playbackRate: number };
type PlaybackOwner = {
  key: string;
  fingerprint: string;
  surface: VideoPlayerSurface;
  player: VideoPlaybackPlayer;
  restored: boolean;
  applying: boolean;
  playPending: boolean;
};

/** Runs a callback once the surfaces have re-rendered after a hand-off (the app passes a short timer). */
export type PlaybackScheduler = (run: () => void) => void;

/** Playback state lives only for this app session, separately from board data. */
export class VideoPlaybackSession {
  private readonly saved = new Map<string, SavedPlayback>();
  private owner: PlaybackOwner | undefined;
  /** Films released while playing (a hand-off or an unmount) whose intent waits for the next surface to bind. */
  private readonly inTransit = new Set<string>();

  constructor(private readonly schedule?: PlaybackScheduler) {}

  get(key: string, fingerprint: string): VideoPlaybackSnapshot {
    const state = this.state(key, fingerprint);
    return { time: state.time, paused: state.paused };
  }

  /** Capture before pausing: pause events from the released player are stale. */
  handoff(): void {
    const owner = this.owner;
    if (!owner) return;
    this.capture(owner.key, owner.surface, owner.player);
    this.owner = undefined;
    owner.player.pause();
    if (this.saved.get(owner.key)?.paused !== false) return;
    if (!this.inTransit.size) this.schedule?.(() => this.settle());
    this.inTransit.add(owner.key);
  }

  /** The next surface for this film is certain to mount (the watch page is opening, however long its module takes). */
  expect(key: string): void {
    this.inTransit.delete(key);
  }

  /**
   * A playing film handed off is picked up by the surface that renders right after it (closing the watch page
   * hands it to its card). One nobody picked up — the card is off the canvas, or it just scrolled out of view and
   * unmounted — stays paused at its position: a card that comes back later shows that frame and never starts by
   * itself, with or without sound (FV-M4, K9-15).
   */
  settle(): void {
    for (const key of this.inTransit) {
      const state = this.saved.get(key);
      if (state && this.owner?.key !== key) state.paused = true;
    }
    this.inTransit.clear();
  }

  bind(key: string, fingerprint: string, surface: VideoPlayerSurface, player: VideoPlaybackPlayer | null): void {
    // A late unmount from an old asset must not invalidate the new asset's state.
    if (!player) {
      if (this.owner?.key === key && this.owner.fingerprint === fingerprint && this.owner.surface === surface) this.handoff();
      return;
    }
    this.state(key, fingerprint);
    this.inTransit.delete(key);
    if (this.owns(key, surface, player) && this.owner!.fingerprint === fingerprint) {
      if (!this.owner!.restored) this.restore(key, surface, player);
      return;
    }
    this.handoff();
    this.owner = { key, fingerprint, surface, player, restored: false, applying: false, playPending: false };
    this.restore(key, surface, player);
  }

  /** Forward media events here; only the currently bound player can save them. */
  capture(key: string, surface: VideoPlayerSurface, player: VideoPlaybackPlayer): void {
    if (!this.owns(key, surface, player)) return;
    const owner = this.owner!;
    if (!owner.restored || owner.applying) return;
    const state = this.saved.get(key)!;
    if (Number.isFinite(player.currentTime) && player.currentTime >= 0) state.time = player.currentTime;
    state.muted = player.muted;
    if (Number.isFinite(player.volume) && player.volume >= 0 && player.volume <= 1) state.volume = player.volume;
    if (Number.isFinite(player.playbackRate) && player.playbackRate > 0) state.playbackRate = player.playbackRate;
    // play() may still be waiting for data when handoff or a queued pause occurs.
    if (!owner.playPending || !player.paused) state.paused = player.paused;
  }

  /** Call again on loadedmetadata when bind happened before metadata was ready. */
  restore(key: string, surface: VideoPlayerSurface, player: VideoPlaybackPlayer): void {
    if (!this.owns(key, surface, player) || player.readyState < 1) return;
    const owner = this.owner!;
    const state = this.saved.get(key)!;
    // Play pressed before the metadata arrived is the person's intent; the saved pause must not stop it.
    if (!owner.restored && !player.paused) state.paused = false;
    owner.applying = true;
    try {
      // Apply audio settings before play so surface changes cannot briefly unmute.
      player.muted = state.muted;
      player.volume = state.volume;
      player.playbackRate = state.playbackRate;
      const time = Number.isFinite(player.duration) && player.duration >= 0
        ? Math.min(state.time, player.duration) : state.time;
      // CORE-09: assigning the same position (opening at 0) makes the browser drop the poster for frame 0 — often black.
      // Seek only when the position really differs, so the poster stays until the first play.
      if (!Number.isFinite(player.currentTime) || Math.abs(player.currentTime - time) >= .05) player.currentTime = time;
      state.time = time;
      owner.restored = true;
      if (state.paused) {
        owner.playPending = false;
        player.pause();
      } else {
        owner.playPending = true;
        // Rejections (including autoplay denial and an interrupted load) stay local.
        void Promise.resolve(player.play()).then(() => {
          if (this.owner === owner) owner.playPending = false;
          else if (this.owner?.player !== player) player.pause();
        }, () => {
          if (this.owner !== owner) return;
          owner.playPending = false;
          state.paused = player.paused;
        });
      }
    } catch {
      // A source can change between loadedmetadata and assigning currentTime.
      // Leave the intended state intact for the next metadata event.
      owner.playPending = false;
      if (owner.restored) state.paused = player.paused;
    } finally {
      owner.applying = false;
    }
  }

  requestPlay(key: string, fingerprint: string, time?: number): void {
    const previous = this.owner;
    this.handoff();
    const state = this.state(key, fingerprint);
    if (time !== undefined && Number.isFinite(time)) state.time = Math.max(0, time);
    state.paused = false;
    // An explicit play waits for its player however long the media takes to load.
    this.inTransit.delete(key);
    // Seeking an already visible player need not wait for another React ref call.
    if (previous?.key === key && previous.fingerprint === fingerprint) {
      this.bind(key, fingerprint, previous.surface, previous.player);
    }
  }

  /** Pause whatever plays, including a film still on its way to the next surface. */
  stop(): void {
    const owner = this.owner;
    if (owner) {
      this.capture(owner.key, owner.surface, owner.player);
      this.saved.get(owner.key)!.paused = true;
      this.owner = undefined;
      owner.player.pause();
    }
    this.settle();
  }

  private owns(key: string, surface: VideoPlayerSurface, player: VideoPlaybackPlayer): boolean {
    return this.owner?.key === key && this.owner.surface === surface && this.owner.player === player;
  }

  private state(key: string, fingerprint: string): SavedPlayback {
    let state = this.saved.get(key);
    if (!state || state.fingerprint !== fingerprint) {
      if (this.owner?.key === key) this.handoff();
      state = { fingerprint, time: 0, paused: true, muted: false, volume: 1, playbackRate: 1 };
      this.saved.set(key, state);
    }
    return state;
  }
}
