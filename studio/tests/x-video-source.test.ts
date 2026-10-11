import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VideoImportService, type VideoImportServiceOptions } from '../native/video-import-service';
import { normalizeVideoInput, xPostSourceFields, type XVideoSource } from '../native/download';
import type { XPost } from '../shared/x-import';

const url = 'https://x.com/akokoi1/status/2104200939095904322/video/1';
const sharing = `分享文案与原帖正文不同：${url}?s=20`;
const fullText = '准确的完整原帖正文\n\n保留段落、中文标点和 https://example.com/source。';
const bytes = Buffer.from('controlled media fixture; no network or ffmpeg in these persistence tests');
function post(text = fullText, completeness: XPost['completeness'] = 'complete'): XPost {
  return { id: '2104200939095904322', url: url.replace('/video/1', ''), title: '原帖原标题',
    author: { name: 'WY', handle: 'akokoi1', url: 'https://x.com/akokoi1' }, text, provider: 'fxtwitter',
    contentKind: 'post', completeness, warnings: completeness === 'partial' ? ['只取得预览'] : [],
    media: [{ kind: 'video', url: 'https://video.twimg.com/fixture.mp4' }] };
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) { assert.ok(Date.now() < deadline, 'native source task did not finish'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function setup(settings: { legacy?: boolean; audio?: boolean; text?: string; completeness?: XPost['completeness']; inputUrl?: string; resolve?: VideoImportServiceOptions['resolveXPost']; failAsrOnce?: boolean } = {}) {
  const base = path.resolve(tmpdir()), directory = await fs.mkdtemp(path.join(base, 'field-x-source-'));
  const count = { download: 0, import: 0, transcribe: 0, detect: 0, resolve: 0 };
  const options: VideoImportServiceOptions = {
    directory,
    download: async (input, project) => {
      count.download++;
      const parent = path.join(project, 'cache', 'downloads', randomUUID());
      await fs.mkdir(parent, { recursive: true });
      const filePath = path.join(parent, 'source.mp4'); await fs.writeFile(filePath, bytes);
      const platform = normalizeVideoInput(input).platform;
      return { filePath, source: { url: input, originalText: input, platform, title: '旧原标题', author: '旧作者',
        ...(platform === 'X' && !settings.legacy ? xPostSourceFields(post(settings.text, settings.completeness)) : {}) } };
    },
    importMedia: async (_file, project) => {
      count.import++; await fs.writeFile(path.join(project, 'media', 'fixture.mp4'), bytes);
      return { name: 'fixture.mp4', kind: 'video', path: 'media/fixture.mp4', hash: createHash('sha256').update(bytes).digest('hex'),
        durationMs: 2000, hasAudio: !!settings.audio, width: 320, height: 180, thumbnails: [] };
    },
    detectTools: async () => { count.detect++; return { python: 'controlled', ffmpeg: 'controlled', ffprobe: 'controlled', model: 'controlled', downloader: true, checks: [] }; },
    transcribeMedia: async () => {
      count.transcribe++; if (settings.failAsrOnce && count.transcribe === 1) throw new Error('controlled ASR interruption');
      return { engine: 'controlled', device: 'cpu', elapsedSeconds: 0.1, segments: [], rawSegments: [] };
    },
    resolveXPost: async (...args) => { count.resolve++; return settings.resolve ? settings.resolve(...args) : post(); },
  };
  let service = await VideoImportService.open(options);
  const source = () => service.libraryState.sources[0] as XVideoSource;
  const task = (id: string) => service.list().find(item => item.id === id)!;
  const submit = () => service.submit({ url: settings.inputUrl || url, originalText: sharing, boardId: 'board', nodeId: 'video' });
  const finish = async (id: string) => { await until(() => !service.hasActiveTasks && ['completed', 'failed', 'cancelled', 'interrupted'].includes(task(id).status)); return task(id); };
  return { directory, count, source, task, submit, finish, get service() { return service; }, async reopen() { await service.close(); service = await VideoImportService.open(options); }, async clean() {
    await service.close(); assert.equal(path.dirname(path.resolve(directory)), base); assert.ok(path.basename(directory).startsWith('field-x-source-'));
    await fs.rm(directory, { recursive: true, force: true });
  } };
}

test('X video source body persists separately from sharing text through normal close and reopen', async () => {
  const f = await setup();
  try {
    const submitted = f.submit(), done = await f.finish(submitted.id);
    assert.equal(done.status, 'completed'); assert.equal(done.originalText, sharing);
    assert.equal(done.card?.sourceOriginalText, fullText); assert.equal(done.card?.sourceTitle, '原帖原标题');
    assert.equal(done.card?.sourceAuthor, 'WY (@akokoi1)'); assert.equal(done.card?.sourceUrl, url);
    assert.equal(Object.hasOwn(done.card!, 'body'), false, 'source refresh must not provide a watching-note body');
    assert.equal(f.source().postText, fullText); assert.equal(f.source().originalText, sharing);
    assert.equal(f.source().postTextStatus, 'complete'); assert.ok(f.source().postTextFetchedAt);
    await f.reopen();
    assert.equal(f.source().postText, fullText); assert.equal(f.task(done.id).card?.sourceOriginalText, fullText);
    assert.equal(f.task(done.id).originalText, sharing); assert.equal(f.count.download, 1);
    const untouched = await f.service.retry(done.id); assert.equal(untouched.attempt, done.attempt); assert.equal(f.count.resolve, 0);
  } finally { await f.clean(); }
});

test('completed legacy X video repairs text without downloading, importing or rerunning even empty ASR', async () => {
  const f = await setup({ legacy: true, audio: true });
  try {
    const old = await f.finish(f.submit().id), originalAsr = structuredClone(old.asr), originalTranscripts = f.service.libraryState.transcripts;
    assert.deepEqual(old.card?.transcript, []); assert.equal(old.card?.sourceOriginalText, undefined);
    await f.reopen();
    const before = { ...f.count }; const submitted = await f.service.retry(old.id), repaired = await f.finish(old.id);
    assert.equal(submitted.attempt, old.attempt + 1); assert.equal(repaired.status, 'completed');
    assert.equal(repaired.assetId, old.assetId); assert.equal(repaired.card?.url, old.card?.url);
    assert.deepEqual(repaired.card?.transcript, []); assert.deepEqual(repaired.asr, originalAsr);
    assert.deepEqual(f.service.libraryState.transcripts, originalTranscripts);
    assert.equal(repaired.card?.sourceOriginalText, fullText); assert.equal(Object.hasOwn(repaired.card!, 'body'), false);
    assert.equal(f.count.download, before.download); assert.equal(f.count.import, before.import);
    assert.equal(f.count.transcribe, before.transcribe); assert.equal(f.count.detect, before.detect); assert.equal(f.count.resolve, before.resolve + 1);
    assert.equal(f.source().originalText, sharing); assert.equal('sourceOnly' in repaired, false);
    await f.reopen(); assert.equal(f.source().postText, fullText); assert.equal(f.task(old.id).card?.sourceOriginalText, fullText);
  } finally { await f.clean(); }
});

test('source-only access failure keeps playable media and ASR while a share URL never becomes post text', async () => {
  const f = await setup({ legacy: true, audio: true, resolve: async () => { throw new Error('公开原帖暂不可访问'); } });
  try {
    const old = await f.finish(f.submit().id), transcripts = f.service.libraryState.transcripts, before = { ...f.count };
    await f.service.retry(old.id); const result = await f.finish(old.id);
    assert.equal(result.status, 'completed'); assert.equal(result.assetId, old.assetId); assert.equal(result.card?.url, old.card?.url);
    assert.deepEqual(await fs.readFile(path.join(f.directory, 'media', 'fixture.mp4')), bytes);
    assert.deepEqual(f.service.libraryState.transcripts, transcripts); assert.equal(f.count.download, before.download);
    assert.equal(f.count.import, before.import); assert.equal(f.count.transcribe, before.transcribe);
    assert.equal(result.card?.sourceOriginalText, undefined); assert.notEqual(result.card?.sourceOriginalText, sharing);
    assert.match(String(result.card?.sourceStatus), /尚未取得.*视频已保留.*不可访问/);
    assert.match(result.message, /正文暂未补齐/); assert.equal(f.source().postTextStatus, 'unavailable');
    await f.reopen(); assert.equal(f.source().postTextStatus, 'unavailable'); assert.equal(f.task(old.id).card?.sourceOriginalText, undefined);
  } finally { await f.clean(); }
});

test('partial X text remains marked partial and can become complete through a source-only retry', async () => {
  const f = await setup({ text: '只有预览', completeness: 'partial' });
  try {
    const old = await f.finish(f.submit().id); assert.equal(old.card?.sourceOriginalText, '只有预览');
    assert.match(String(old.card?.sourceStatus), /预览/); const before = { ...f.count };
    await f.service.retry(old.id); const updated = await f.finish(old.id);
    assert.equal(updated.card?.sourceOriginalText, fullText); assert.equal(f.source().postTextStatus, 'complete');
    assert.equal(f.source().postTextError, undefined); assert.equal(f.count.download, before.download); assert.equal(f.count.import, before.import);
  } finally { await f.clean(); }
});

test('cancelled source-only refresh cannot commit a late resolver result or restart media processing', async () => {
  let release!: (value: XPost) => void, resolving = false, calls = 0;
  const f = await setup({ legacy: true, audio: true, resolve: async () => { calls++; if (calls > 1) return post(); resolving = true; return new Promise(resolve => { release = resolve; }); } });
  try {
    const old = await f.finish(f.submit().id), before = { ...f.count };
    await f.service.retry(old.id); await until(() => resolving);
    const cancelled = f.service.cancel(old.id); release(post()); await cancelled; const result = await f.finish(old.id);
    assert.equal(result.status, 'cancelled'); assert.equal(f.source().postText, undefined);
    assert.equal(f.count.download, before.download); assert.equal(f.count.import, before.import); assert.equal(f.count.transcribe, before.transcribe);
    assert.equal(result.assetId, old.assetId); assert.equal(result.card?.sourceOriginalText, undefined);
    await f.reopen(); await f.service.retry(old.id); const resumed = await f.finish(old.id);
    assert.equal(resumed.status, 'completed'); assert.equal(resumed.card?.sourceOriginalText, fullText);
    assert.equal(f.count.download, before.download); assert.equal(f.count.import, before.import); assert.equal(f.count.transcribe, before.transcribe);
  } finally { await f.clean(); }
});

test('closing a source-only refresh persists its mode so a normal reopen repairs text without repeating empty ASR', async () => {
  let resolving = false, calls = 0;
  const f = await setup({ legacy: true, audio: true, resolve: async (_url, options) => {
    calls++; if (calls > 1) return post(); resolving = true;
    return new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(new Error('controlled source cancellation')), { once: true }));
  } });
  try {
    const old = await f.finish(f.submit().id), before = { ...f.count }, transcripts = f.service.libraryState.transcripts;
    await f.service.retry(old.id); await until(() => resolving); await f.service.close();
    await f.reopen(); assert.equal(f.task(old.id).status, 'interrupted'); assert.equal(f.source().postText, undefined);
    await f.service.retry(old.id); const resumed = await f.finish(old.id);
    assert.equal(resumed.status, 'completed'); assert.equal(resumed.card?.sourceOriginalText, fullText);
    assert.deepEqual(f.service.libraryState.transcripts, transcripts); assert.equal(f.count.download, before.download);
    assert.equal(f.count.import, before.import); assert.equal(f.count.transcribe, before.transcribe); assert.deepEqual(resumed.asr, old.asr);
  } finally { await f.clean(); }
});

