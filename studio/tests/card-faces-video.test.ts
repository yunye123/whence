import test from 'node:test';
import assert from 'node:assert/strict';

import { assertNone, attr, closest, getBy, getByLabel, isButton, isDisabled, textContent } from './helpers/markup';
import { render, video, film } from './helpers/card-faces';

test('example films play in the card; older demo cards only open details; media cards keep header and footer', () => {
  const sample = render(film.data, {}, film.id);
  const play = getByLabel(sample, `播放：${film.data.title}`);
  assert.ok(isButton(play) && closest(play, { className: 'card-drag-content' }));
  assertNone(sample, { text: '示例素材' }, 'no badge over the picture');
  assert.match(textContent(sample), /逐字稿 23 句/);
  const legacy = render({ kind: 'video', title: '旧示例', body: '', demo: true, poster: '/assets/scene-morning.svg', transcript: [] });
  assertNone(legacy, { label: /^播放：/ });
  assert.ok(isButton(getByLabel(legacy, '阅读示例：旧示例')));
  const image = render({ kind: 'image', title: '车窗', body: '', poster: '/assets/samples/c-window.webp', demo: true });
  getBy(image, { tag: 'header' });
  getBy(image, { tag: 'footer' });
  assertNone(image, { text: '示例素材' });
});

test('import states say each thing once: progress while it runs, one retry when it stopped (IM-M2, K3)', () => {
  const task = { attemptId: 'a', url: 'https://www.douyin.com/video/1', originalText: '', message: '正在下载', mediaReady: false, createdAt: '', updatedAt: '' };
  const running = render({ kind: 'video', title: '新城的早上', body: '', transcript: [], videoImport: { ...task, status: 'downloading', progress: 34 } }, {}, 'v1');
  getBy(running, { testId: 'card-video-import-v1' });
  assert.equal(attr(getBy(running, { role: 'progressbar' }), 'aria-valuenow'), '34');
  assert.ok(isButton(getByLabel(running, '取消视频导入：新城的早上')));
  assert.equal((textContent(running).match(/34%/g) ?? []).length, 1, 'the percentage appears once');
  assert.match(textContent(running), /抖音/);
  const failed = render({ kind: 'video', title: '凌晨四点的早餐摊', body: '', transcript: [], videoImport: { ...task, status: 'failed', error: '链接打不开。' } }, { videoImportAvailable: false }, 'v2');
  assert.match(textContent(getBy(failed, { tag: 'h3' })), /^导入未完成：凌晨四点的早餐摊$/);
  const retry = getByLabel(failed, '重试视频导入：凌晨四点的早餐摊');
  assert.ok(isDisabled(retry), 'the browser build cannot retry and says why');
  assert.match(textContent(failed), /需要桌面版/);
  assert.equal((textContent(failed).match(/链接打不开/g) ?? []).length, 1);
});

test('a playing card offers “收起视频”; read-only and hand-tool cards expose no connection or editing affordance', () => {
  const playing = render({ ...film.data }, { activeVideo: film.id }, film.id);
  assert.ok(isButton(getByLabel(playing, '收起视频')));
  getBy(playing, { tag: 'video' });
  const readOnly = render({ kind: 'note', title: '笔记', body: '先讲一个具体的人。' }, { readOnly: true });
  assertNone(readOnly, { label: /^编辑笔记：/ });
  assert.ok(isButton(getByLabel(readOnly, '展开阅读：笔记')));
});
