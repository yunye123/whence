import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { VideoImportService, type VideoImportServiceOptions } from '../native/video-import-service';
import { dropFilePaths, readClipboardFiles } from '../native/clipboard-files';
import type { MediaOptions } from '../../electron/media';

const base = path.resolve('output/quality-20261003');
const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 116, 101, 115, 116]);
const input = { boardId: 'board', nodeId: 'video', name: '本地片段.mp4', data: bytes };
const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) { assert.ok(Date.now() < deadline, 'local task did not reach the expected state'); await delay(10); }
}
async function fixture() {
  await fs.mkdir(base, { recursive: true }); const directory = await fs.mkdtemp(path.join(base, 'local-transcribe-test-'));
  return { directory, async clean() {
    const resolved = path.resolve(directory); assert.equal(path.dirname(resolved), base); assert.ok(path.basename(resolved).startsWith('local-transcribe-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  } };
}
function stubOptions(directory: string, overrides: Partial<VideoImportServiceOptions> = {}): VideoImportServiceOptions {
  return { directory,
    download: async () => { throw new Error('local transcription must not request a network download'); },
    importMedia: async (file, project) => {
      const data = await fs.readFile(file), digest = createHash('sha256').update(data).digest('hex');
      const relative = `media/stub-${digest}.mp4`; await fs.mkdir(path.join(project, 'media'), { recursive: true }); await fs.writeFile(path.join(project, relative), data);
      return { name: path.basename(file), kind: 'video', path: relative, hash: digest, durationMs: 2000, hasAudio: true, width: 320, height: 180, thumbnails: [] };
    },
    detectTools: async () => ({ python: 'test-stub', ffmpeg: 'test-stub', ffprobe: 'test-stub', model: 'test-stub', downloader: false, checks: [] }),
    transcribeMedia: async () => ({ engine: 'test-stub', device: 'test-stub', elapsedSeconds: 0, segments: [{ id: 'stub-segment', startMs: 0, endMs: 1000, text: '测试替身文本', words: [] }] }),
    ...overrides,
  };
}
function abortable(options: MediaOptions): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (options.signal?.aborted) { reject(options.signal.reason); return; }
    options.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
  });
}

test('opening the local service creates no task or media until explicit local submission', async () => {
  const temporary = await fixture(); const service = await VideoImportService.open(stubOptions(temporary.directory));
  try {
    await delay(20); assert.deepEqual(service.list(), []); assert.equal(service.libraryState.assets.length, 0); assert.equal(service.libraryState.transcripts.length, 0);
    const task = await service.submitLocal(input); assert.equal(task.status, 'queued');
    assert.equal(task.platform, '本机视频'); assert.equal(task.originalText, input.name);
    assert.equal((task as unknown as Record<string, unknown>).localFile, undefined);
    await waitFor(() => service.list()[0]?.status === 'completed');
    assert.equal(service.libraryState.assets.length, 1); assert.equal(service.libraryState.sources.length, 0);
    assert.equal(service.list()[0].card?.transcript?.[0].text, '测试替身文本');
    assert.equal(service.list()[0].card?.sourceUrl, undefined);
    assert.equal(service.list()[0].asr?.engine, 'test-stub');
  } finally { await service.close(); await temporary.clean(); }
});

test('sequential duplicate clicks reuse one active task and one completed transcript', async () => {
  const temporary = await fixture(); let started = false;
  const service = await VideoImportService.open(stubOptions(temporary.directory, { transcribeMedia: async (_asset, _project, _tools, options = {}) => { started = true; return abortable(options); } }));
  try {
    const first = await service.submitLocal(input); await waitFor(() => started);
    const second = await service.submitLocal(input); assert.equal(second.id, first.id); assert.equal(service.list().length, 1); assert.equal(service.libraryState.assets.length, 1);
    await service.cancel(first.id); assert.equal(service.list()[0].status, 'cancelled');
  } finally { await service.close(); await temporary.clean(); }
});

test('simultaneous clicks on the same local video resolve to one task without EEXIST or duplicate work', async () => {
  const temporary = await fixture(); const service = await VideoImportService.open(stubOptions(temporary.directory));
  try {
    const results = await Promise.allSettled([service.submitLocal(input), service.submitLocal(input)]);
    assert.ok(results.every(result => result.status === 'fulfilled'), JSON.stringify(results.map(result => result.status === 'rejected' ? String(result.reason) : result.value.id)));
    const tasks = results.map(result => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof service.submitLocal>>>).value);
    assert.equal(tasks[0].id, tasks[1].id); assert.equal(service.list().length, 1);
    await waitFor(() => service.list()[0]?.status === 'completed'); assert.equal(service.libraryState.assets.length, 1);
  } finally { await service.close(); await temporary.clean(); }
});

