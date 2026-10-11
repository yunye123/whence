import test from 'node:test';
import assert from 'node:assert/strict';
import { findXPostSource, getStoredXPostText } from '../src/x-post-source';
import type { BoardNode } from '../src/model';

const url = 'https://x.com/akokoi1/status/2104200939095904322';
function video(data: Partial<BoardNode['data']> = {}): BoardNode {
  return { id: 'video', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'video', title: '本地视频', body: '自己的观看笔记', mediaId: 'local-video', sourceUrl: `${url}/video/1?s=20`, ...data } };
}
function link(id: string, data: Partial<BoardNode['data']> = {}): BoardNode {
  return { id, type: 'card', position: { x: 0, y: 0 }, data: { kind: 'link', title: '原帖', body: '导入时原文', url, sourceOriginalText: '导入时原文', sourceStatus: '由第三方 FxTwitter 取得；正文完整；原帖无图片', ...data } };
}
const legacyTask = { attemptId: 'legacy', url, originalText: `分享文案\n${url}?s=20`, status: 'completed' as const, message: '视频已下载', mediaReady: true, createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z' };

test('X video post snapshot retains raw punctuation, line breaks, emoji and final characters', () => {
  const raw = '开头。\r\n另一段🌿。\n最后一句不能丢。';
  assert.equal(getStoredXPostText(video({ sourceOriginalText: raw })), raw);
});

test('legacy share inputs and canonical or tracked post URLs are not post prose', () => {
  assert.equal(getStoredXPostText(video({ videoImport: legacyTask, sourceOriginalText: legacyTask.originalText.replace(/\n/g, '\r\n') })), undefined);
  assert.equal(getStoredXPostText(video({ sourceOriginalText: `${url}?s=20` })), undefined);
  assert.equal(getStoredXPostText(video({ sourceOriginalText: 'https://twitter.com/another_handle/status/2104200939095904322/video/1' })), undefined);
});

test('non X video never exposes generic sourceOriginalText even with an X tag', () => {
  assert.equal(getStoredXPostText(video({ sourceUrl: 'https://example.com/video.mp4', sourceOriginalText: '复制的分享输入', tags: ['X'] })), undefined);
  assert.equal(findXPostSource([link('unrelated')], video({ sourceUrl: 'https://example.com/video.mp4' })), undefined);
});

test('source matching uses status identity across handles, legacy domains and media suffixes without tags', () => {
  const original = link('same-post', { url: 'https://mobile.twitter.com/old_name/status/2104200939095904322/photo/1?s=20', tags: [] });
  const different = link('different-post', { url: 'https://x.com/akokoi1/status/999' });
  assert.equal(findXPostSource([different, original], video()), original);
});

test('ordinary saved URL cards and their user-written bodies cannot stand in for collected post text', () => {
  const generic = link('generic', { sourceOriginalText: undefined, sourceStatus: undefined, body: '我的原创备注' });
  assert.equal(getStoredXPostText(generic), undefined);
  assert.equal(findXPostSource([generic], video()), undefined);
});

test('a complete immutable capture wins over a newer partial capture and keeps user edits intact', () => {
  const complete = link('complete', { body: '用户已改写正文，仍应保留', sourceOriginalText: '完整原帖快照' });
  const partial = link('partial', { sourceOriginalText: '前几句预览', sourceStatus: '由第三方 FxTwitter 取得；仅取得正文预览，原帖可能还有内容' });
  const nodes = Object.freeze([complete, partial]);
  assert.equal(findXPostSource(nodes, video()), complete);
  assert.equal(getStoredXPostText(complete), '完整原帖快照');
  assert.equal(complete.data.body, '用户已改写正文，仍应保留');
});

test('when only previews exist the latest collected preview remains available with its status', () => {
  const first = link('first', { sourceStatus: '由第三方 FxTwitter 取得；仅取得正文预览' });
  const latest = link('latest', { sourceOriginalText: '更新预览', sourceStatus: '仅取得原帖正文预览，原帖可能还有内容。' });
  assert.equal(findXPostSource([first, latest], video()), latest);
});

test('confirmed empty text is distinct from an unavailable or unverified empty snapshot', () => {
  assert.equal(getStoredXPostText(video({ sourceOriginalText: '', sourceStatus: '原帖没有文字正文；已通过公开内容服务核对。' })), '');
  assert.equal(getStoredXPostText(video({ sourceOriginalText: '', sourceStatus: '原帖正文尚未取得，视频已保留。' })), undefined);
  assert.equal(getStoredXPostText(video({ sourceOriginalText: '' })), undefined);
  assert.equal(getStoredXPostText(link('empty', { sourceOriginalText: '', body: '' })), '');
});

test('legacy collected link body is usable only with a real collection record', () => {
  const retained = link('retained', { sourceOriginalText: undefined, body: '当时采集的全文' });
  assert.equal(getStoredXPostText(retained), '当时采集的全文');
  assert.equal(getStoredXPostText(link('unverified', { sourceOriginalText: undefined, sourceStatus: '正文完整', body: '未核实备注' })), undefined);
});