test('source-only repair cannot silently redownload an unavailable cached media file', async () => {
  const f = await setup({ legacy: true });
  try {
    const old = await f.finish(f.submit().id), before = { ...f.count };
    const media = path.resolve(f.directory, 'media', 'fixture.mp4'); assert.equal(path.dirname(media), path.join(f.directory, 'media'));
    await fs.rm(media);
    await f.service.retry(old.id); const result = await f.finish(old.id);
    assert.equal(result.status, 'failed'); assert.match(result.message, /视频文件已缺失.*未重新下载/);
    assert.equal(f.count.download, before.download); assert.equal(f.count.import, before.import); assert.equal(f.count.resolve, before.resolve);
    assert.equal(result.card?.sourceOriginalText, undefined);
  } finally { await f.clean(); }
});

test('complete pure-video X posts with genuinely empty text do not repeatedly try to fetch a missing body', async () => {
  const f = await setup({ text: '' });
  try {
    const done = await f.finish(f.submit().id);
    assert.equal(f.source().postText, ''); assert.equal(f.source().postTextStatus, 'complete');
    assert.equal(done.card?.sourceOriginalText, ''); assert.match(String(done.card?.sourceStatus), /没有文字正文.*核对/);
    const unchanged = await f.service.retry(done.id); assert.equal(unchanged.status, 'completed'); assert.equal(unchanged.attempt, done.attempt);
    assert.equal(f.count.resolve, 0); assert.equal(f.count.download, 1);
  } finally { await f.clean(); }
});

