import assert from 'node:assert/strict';
import test from 'node:test';
import { VideoPlaybackSession, type VideoPlaybackPlayer, type VideoPlayerSurface } from '../src/video-playback';

class FakePlayer implements VideoPlaybackPlayer {
  currentTime = 0;
  paused = true;
  readyState = 1;
  duration = 120;
  muted = false;
  volume = 1;
  playbackRate = 1;
  playCalls = 0;
  pauseCalls = 0;
  onPause?: () => void;
  playResult: () => Promise<void> = () => {
    this.paused = false;
    return Promise.resolve();
  };
  play(): Promise<void> { this.playCalls++; return this.playResult(); }
  pause(): void { this.pauseCalls++; this.paused = true; this.onPause?.(); }
}

function bind(session: VideoPlaybackSession, player: FakePlayer, surface: VideoPlayerSurface, key = 'board:video', fingerprint = 'asset-1') {
  player.onPause = () => session.capture(key, surface, player);
  session.bind(key, fingerprint, surface, player);
}

test('a new session defaults to paused at zero and returns detached snapshots', () => {
  const session = new VideoPlaybackSession();
  const snapshot = session.get('board:video', 'asset-1');
  assert.deepEqual(snapshot, { time: 0, paused: true });
  snapshot.time = 45;
  assert.deepEqual(session.get('board:video', 'asset-1'), { time: 0, paused: true });
});

test('playing canvas hands off to inspector and back without stale pause events changing intent', async () => {
  const session = new VideoPlaybackSession();
  const canvas = new FakePlayer();
  session.requestPlay('board:video', 'asset-1', 12);
  bind(session, canvas, 'canvas');
  await Promise.resolve();
  canvas.currentTime = 23;
  session.handoff();
  assert.equal(canvas.paused, true);
  assert.deepEqual(session.get('board:video', 'asset-1'), { time: 23, paused: false });

  const inspector = new FakePlayer();
  bind(session, inspector, 'inspector');
  await Promise.resolve();
  assert.equal(inspector.currentTime, 23);
  assert.equal(inspector.paused, false);
  canvas.currentTime = 99;
  session.capture('board:video', 'canvas', canvas);
  session.bind('board:video', 'asset-1', 'canvas', null);
  assert.deepEqual(session.get('board:video', 'asset-1'), { time: 23, paused: false });

  inspector.currentTime = 36;
  session.handoff();
  const returnedCanvas = new FakePlayer();
  bind(session, returnedCanvas, 'canvas');
  assert.equal(inspector.paused, true);
  assert.equal(returnedCanvas.currentTime, 36);
  assert.equal(returnedCanvas.paused, false);
});

test('a user pause survives canvas to inspector to canvas transitions', () => {
  const session = new VideoPlaybackSession();
  const canvas = new FakePlayer();
  bind(session, canvas, 'canvas');
  canvas.currentTime = 41;
  canvas.pause();
  session.handoff();
  const inspector = new FakePlayer();
  bind(session, inspector, 'inspector');
  assert.equal(inspector.currentTime, 41);
  assert.equal(inspector.paused, true);
  assert.equal(inspector.playCalls, 0);
  session.handoff();
  const returnedCanvas = new FakePlayer();
  bind(session, returnedCanvas, 'canvas');
  assert.equal(returnedCanvas.currentTime, 41);
  assert.equal(returnedCanvas.paused, true);
});