test('local tasks run serially and cancelling a queued task never starts its media processing', async () => {
  const temporary = await fixture(); let firstStarted = false, importCount = 0;
  const defaults = stubOptions(temporary.directory);
  const service = await VideoImportService.open(stubOptions(temporary.directory, {
    importMedia: async (...args) => { importCount++; return defaults.importMedia!(...args); },
    transcribeMedia: async (_asset, _project, _tools, options = {}) => { firstStarted = true; return abortable(options); },
  }));
  try {
    const first = await service.submitLocal(input); await waitFor(() => firstStarted);
    const queued = await service.submitLocal({ ...input, nodeId: 'second', data: new Uint8Array([...bytes, 1]) });
    assert.equal(queued.status, 'queued'); assert.equal(importCount, 1);
    await service.cancel(queued.id); await service.cancel(first.id); await delay(20);
    assert.equal(importCount, 1); assert.equal(service.libraryState.assets.length, 1); assert.ok(service.list().every(task => task.status === 'cancelled'));
  } finally { await service.close(); await temporary.clean(); }
});

test('retrying local transcription reuses its saved asset and increments the attempt without reimporting', async () => {
  const temporary = await fixture(); let transcriptions = 0, imports = 0;
  const defaults = stubOptions(temporary.directory);
  const service = await VideoImportService.open(stubOptions(temporary.directory, {
    importMedia: async (...args) => { imports++; return defaults.importMedia!(...args); },
    transcribeMedia: async (...args) => { if (++transcriptions === 1) throw new Error('test-stub transient failure'); return defaults.transcribeMedia!(...args); },
  }));
  try {
    const first = await service.submitLocal(input); await waitFor(() => service.list()[0]?.status === 'failed');
    const savedAsset = service.list()[0].assetId; assert.ok(savedAsset);
    const retry = await service.submitLocal(input); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
    await waitFor(() => service.list()[0]?.status === 'completed');
    assert.equal(imports, 1); assert.equal(transcriptions, 2); assert.equal(service.list()[0].assetId, savedAsset);
    const duplicate = await service.submitLocal(input); assert.equal(duplicate.id, first.id); assert.equal(duplicate.status, 'completed'); assert.equal(duplicate.attempt, 2);
    assert.equal(service.libraryState.transcripts.length, 1);
  } finally { await service.close(); await temporary.clean(); }
});

test('closing during transcription leaves an interrupted local task that resumes only after a new explicit submission', async () => {
  const temporary = await fixture(); let started = false; let service = await VideoImportService.open(stubOptions(temporary.directory, { transcribeMedia: async (_asset, _project, _tools, options = {}) => { started = true; return abortable(options); } }));
  try {
    const first = await service.submitLocal(input); await waitFor(() => started); const assetId = service.list()[0].assetId;
    await service.close(); service = await VideoImportService.open(stubOptions(temporary.directory));
    await delay(20); assert.equal(service.list()[0].status, 'interrupted'); assert.equal(service.hasActiveTasks, false); assert.equal(service.libraryState.transcripts.length, 0);
    const resumed = await service.submitLocal(input); assert.equal(resumed.id, first.id); assert.equal(resumed.attempt, 2);
    await waitFor(() => service.list()[0]?.status === 'completed'); assert.equal(service.list()[0].assetId, assetId); assert.equal(service.libraryState.assets.length, 1);
    await service.close(); service = await VideoImportService.open(stubOptions(temporary.directory));
    assert.equal(service.list()[0].status, 'completed'); assert.equal((await service.submitLocal(input)).id, first.id); assert.equal(service.libraryState.transcripts.length, 1);
  } finally { await service.close(); await temporary.clean(); }
});

test('invalid local input is rejected without creating a task and close forbids new submissions', async () => {
  const temporary = await fixture(); const service = await VideoImportService.open(stubOptions(temporary.directory));
  try {
    for (const invalid of [{ ...input, data: new Uint8Array() }, { ...input, name: '' }, { ...input, boardId: '' }, { ...input, nodeId: 'bad\0id' }]) await assert.rejects(service.submitLocal(invalid));
    assert.equal(service.list().length, 0); await service.close(); await assert.rejects(service.submitLocal(input), /退出/);
  } finally { await service.close(); await temporary.clean(); }
});

