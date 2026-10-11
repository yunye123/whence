import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Inspector from '../src/Inspector';
import TranscriptPanel from '../src/inspector/TranscriptPanel';
import { BoardContext } from '../src/board-context';
import type { BoardActions } from '../src/board-context';
import type { BoardNode, TranscriptLine } from '../src/model';
import { formatDraftQuote } from '../src/draft-references';
import {
  clipText, clockLabel, collectedLabel, draftUses, lineIndexAt, lineMarks, neighbourLine, tidyCjkSpacing, transcriptTimeLabels, videoQuotes,
} from '../src/inspector/video-watch';
import { attr, getAllBy, getBy, getByRole, isDisabled, mentions, queryAll, textContent } from './helpers/markup';

// The watching workbench (DESIGN_SYSTEM §6.18.2): pure helpers that keep playback cheap (PV-M1), time codes
// unambiguous (PV-m1) and “来历” correct, plus render contracts: one Tab stop per sentence, the inline excerpt row keeps the
// drag source (K1), and proofreading progress is announced.

const lines: TranscriptLine[] = [
  { id: 'a', start: 0, end: 5.4, text: '凌晨四点，这条街上只有一盏灯是亮的。' },
  { id: 'b', start: 6, end: 12.2, text: '灯下是老周的早餐摊。' },
  { id: 'c', start: 13, end: 18.6, text: '他三点二十起床。' },
  { id: 'd', start: 19, end: 19.6, text: '豆浆用的是前一天晚上泡好的黄豆。', originalText: '豆浆用的是前一天泡好的黄豆。' },
  { id: 'e', start: 19.7, end: 24, text: '蒸笼一掀开，整条街都是白汽。' },
];

test('the current sentence is found by binary search and gaps have none', () => {
  assert.equal(lineIndexAt(lines, 0), 0);
  assert.equal(lineIndexAt(lines, 5.5), -1, 'between sentences there is no current one');
  assert.equal(lineIndexAt(lines, 6), 1);
  assert.equal(lineIndexAt(lines, 19.65), -1);
  assert.equal(lineIndexAt(lines, 19.7), 4);
  assert.equal(lineIndexAt(lines, 99), -1);
  assert.equal(lineIndexAt([], 3), -1);
  const unsorted = [lines[2], lines[0], lines[1]];
  assert.equal(lineIndexAt(unsorted, 7), 2, 'unsorted transcripts fall back to a scan');
});

test('previous and next sentence move by sentence, not by seconds', () => {
  assert.equal(neighbourLine(lines, 7, 1)?.id, 'c');
  assert.equal(neighbourLine(lines, 9, -1)?.id, 'b', 'past the first second, “previous” restarts the current sentence');
  assert.equal(neighbourLine(lines, 6.4, -1)?.id, 'a', 'within the first second it goes to the sentence before');
  assert.equal(neighbourLine(lines, 30, 1), undefined);
  assert.equal(neighbourLine(lines, 0, -1)?.id, 'a');
});

test('time codes switch to hours past an hour and add tenths only where neighbours share a second', () => {
  assert.equal(clockLabel(72.9), '01:12');
  assert.equal(clockLabel(3725), '1:02:05');
  assert.equal(clockLabel(65, true), '0:01:05');
  assert.deepEqual(transcriptTimeLabels(lines), ['00:00', '00:06', '00:13', '00:19.0', '00:19.7']);
  const long: TranscriptLine[] = [{ id: 'x', start: 59, end: 60, text: '一' }, { id: 'y', start: 3601, end: 3602, text: '二' }];
  assert.deepEqual(transcriptTimeLabels(long), ['0:00:59', '1:00:01']);
});

