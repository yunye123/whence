import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { VideoImportService, type VideoImportServiceOptions } from '../native/video-import-service';
import type { Diagnostics } from '../../shared/types';

const base = path.resolve('output/quality-20261003');
const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 116, 101, 115, 116]);
const names = ['Python', 'FFmpeg', 'ffprobe', '转写依赖', '本地模型', '链接下载器'];
function diagnostics(failed: string[]): Diagnostics {
  return {
    python: 'stub', ffmpeg: 'stub', ffprobe: 'stub', model: 'stub', downloader: !failed.includes('链接下载器'),
    checks: names.map(name => ({ name, ok: !failed.includes(name), detail: 'Error: spawn ENOENT' })),
  };
}
const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) { assert.ok(Date.now() < deadline, 'task did not finish'); await delay(10); }
}
async function open(failed: string[], overrides: Partial<VideoImportServiceOptions> = {}) {
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'transcription-gap-'));
  const count = { download: 0, import: 0, transcribe: 0 };
  const options: VideoImportServiceOptions = {
    directory,
    download: async () => { count.download++; throw new Error('本机视频下载工具未能启动。请打开侧栏「本机工具」，确认 Python 的位置后再试。'); },
    importMedia: async (file, project) => {
      count.import++;
      const data = await fs.readFile(file), digest = createHash('sha256').update(data).digest('hex');
      const relative = `media/stub-${digest}.mp4`;
      await fs.mkdir(path.join(project, 'media'), { recursive: true });
      await fs.writeFile(path.join(project, relative), data);
      return { name: path.basename(file), kind: 'video', path: relative, hash: digest, durationMs: 2000, hasAudio: true, width: 320, height: 180, thumbnails: [] };
    },
    detectTools: async () => diagnostics(failed),
    transcribeMedia: async () => { count.transcribe++; return { engine: 'stub', device: 'stub', elapsedSeconds: 0, segments: [] }; },
    ...overrides,
  };
  const service = await VideoImportService.open(options);
  return { directory, count, service, async clean() {
    await service.close();
    assert.equal(path.dirname(path.resolve(directory)), base);
    await fs.rm(directory, { recursive: true, force: true });
  } };
}

test('local transcription names a missing model and does not start the worker', async () => {
  const fixture = await open(['本地模型']);
  try {
    const task = await fixture.service.submitLocal({ boardId: 'board', nodeId: 'video', name: '本地片段.mp4', data: bytes });
    await waitFor(() => fixture.service.list()[0]?.status === 'failed');
    const done = fixture.service.list()[0];
    assert.equal(done.id, task.id);
    assert.equal(fixture.count.transcribe, 0);
    assert.equal(fixture.count.import, 1);
    assert.match(done.message, /视频已在画布上，还不能转写。缺 faster-whisper 模型。/);
    assert.match(done.message, /不会下载模型/);
    assert.match(done.message, /本机工具/);
    assert.equal(done.message.includes('ENOENT'), false);
    assert.equal(done.error, done.message);
    assert.equal(fixture.service.libraryState.assets.length, 1);
  } finally { await fixture.clean(); }
});

test('a missing ffprobe is explained before the file is probed', async () => {
  const fixture = await open(['ffprobe']);
  try {
    await fixture.service.submitLocal({ boardId: 'board', nodeId: 'video', name: '本地片段.mp4', data: bytes });
    await waitFor(() => fixture.service.list()[0]?.status === 'failed');
    const done = fixture.service.list()[0];
    assert.equal(fixture.count.import, 0);
    assert.equal(fixture.count.transcribe, 0);
    assert.match(done.message, /^缺 ffprobe。/);
    assert.match(done.message, /本机工具/);
    assert.equal(done.message.includes('ENOENT'), false);
    assert.equal(done.message.includes('执行失败'), false);
  } finally { await fixture.clean(); }
});

test('YouTube explains a missing yt-dlp before the downloader runs', async () => {
  const fixture = await open(['链接下载器']);
  try {
    const task = fixture.service.submit({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', originalText: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', boardId: 'board', nodeId: 'video' });
    await waitFor(() => fixture.service.list()[0]?.status === 'failed');
    assert.equal(fixture.count.download, 0);
    assert.match(fixture.service.list()[0].message, /^缺 yt-dlp。/);
    assert.match(fixture.service.list()[0].message, /本机工具/);
    assert.equal(fixture.service.list()[0].url, task.url);
  } finally { await fixture.clean(); }
});

test('Douyin still attempts the existing download and keeps that error text', async () => {
  const fixture = await open(['链接下载器']);
  try {
    const url = 'https://www.douyin.com/video/7123456789012345678';
    const task = fixture.service.submit({ url, originalText: url, boardId: 'board', nodeId: 'video' });
    await waitFor(() => fixture.service.list()[0]?.status === 'failed');
    const done = fixture.service.list()[0];
    assert.equal(fixture.count.download, 1);
    assert.equal(fixture.count.transcribe, 0);
    assert.match(done.message, /本机视频下载工具未能启动。请打开侧栏「本机工具」，确认 Python 的位置后再试。/);
    assert.equal(done.message.includes('缺 yt-dlp'), false);
    assert.equal(done.url, task.url);
  } finally { await fixture.clean(); }
});
