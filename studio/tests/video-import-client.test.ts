import test from 'node:test';
import assert from 'node:assert/strict';
import { importVideoLink, isVideoImportAvailable, listVideoImports, subscribeVideoImports, type FieldVideoImportsAPI, type VideoImportTask } from '../src/video-import';

const input = { url: 'https://www.youtube.com/watch?v=fixture', boardId: 'board', nodeId: 'node' };
function task(patch: Partial<VideoImportTask> = {}): VideoImportTask {
  return { id: 'job', ...input, originalText: input.url, platform: 'youtube', status: 'queued', progress: 0,
    message: '等待下载', attempt: 1, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', ...patch };
}
function fixture() {
  const listeners = new Set<(task: VideoImportTask) => void>();
  const cancelled: { id: string; attempt?: number }[] = [];
  let current = task();
  const backend: FieldVideoImportsAPI = {
    submit: async () => current,
    submitLocal: async () => { throw new Error('unused'); },
    list: async () => [current],
    cancel: async (id, attempt) => { cancelled.push({ id, attempt }); return { ...current, status: 'cancelled' }; },
    retry: async () => current,
    libraryState: async () => { throw new Error('unused'); },
    onTask: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { fieldVideoImports: backend } });
  return { backend, listeners, cancelled, set: (value: VideoImportTask) => { current = value; },
    emit: (value: VideoImportTask) => { current = value; for (const listener of listeners) listener(value); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const card = { kind: 'video' as const, title: '测试视频', body: '', url: 'https://example.com/video.mp4' };

test('fast completion emitted inside submit is retained and subscription cleans up', async () => {
  const f = fixture();
  const progress: string[] = [], media: unknown[] = [];
  f.backend.submit = async () => {
    assert.equal(f.listeners.size, 1);
    f.emit(task({ status: 'completed', progress: 100, card, updatedAt: '2026-10-02T00:00:01.000Z' }));
    return task(); // Deliberately older response arriving after the completion event.
  };
  const controller = new AbortController();
  assert.deepEqual(await importVideoLink(input, { signal: controller.signal, onProgress: value => progress.push(value.stage), onMediaReady: value => media.push(value) }), card);
  assert.equal(media.length, 1);
  assert.ok(progress.includes('completed'));
  assert.equal(f.listeners.size, 0);
  controller.abort(); await tick();
  assert.deepEqual(f.cancelled, []);
});

test('playable media is delivered before ASR finishes and old attempts cannot resolve the promise', async () => {
  const f = fixture();
  f.set(task({ attempt: 2 }));
  let finished = false;
  const media: unknown[] = [];
  const pending = importVideoLink(input, { onMediaReady: value => media.push(value) }).then(value => { finished = true; return value; });
  await tick();
  f.emit(task({ attempt: 1, status: 'completed', card: { ...card, title: 'old attempt' }, updatedAt: '2026-10-02T00:00:05.000Z' }));
  f.emit(task({ attempt: 2, status: 'transcribing', card, updatedAt: '2026-10-02T00:00:01.000Z' }));
  await tick();
  assert.equal(finished, false);
  assert.deepEqual(media, [card]);
  const finalCard = { ...card, transcript: [{ id: 'line', text: '真实字幕', start: 0, end: 2 }] };
  f.emit(task({ attempt: 2, status: 'completed', card: finalCard, updatedAt: '2026-10-02T00:00:02.000Z' }));
  assert.deepEqual(await pending, finalCard);
  assert.equal(f.listeners.size, 0);
});

test('lost IPC events are recovered by the persisted list snapshot', async () => {
  const f = fixture();
  f.backend.submit = async () => task();
  f.backend.list = async () => [task({ status: 'completed', card, updatedAt: '2026-10-02T00:00:01.000Z' })];
  assert.deepEqual(await importVideoLink(input), card);
});

test('abort during submit only cancels its returned node and exact attempt', async () => {
  const f = fixture();
  let submitted!: (value: VideoImportTask) => void;
  f.backend.submit = () => new Promise(resolve => { submitted = resolve; });
  const controller = new AbortController();
  const pending = importVideoLink(input, { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  assert.deepEqual(f.cancelled, []);
  submitted(task({ attempt: 3, reused: true }));
  await rejected;
  assert.deepEqual(f.cancelled, [{ id: 'job', attempt: 3 }]);
  assert.equal(f.listeners.size, 0);
});

test('abort never cancels a task belonging to another card', async () => {
  const f = fixture();
  let submitted!: (value: VideoImportTask) => void;
  f.backend.submit = () => new Promise(resolve => { submitted = resolve; });
  const controller = new AbortController();
  const pending = importVideoLink(input, { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort(); submitted(task({ nodeId: 'another-card', reused: true }));
  await rejected;
  assert.deepEqual(f.cancelled, []);
});

test('backend failure and polling failure are surfaced with cleanup', async () => {
  const f = fixture();
  f.set(task({ status: 'failed', error: '视频已被作者删除' }));
  await assert.rejects(importVideoLink(input), /视频已被作者删除/);
  assert.equal(f.listeners.size, 0);
  const g = fixture();
  g.backend.list = async () => { throw new Error('IPC disconnected'); };
  await assert.rejects(importVideoLink(input), /IPC disconnected/);
  assert.equal(g.listeners.size, 0);
  assert.deepEqual(g.cancelled, []);
});

test('portable-copy size warning does not fail import or overwrite newer subtitles', async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  let finishFetch!: (response: Response) => void;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; return new Promise<Response>(resolve => { finishFetch = resolve; }); };
  const events: VideoImportTask[] = [];
  const unsubscribe = subscribeVideoImports(value => events.push(value));
  try {
    const nativeCard = { ...card, url: 'media://p/video.mp4' };
    f.emit(task({ status: 'transcribing', card: nativeCard, updatedAt: '2026-10-02T00:00:01.000Z' }));
    assert.equal(events[0].card?.url, nativeCard.url);
    await tick();
    const finalCard = { ...nativeCard, transcript: [{ id: 'new', text: '字幕不能被较早的副本覆盖', start: 0, end: 2 }] };
    f.emit(task({ status: 'completed', card: finalCard, updatedAt: '2026-10-02T00:00:02.000Z' }));
    assert.deepEqual(await importVideoLink(input), finalCard);
    finishFetch(new Response('too large', { headers: { 'content-length': String(65 * 1024 * 1024) } }));
    await tick(); await tick();
    assert.equal(fetches, 1);
    assert.equal(events.at(-1)?.status, 'completed');
    assert.deepEqual(events.at(-1)?.card?.transcript, finalCard.transcript);
    assert.match(String(events.at(-1)?.card?.nativeMediaWarning), /64 MB/);
    const snapshots = await listVideoImports();
    assert.match(String(snapshots[0].card?.nativeMediaWarning), /64 MB/);
  } finally { unsubscribe(); globalThis.fetch = originalFetch; }
  assert.equal(f.listeners.size, 0);
});

test('listing persisted history does not recopy media for removed cards', async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error('history must not copy'); };
  try {
    f.set(task({ status: 'completed', card: { ...card, nativeProjectId: 'historic', nativeAssetId: 'removed', url: 'media://historic/removed.mp4' } }));
    assert.equal((await listVideoImports())[0].status, 'completed');
    await tick();
    assert.equal(fetches, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('a browser without the native backend gets an explicit desktop requirement', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  assert.equal(isVideoImportAvailable(), false);
  await assert.rejects(importVideoLink(input), /最新版来处桌面版/);
});