test('muting, volume, and playback rate survive both directions before the next player starts', async () => {
  const session = new VideoPlaybackSession();
  const canvas = new FakePlayer();
  session.requestPlay('board:video', 'asset-1', 13);
  bind(session, canvas, 'canvas');
  await Promise.resolve();
  canvas.muted = true;
  canvas.volume = 0.35;
  canvas.playbackRate = 1.5;
  session.capture('board:video', 'canvas', canvas);
  session.handoff();
  const inspector = new FakePlayer();
  inspector.playResult = () => {
    assert.equal(inspector.muted, true, 'muting must be restored before play');
    assert.equal(inspector.volume, 0.35);
    assert.equal(inspector.playbackRate, 1.5);
    inspector.paused = false;
    return Promise.resolve();
  };
  bind(session, inspector, 'inspector');
  await Promise.resolve();
  session.handoff();
  const returnedCanvas = new FakePlayer();
  returnedCanvas.playResult = () => {
    assert.equal(returnedCanvas.muted, true, 'returning to canvas must not unmute');
    assert.equal(returnedCanvas.volume, 0.35);
    assert.equal(returnedCanvas.playbackRate, 1.5);
    returnedCanvas.paused = false;
    return Promise.resolve();
  };
  bind(session, returnedCanvas, 'canvas');
  assert.equal(returnedCanvas.playCalls, 1);
  assert.deepEqual(session.get('board:video', 'asset-1'), { time: 13, paused: false });
});

test('unmount captures and releases a playing owner before pausing it', async () => {
  const session = new VideoPlaybackSession();
  const player = new FakePlayer();
  session.requestPlay('board:video', 'asset-1');
  bind(session, player, 'canvas');
  await Promise.resolve();
  player.currentTime = 18;
  session.bind('board:video', 'asset-1', 'canvas', null);
  player.currentTime = 0;
  session.capture('board:video', 'canvas', player);
  assert.deepEqual(session.get('board:video', 'asset-1'), { time: 18, paused: false });
  assert.equal(player.paused, true);
});

test('a new asset resets the position and ignores the old asset ref cleanup and events', async () => {
  const session = new VideoPlaybackSession();
  const oldPlayer = new FakePlayer();
  session.requestPlay('board:video', 'asset-1', 44);
  bind(session, oldPlayer, 'canvas');
  await Promise.resolve();
  assert.deepEqual(session.get('board:video', 'asset-2'), { time: 0, paused: true });
  assert.equal(oldPlayer.paused, true);
  const newPlayer = new FakePlayer();
  bind(session, newPlayer, 'canvas', 'board:video', 'asset-2');
  session.bind('board:video', 'asset-1', 'canvas', null);
  session.capture('board:video', 'canvas', oldPlayer);
  newPlayer.currentTime = 8;
  session.capture('board:video', 'canvas', newPlayer);
  assert.deepEqual(session.get('board:video', 'asset-2'), { time: 8, paused: true });
});

test('explicit play resumes saved position and a new time overrides restoration on the same player', async () => {
  const session = new VideoPlaybackSession();
  const player = new FakePlayer();
  bind(session, player, 'canvas');
  player.currentTime = 29;
  session.capture('board:video', 'canvas', player);
  session.requestPlay('board:video', 'asset-1');
  assert.equal(player.currentTime, 29);
  assert.equal(player.paused, false);
  await Promise.resolve();
  player.currentTime = 33;
  session.requestPlay('board:video', 'asset-1', 7);
  assert.equal(player.currentTime, 7);
  assert.equal(player.paused, false);
  assert.deepEqual(session.get('board:video', 'asset-1'), { time: 7, paused: false });
  session.restore('board:video', 'canvas', player);
  assert.equal(player.currentTime, 7);
});

test('metadata readiness preserves the requested time and playing state until restoration is possible', () => {
  const session = new VideoPlaybackSession();
  const player = new FakePlayer();
  player.readyState = 0;
  session.requestPlay('board:video', 'asset-1', 52);
  bind(session, player, 'canvas');
  session.capture('board:video', 'canvas', player);
  assert.equal(player.playCalls, 0);
  assert.deepEqual(session.get('board:video', 'asset-1'), { time: 52, paused: false });
  player.readyState = 1;
  session.restore('board:video', 'canvas', player);
  assert.equal(player.currentTime, 52);
  assert.equal(player.paused, false);
});