test('non-X source original-sharing semantics and normal failed-ASR retries stay unchanged', async () => {
  const f = await setup({ inputUrl: 'https://www.bilibili.com/video/BV1bK411W797', audio: true, failAsrOnce: true });
  try {
    const failed = await f.finish(f.submit().id); assert.equal(failed.status, 'failed'); assert.ok(failed.assetId);
    await f.service.retry(failed.id); const done = await f.finish(failed.id);
    assert.equal(done.status, 'completed'); assert.equal(done.card?.sourceOriginalText, sharing); assert.equal(f.source().originalText, sharing);
    assert.equal(f.source().postText, undefined); assert.equal(f.count.resolve, 0); assert.equal(f.count.download, 1);
    assert.equal(f.count.import, 1); assert.equal(f.count.transcribe, 2);
  } finally { await f.clean(); }
});

test('failed X ASR still resumes ASR after backfilling source instead of becoming a source-only task', async () => {
  const f = await setup({ legacy: true, audio: true, failAsrOnce: true });
  try {
    const failed = await f.finish(f.submit().id); assert.equal(failed.status, 'failed');
    await f.service.retry(failed.id); const done = await f.finish(failed.id);
    assert.equal(done.status, 'completed'); assert.equal(done.card?.sourceOriginalText, fullText);
    assert.equal(f.count.download, 1); assert.equal(f.count.import, 1); assert.equal(f.count.resolve, 1); assert.equal(f.count.transcribe, 2);
  } finally { await f.clean(); }
});
