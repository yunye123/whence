import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { downloadVideo, normalizeVideoInput, selectXVideo } from '../native/download';
import type { XPost } from '../shared/x-import';

const statusId = '2104200939095904322';
const statusUrl = `https://x.com/akokoi1/status/${statusId}`;
function post(media: XPost['media'] = [{ kind: 'video', url: 'https://video.twimg.com/test.mp4' }]): XPost {
  return { id: statusId, url: statusUrl, title: '物理之美', author: { name: 'WY', handle: 'akokoi1', url: 'https://x.com/akokoi1' },
    text: '完整的原始推文正文', provider: 'fxtwitter', contentKind: 'post', completeness: 'complete', warnings: [], media };
}

test('X and Twitter aliases normalize status identity, tracking and explicit video index', () => {
  for (const host of ['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']) {
    const input = `原文 https://${host}/akokoi1/status/${statusId}/video/2?s=20&t=tracking#hash 。`;
    const normalized = normalizeVideoInput(input);
    assert.equal(normalized.url, `${statusUrl}/video/2`);
    assert.equal(normalized.platform, 'X');
    assert.equal(normalized.key, `X:${statusId}:video:2`);
    assert.equal(normalized.xVideoIndex, 2);
    assert.equal(normalized.originalText, input);
  }
  assert.equal(normalizeVideoInput(`http://twitter.com/akokoi1/status/${statusId}?s=20`).url, statusUrl);
  assert.equal(normalizeVideoInput(statusUrl).key, `X:${statusId}:video:single`);
  assert.notEqual(normalizeVideoInput(statusUrl).key, normalizeVideoInput(`${statusUrl}/video/1?s=20`).key,
    'A bare multi-video post must not reuse a previously selected first video before resolution.');
  assert.notEqual(normalizeVideoInput(`${statusUrl}/video/1`).key, normalizeVideoInput(`${statusUrl}/video/2`).key);
  assert.equal(normalizeVideoInput(`https://x.com/i/web/status/${statusId}`).key, `X:${statusId}:video:single`);
});

test('X video route rejects articles, photos, malformed indexes and unrelated hosts', () => {
  for (const input of [
    'https://x.com/i/article/2104200939095904322', `${statusUrl}/photo/1`, `${statusUrl}/video/0`,
    `${statusUrl}/video/101`, `${statusUrl}/video/9007199254740993`, `${statusUrl}/video/no`,
    `${statusUrl}/video/2/extra`, 'https://x.com/akokoi1', 'https://x.com/home',
    `https://x.com.evil.example/akokoi1/status/${statusId}`, `https://evil.x.com/akokoi1/status/${statusId}`,
    `${statusUrl} https://x.com/other/status/100`,
  ]) assert.throws(() => normalizeVideoInput(input), input);
  assert.throws(() => normalizeVideoInput('https://x.com/i/article/2104200939095904322'), /文章.*X 素材导入/);
  assert.throws(() => normalizeVideoInput(`${statusUrl}/photo/1`), /图片.*X 素材导入/);
});

test('X selection requires a choice for several videos and never treats images as videos', () => {
  const image = { kind: 'image' as const, url: 'https://pbs.twimg.com/test.jpg' };
  const first = { kind: 'video' as const, url: 'https://video.twimg.com/one.mp4' };
  const second = { kind: 'gif' as const, url: 'https://video.twimg.com/two.mp4' };
  assert.equal(selectXVideo(post([image, first]), normalizeVideoInput(statusUrl)), first);
  assert.throws(() => selectXVideo(post([image, first, second]), normalizeVideoInput(statusUrl)), /2 个视频.*选择/);
  assert.equal(selectXVideo(post([image, first, second]), normalizeVideoInput(`${statusUrl}/video/2`)), second);
  assert.throws(() => selectXVideo(post([first]), normalizeVideoInput(`${statusUrl}/video/2`)), /只有 1 个视频.*第 2 个/);
  for (const contentKind of ['post', 'long-post', 'article'] as const) {
    assert.throws(() => selectXVideo({ ...post([image]), contentKind }, normalizeVideoInput(statusUrl)), /没有可用视频.*X 素材导入/);
  }
  assert.throws(() => selectXVideo({ ...post(), id: '100' }, normalizeVideoInput(statusUrl)), /与链接不一致/);
});

test('X video download keeps provenance on a rejected non-public media URL and cleans only its temporary download', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'field-x-download-'));
  try {
    let resolved = 0;
    await assert.rejects(downloadVideo(`${statusUrl}/video/1?s=20`, directory, {
      resolveXPost: async (input, options) => {
        resolved++; assert.equal(input, `${statusUrl}/video/1`); assert.ok(options.signal);
        return post([{ kind: 'video', url: 'http://127.0.0.1/private.mp4' }]);
      },
    }), (error: unknown) => {
      const failure = error as Error & { meta: Record<string, unknown> };
      assert.match(failure.message, /允许的公开服务范围/);
      assert.equal(failure.meta.platform, 'X'); assert.equal(failure.meta.title, '物理之美');
      assert.equal(failure.meta.author, 'WY (@akokoi1)'); assert.equal(failure.meta.contentId, statusId);
      assert.equal(failure.meta.url, `${statusUrl}/video/1`); assert.equal(failure.meta.status, 'failed');
      assert.equal(failure.meta.postText, '完整的原始推文正文'); assert.equal(failure.meta.postTextStatus, 'complete');
      assert.equal(failure.meta.originalText, `${statusUrl}/video/1?s=20`); assert.ok(failure.meta.postTextFetchedAt);
      return true;
    });
    assert.equal(resolved, 1);
    assert.deepEqual(await readdir(path.join(directory, 'cache', 'downloads')), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('X text-only posts fail with a material-import action and do not start a video tool', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'field-x-text-download-'));
  try {
    await assert.rejects(downloadVideo(statusUrl, directory, { resolveXPost: async () => post([]) }), /X 素材导入.*图文或长文/);
    assert.deepEqual(await readdir(path.join(directory, 'cache', 'downloads')), []);
    const controller = new AbortController(); controller.abort();
    let resolved = false;
    await assert.rejects(downloadVideo(statusUrl, directory, { signal: controller.signal, resolveXPost: async () => { resolved = true; return post(); } }), /已取消/);
    assert.equal(resolved, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
