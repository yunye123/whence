import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { render, film } from './helpers/card-faces';
import { getBy, queryAll, textContent, attr } from './helpers/markup';
import { VideoCardFooter, videoExcerptBands, planVideoTranscript } from '../src/cards/VideoCardBody';
import type { CardActions } from '../src/board-context';
import type { TranscriptLine } from '../src/model';

test('video v2: one band per excerpt, no sentence/second rail DOM', () => {
  const marks = [{ quoteId: 'q1', start: 6, end: 18 }, { quoteId: 'q2', start: 8, end: 20 }];
  const html = render(film.data, { excerptMarks: () => marks });
  assert.equal(queryAll(html, { className: 'field-card__rail-band' }).length, marks.length);
  getBy(html, { className: 'field-card__archive' });
  getBy(html, { tag: 'header' }); getBy(html, { tag: 'footer' });
  assert.deepEqual(videoExcerptBands(100, marks).map(band => band.quoteId), ['q1', 'q2']);
});

test('video v2: six mutually exclusive status slots and archive transcription action', () => {
  const board = { getVideoPlayback: () => ({ time: 12, paused: true }), playVideo() {}, nativeTranscribeAvailable: true } as unknown as CardActions;
  const props = { id: 'v', data: film.data, board, activate() {}, openCard() {}, platform: '示例短片', activeVideo: false, playing: false, currentTime: 12, playable: true, mediaMissing: false };
  const task = { attemptId: 'a', url: 'https://example.com', originalText: '', message: '', mediaReady: false, createdAt: '', updatedAt: '' };
  const cases: Array<[Partial<ComponentProps<typeof VideoCardFooter>>, string]> = [
    [{ activeVideo: true }, '已暂停 00:12'],
    [{ data: { ...film.data, videoImport: { ...task, status: 'downloading' as const, progress: 34 } } }, '下载中 34%'],
    [{ data: { ...film.data, videoImport: { ...task, status: 'failed' as const } } }, '导入未完成'],
    [{ board: { ...board, transcriptionMessage: () => '正在生成逐字稿' } }, '正在生成逐字稿'],
    [{}, '逐字稿 23 句'],
    [{ data: { ...film.data, transcript: [] } }, ''],
  ];
  for (const [changes, expected] of cases) {
    const html = renderToStaticMarkup(createElement(VideoCardFooter, { ...props, ...changes }));
    assert.equal(textContent(getBy(html, { className: 'field-card__status-slot' })).replace('收起视频', '').trim(), expected);
    assert.equal(queryAll(html, { className: 'field-card__status-slot' }).length, 1);
    assert.equal(queryAll(html, { className: 'field-card__meta-source' }).length, 0);
  }
  const html = render({ ...film.data, transcript: [] }, { nativeTranscribeAvailable: true });
  const archive = getBy(html, { className: 'field-card__archive' });
  assert.match(textContent(archive), /生成逐字稿/);
  const player = render(film.data, { activeVideo: 'v' }, 'v');
  assert.equal(attr(getBy(player, { tag: 'video' }), 'class'), 'nodrag nowheel nokey');
  assert.equal(attr(getBy(player, { tag: 'video' }), 'controls'), undefined);
  assert.equal(attr(getBy(player, { tag: 'video' }), 'autoplay'), undefined);
});

test('video v2: unavailable canvas defers transcript planning; never invents font widths', () => {
  assert.deepEqual(planVideoTranscript(film.data.transcript!, [{ quoteId: 'q', start: 72, end: 86 }], { font: '14px sans-serif', width: 226 }), []);
});

test('video v2: a two-hour transcript plus ten excerpts keeps the actual card DOM bounded', () => {
  const transcript: TranscriptLine[] = Array.from({ length: 1440 }, (_, i) => ({ id: `t${i}`, start: i * 5, end: i * 5 + 5, text: `第 ${i} 句原话，保留 English、空格和标点。` }));
  const marks = Array.from({ length: 10 }, (_, i) => ({ quoteId: `q${i}`, start: i * 700, end: i * 700 + 10 }));
  const html = render({ ...film.data, duration: 7200, transcript }, { excerptMarks: () => marks });
  const count = queryAll(html, {}).filter(el => el.tag !== 'wbr').length;
  assert.equal(queryAll(html, { className: 'field-card__rail-band' }).length, 10);
  assert.ok(count <= 85 && count <= 150, `${count} elements; conservatively retain the 57-element video baseline × 1.5`);
});