const video: BoardNode = { id: 'film', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'video', title: '凌晨四点的早餐摊', body: '', url: 'https://www.douyin.com/video/1', duration: 24, transcript: lines } };
const quoteOne: BoardNode = { id: 'q1', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '摘录 · 00:06', body: '', citation: { nodeId: 'film', title: '凌晨四点的早餐摊', start: 6, end: 18.6, text: '灯下是老周的早餐摊。 他三点二十起床。' } } };
const quoteTwo: BoardNode = { id: 'q2', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '摘录 · 00:00', body: '', citation: { nodeId: 'film', title: '凌晨四点的早餐摊', start: 0, end: 5.4, text: '凌晨四点，这条街上只有一盏灯是亮的。' } } };
const elsewhere: BoardNode = { id: 'q3', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '别的视频', body: '', citation: { nodeId: 'other', title: '别的', start: 1, end: 2, text: '别的' } } };
const draft: BoardNode = { id: 'draft', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'draft', title: '早餐摊 · 分镜脚本', body: `## 开场\n\n第一段，还没有引用。\n\n他说：${formatDraftQuote(quoteOne)}后面的话。`, draftVersions: [{ id: 'v1', title: '早餐摊', body: '旧稿', createdAt: '2026-10-02T00:00:00Z' }] } };

test('来历 lists the quotes of this film in film order and finds the draft paragraph that cites each', () => {
  const quotes = videoQuotes([video, quoteOne, elsewhere, quoteTwo, draft], 'film');
  assert.deepEqual(quotes.map(quote => quote.id), ['q2', 'q1']);
  assert.equal(quotes[1].label, '00:06–00:19', 'the end is rounded up');
  assert.equal(quotes[1].text, '灯下是老周的早餐摊。他三点二十起床。', 'spaces between captured Chinese lines are removed');
  const uses = draftUses([video, quoteOne, quoteTwo, draft], 'film', quotes);
  assert.equal(uses.has('q2'), false);
  const [use] = uses.get('q1')!;
  assert.equal(use.title, '早餐摊 · 分镜脚本');
  assert.equal(use.stage, '第二稿');
  assert.equal(use.paragraph, 3, 'the quoted block is the third paragraph: the heading does not count, “他说：” is its own block');
  assert.deepEqual(use.segments, [{ text: '灯下是老周的早餐摊。他三点二十起床。' }, { footnote: 1 }]);
  const marks = lineMarks(lines, quotes);
  assert.deepEqual(marks.map(mark => mark.used), [true, true, true, false, false]);
  assert.deepEqual(marks.map(mark => mark.usedStart), [true, true, false, false, false]);
});

test('helpers for spacing and the collected date', () => {
  assert.equal(tidyCjkSpacing('第一句。 第二句\n第三句 English words'), '第一句。第二句第三句 English words');
  assert.equal(collectedLabel('2026-10-03T08:00:00+08:00', new Date('2026-10-06T00:00:00+08:00')), '10 月 3 日采集');
  assert.equal(collectedLabel('2025-12-30T08:00:00+08:00', new Date('2026-10-06T00:00:00+08:00')), '2025 年 12 月 30 日采集');
  assert.equal(collectedLabel('not a date'), undefined);
  assert.equal(clipText('短句。'), '短句。');
  assert.equal(clipText('一二三四五，六七八九十。', 5), '一二三四五…', 'a long excerpt is cut to its opening, without a trailing comma');
});

const noop = () => {};
function actions(nodes: BoardNode[], overrides: Partial<BoardActions> = {}): BoardActions {
  return {
    updateCard: () => true, openCard: noop, deleteCard: noop, duplicateCard: noop, addQuote: () => true, addTextQuote: () => true, focusSource: noop,
    openDraftSource: () => true, draftReturn: null, returnToDraft: () => true, draftRestore: null, completeDraftRestore: noop,
    getMediaUrl: () => undefined, activeVideo: null, inspectedId: 'film', playVideo: noop,
    videoPlaybackVersion: 0, getVideoPlayback: () => ({ time: 0, paused: true }), bindVideoPlayer: noop, captureVideoPlayback: noop, restoreVideoPlayback: noop,
    setPendingTranscriptEdit: noop, cancelVideoImport: noop, retryVideoImport: noop, videoImportAvailable: true, videoImportActionPending: () => false,
    nodes, ...overrides,
  };
}