test('a rejected play promise is handled and reports the actual paused state', async () => {
  const session = new VideoPlaybackSession();
  const player = new FakePlayer();
  player.playResult = () => Promise.reject(new Error('Autoplay denied'));
  session.requestPlay('board:video', 'asset-1', 11);
  bind(session, player, 'canvas');
  await Promise.resolve();
  assert.deepEqual(session.get('board:video', 'asset-1'), { time: 11, paused: true });
});

test('a play promise finishing after handoff cannot restart or rewrite the old player', async () => {
  const session = new VideoPlaybackSession();
  const oldPlayer = new FakePlayer();
  let finishPlay!: () => void;
  oldPlayer.playResult = () => new Promise(resolve => { finishPlay = () => { oldPlayer.paused = false; resolve(); }; });
  session.requestPlay('board:video', 'asset-1', 17);
  bind(session, oldPlayer, 'canvas');
  session.handoff();
  assert.deepEqual(session.get('board:video', 'asset-1'), { time: 17, paused: false });
  const nextPlayer = new FakePlayer();
  bind(session, nextPlayer, 'inspector');
  finishPlay();
  await Promise.resolve();
  assert.equal(oldPlayer.paused, true);
  assert.equal(nextPlayer.paused, false);
  session.capture('board:video', 'canvas', oldPlayer);
  assert.deepEqual(session.get('board:video', 'asset-1'), { time: 17, paused: false });
});

test('stop saves time, explicitly pauses, and releases the owner', async () => {
  const session = new VideoPlaybackSession();
  const player = new FakePlayer();
  session.requestPlay('board:video', 'asset-1', 12);
  bind(session, player, 'canvas');
  await Promise.resolve();
  player.currentTime = 39;
  session.stop();
  assert.equal(player.paused, true);
  player.currentTime = 2;
  player.paused = false;
  session.capture('board:video', 'canvas', player);
  assert.deepEqual(session.get('board:video', 'asset-1'), { time: 39, paused: true });
});

test('binding or requesting another node leaves at most one owner and preserves separate positions', async () => {
  const session = new VideoPlaybackSession();
  const first = new FakePlayer();
  session.requestPlay('board:first', 'asset-1', 15);
  bind(session, first, 'canvas', 'board:first');
  await Promise.resolve();
  first.currentTime = 22;
  session.requestPlay('board:second', 'asset-2', 5);
  assert.equal(first.paused, true);
  const second = new FakePlayer();
  bind(session, second, 'inspector', 'board:second', 'asset-2');
  await Promise.resolve();
  second.currentTime = 9;
  bind(session, first, 'canvas', 'board:first');
  assert.equal(second.paused, true);
  assert.equal(first.paused, false);
  assert.equal(first.currentTime, 22);
  session.capture('board:second', 'inspector', second);
  assert.deepEqual(session.get('board:second', 'asset-2'), { time: 9, paused: false });
  first.currentTime = 25;
  session.bind('board:first', 'asset-1', 'canvas', first);
  assert.equal(first.currentTime, 25, 'rebinding the same owner must not rewind from old memory');
});