function hdrop(paths: string[], wide = true) {
  const header = Buffer.alloc(20); header.writeUInt32LE(20, 0); header.writeUInt32LE(wide ? 1 : 0, 16);
  return Buffer.concat([header, Buffer.from(`${paths.join('\0')}\0\0`, wide ? 'utf16le' : 'latin1')]);
}

test('CF_HDROP parsing preserves Chinese names, spaces and ANSI paths and rejects malformed offsets', () => {
  const names = ['D:\\素材库\\课堂 视频.mp4', 'C:\\Users\\测试\\参考图.png'];
  assert.deepEqual(dropFilePaths(hdrop(names)), names);
  assert.deepEqual(dropFilePaths(hdrop(['D:\\clips\\a.mp4'], false)), ['D:\\clips\\a.mp4']);
  assert.deepEqual(dropFilePaths(Buffer.alloc(19)), []);
  for (const offset of [0, 19, 900]) {
    const broken = hdrop(names); broken.writeUInt32LE(offset, 0); assert.deepEqual(dropFilePaths(broken), []);
  }
  assert.equal(dropFilePaths(hdrop(Array.from({ length: 30 }, (_, index) => `D:\\${index}.mp4`))).length, 21, 'one extra entry permits the reader to reject excessive batches');
});

test('a mock native file clipboard reads actual isolated video bytes once and reports unsupported/missing files separately', async () => {
  const temporary = await fixture();
  try {
    const video = path.join(temporary.directory, '中文 视频.MP4'), unsupported = path.join(temporary.directory, 'unsupported.exe'), missing = path.join(temporary.directory, 'missing.mp4');
    await fs.writeFile(video, bytes); await fs.writeFile(unsupported, 'test fixture only');
    const result = await readClipboardFiles({ availableFormats: () => ['FileDrop'], readBuffer: () => hdrop([video, video, unsupported, missing]), readText: () => '伴随的文本' });
    assert.equal(result.files.length, 1); assert.equal(result.files[0].name, '中文 视频.MP4'); assert.equal(result.files[0].mime, 'video/mp4'); assert.deepEqual(result.files[0].data, bytes);
    assert.equal(result.text, '伴随的文本'); assert.equal(result.failures.length, 2); assert.ok(result.failures.some(message => message.includes('暂不支持')));
  } finally { await temporary.clean(); }
});

test('the async clipboard API accepts file URI entries and a native image fallback without touching the system clipboard', async () => {
  const temporary = await fixture();
  try {
    const video = path.join(temporary.directory, '片段.webm'); await fs.writeFile(video, bytes);
    const result = await readClipboardFiles({ read: async () => [{ types: ['text/uri-list'], getType: async () => new Blob([`# comment\n${pathToFileURL(video).href}\nhttps://example.com/ignored.mp4`]) }], readText: async () => '' });
    assert.equal(result.files.length, 1); assert.equal(result.files[0].mime, 'video/webm'); assert.deepEqual(result.files[0].data, bytes);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const image = await readClipboardFiles({ readText: () => '', readImage: () => ({ isEmpty: () => false, toPNG: () => png }) });
    assert.equal(image.files[0].name, '剪贴板图片.png'); assert.equal(image.files[0].mime, 'image/png'); assert.deepEqual(image.files[0].data, new Uint8Array(png));
  } finally { await temporary.clean(); }
});

test('clipboard batches and text limits reject explicitly; empty files and oversized text files stay out of cards', async () => {
  const temporary = await fixture();
  try {
    await assert.rejects(readClipboardFiles({ availableFormats: () => ['CF_HDROP'], readBuffer: () => hdrop(Array.from({ length: 21 }, (_, index) => path.join(temporary.directory, `${index}.mp4`))), readText: () => '' }), /20/);
    await assert.rejects(readClipboardFiles({ readText: () => '字'.repeat(300_001) }), /300,000/);
    const empty = path.join(temporary.directory, 'empty.mp4'), large = path.join(temporary.directory, 'large.md'); await fs.writeFile(empty, ''); await fs.writeFile(large, Buffer.alloc(4 * 1024 * 1024 + 1));
    const result = await readClipboardFiles({ availableFormats: () => ['CF_HDROP'], readBuffer: () => hdrop([empty, large]), readText: () => '' });
    assert.equal(result.files.length, 0); assert.equal(result.failures.length, 2); assert.ok(result.failures.every(message => message.includes('为空或超过')));
  } finally { await temporary.clean(); }
});