test('the workbench shows 来历, one Tab stop per sentence and proofreading progress', () => {
  const nodes = [video, quoteOne, quoteTwo, draft];
  const html = renderToStaticMarkup(createElement(BoardContext.Provider, { value: actions(nodes) }, createElement(Inspector, {
    node: video, onClose: noop, onImportSubtitles: noop, onNotify: noop,
  })));
  const origin = getBy(html, { role: 'region', name: /从这段视频摘出的句子/ });
  assert.ok(mentions(origin, '早餐摊 · 分镜脚本'));
  assert.match(textContent(origin), /写进第\s*3\s*段/);
  assert.equal(textContent(getBy(origin, { className: 'watch-origin__paragraph' })), '3');
  assert.match(textContent(origin), /还没写进文稿/, 'a quote that no draft cites says so');
  const backToFilm = getAllBy(origin, { role: 'button', name: /^回到原片 / });
  assert.deepEqual(backToFilm.map(button => attr(button, 'aria-label')), ['回到原片 00:00', '回到原片 00:06']);
  const list = getByRole(html, 'group', '视频字幕');
  assert.equal(queryAll(list, { attrs: { tabindex: '0' } }).length, lines.length, 'each complete sentence has one Tab stop');
  assert.deepEqual(queryAll(list, { className: 'watch-line__text' }).map(textContent), lines.map(line => line.text));
  assert.equal(getAllBy(list, { role: 'button', name: /^选择 \d\d:\d\d 的字幕$/ }).length, lines.length);
  assert.ok(mentions(list, '已摘录'));
  const progress = getBy(html, { role: 'progressbar', label: undefined, attrs: { 'aria-label': '校对进度' } });
  assert.equal(attr(progress, 'aria-valuenow'), '1');
  assert.equal(attr(progress, 'aria-valuemax'), String(lines.length));
});

function renderPanel(selected: string[], readOnly = false) {
  return renderToStaticMarkup(createElement(BoardContext.Provider, { value: actions([video], { readOnly }) }, createElement(TranscriptPanel, {
    nodeId: 'film', data: video.data, transcript: lines, query: '', setQuery: noop, selectedLines: new Set(selected), setSelectedLines: noop,
    lastSelected: null, setLastSelected: noop, currentTime: 0, setCurrentTime: noop, videoUrl: 'blob:film', mediaError: false,
    transcriptBusy: readOnly, transcriptProcessing: false, canRetryImport: false, exporting: false, setExporting: noop,
    runNativeTranscribe: async () => {}, onImportSubtitles: noop, setReplaceAction: noop, setEditingLine: noop, onNotify: noop,
  })));
}

test('the selection gets one inline row right under it; its excerpt button stays a drag source (K1)', () => {
  assert.equal(queryAll(renderPanel([]), { role: 'group', name: undefined, attrs: { 'aria-label': '所选句子' } }).length, 0);
  const html = renderPanel(['b', 'c']);
  const row = getBy(html, { attrs: { 'aria-label': '所选句子' } });
  assert.match(textContent(row), /已选\s*2\s*句/);
  assert.match(textContent(row), /00:06–00:19/);
  const excerpt = getByRole(row, 'button', '摘录到画布');
  assert.equal(attr(excerpt, 'draggable'), 'true');
  assert.equal(isDisabled(excerpt), false);
  assert.ok(getByRole(row, 'button', '复制所选'));
  const readOnly = getByRole(getBy(renderPanel(['b'], true), { attrs: { 'aria-label': '所选句子' } }), 'button', '摘录到画布');
  assert.ok(isDisabled(readOnly));
  assert.equal(attr(readOnly, 'draggable'), 'false');
});