test('FV-M4: a hand-off nobody picks up settles paused; the surface that renders right away keeps playing', async () => {
  const pending: (() => void)[] = [];
  const session = new VideoPlaybackSession(run => { pending.push(run); });
  const inspector = new FakePlayer();
  session.requestPlay('board:video', 'asset-1', 44);
  bind(session, inspector, 'inspector');
  await Promise.resolve();
  inspector.currentTime = 46;
  // Closing the watch page hands the film to its card, which binds in the same update and keeps playing.
  session.handoff();
  const card = new FakePlayer();
  bind(session, card, 'canvas');
  await Promise.resolve();
  pending.splice(0).forEach(run => run());
  assert.equal(card.paused, false);
  assert.deepEqual(session.get('board:video', 'asset-1'), { time: 46, paused: false });

  // The card scrolls out of view and unmounts: once settled, the film is paused at its position.
  card.currentTime = 47.5;
  session.bind('board:video', 'asset-1', 'canvas', null);
  pending.splice(0).forEach(run => run());
  assert.deepEqual(session.get('board:video', 'asset-1'), { time: 47.5, paused: true });
  // Coming back into view restores the frame without playing, with or without sound.
  const remounted = new FakePlayer();
  bind(session, remounted, 'canvas');
  assert.equal(remounted.currentTime, 47.5);
  assert.equal(remounted.paused, true);
  assert.equal(remounted.playCalls, 0);

  // A ref change re-binding before the settle keeps playing.
  session.requestPlay('board:video', 'asset-1');
  await Promise.resolve();
  session.bind('board:video', 'asset-1', 'canvas', null);
  bind(session, remounted, 'canvas');
  pending.splice(0).forEach(run => run());
  assert.equal(remounted.paused, false);

  // A hand-off to a card that is not on the canvas settles paused too; stop() pauses a film still in transit.
  session.handoff();
  pending.splice(0).forEach(run => run());
  assert.equal(session.get('board:video', 'asset-1').paused, true);
  session.requestPlay('board:video', 'asset-1');
  const again = new FakePlayer();
  bind(session, again, 'canvas');
  await Promise.resolve();
  session.handoff();
  session.stop();
  assert.equal(session.get('board:video', 'asset-1').paused, true);
});

test('an explicit play request waits for its player beyond the settle', () => {
  const pending: (() => void)[] = [];
  const session = new VideoPlaybackSession(run => { pending.push(run); });
  const first = new FakePlayer();
  session.requestPlay('board:first', 'asset-1', 3);
  bind(session, first, 'canvas', 'board:first');
  session.requestPlay('board:second', 'asset-2', 9);
  pending.splice(0).forEach(run => run());
  assert.deepEqual(session.get('board:second', 'asset-2'), { time: 9, paused: false }, 'the requested film still plays when its player binds late');
  assert.equal(session.get('board:first', 'asset-1').paused, true, 'the film it replaced does not resume by itself later');
});

test('play pressed before the metadata arrives keeps playing when the session restores the player', () => {
  const session = new VideoPlaybackSession();
  const player = new FakePlayer();
  player.readyState = 0;
  bind(session, player, 'inspector');
  player.paused = false; // the native control started it before loadedmetadata
  player.readyState = 1;
  session.restore('board:video', 'inspector', player);
  assert.equal(player.pauseCalls, 0, 'the saved pause does not interrupt the pending play()');
  assert.equal(player.paused, false);
  assert.equal(session.get('board:video', 'asset-1').paused, false);
});

test('a film handed to a watch page that is still loading keeps playing once the page binds', async () => {
  const pending: (() => void)[] = [];
  const session = new VideoPlaybackSession(run => { pending.push(run); });
  const card = new FakePlayer();
  session.requestPlay('board:video', 'asset-1', 8);
  bind(session, card, 'canvas');
  await Promise.resolve();
  session.handoff();
  session.expect('board:video');
  pending.splice(0).forEach(run => run());
  const inspector = new FakePlayer();
  bind(session, inspector, 'inspector');
  assert.equal(inspector.paused, false);
  assert.equal(inspector.currentTime, 8);
});

test('CORE-09: opening at the current position does not seek, so the poster stays until the first play', () => {
  const session = new VideoPlaybackSession();
  const player = new FakePlayer();
  let seeks = 0;
  let time = 0;
  Object.defineProperty(player, 'currentTime', { get: () => time, set: value => { seeks++; time = value; } });
  bind(session, player, 'inspector');
  session.restore('board:video', 'inspector', player);
  assert.equal(seeks, 0, 'no seek to 0 when already at 0');
  session.requestPlay('board:video', 'asset-1', 28);
  session.restore('board:video', 'inspector', player);
  assert.equal(time, 28, 'a real position change still seeks');
});
