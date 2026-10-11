import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Inspector from '../src/Inspector';
import { BoardContext } from '../src/board-context';
import type { BoardActions } from '../src/board-context';
import { formatDraftQuote } from '../src/draft-references';
import type { BoardNode } from '../src/model';
import { draftParagraphIndexAt } from '../src/source-location';
import { createExampleBoard } from '../src/templates';
import { buildScript, formatDuration, headingTime, isScriptLine, prefersScript, scriptTimeResolver } from '../src/inspector/script-view/script-model';
import type { ScriptLine } from '../src/inspector/script-view/script-model';
import { exportScriptMarkdown, scriptSummaryText } from '../src/inspector/script-view/script-export';
import { defaultDraftView, setDraftView, storedDraftView } from '../src/inspector/script-view/view-mode';
import { attr, getAllBy, getBy, getByRole, mentions, queryAll, textContent } from './helpers/markup';

// 脚本视图 (DESIGN_SYSTEM §6.29): the same Markdown body laid out as scenes and lines. These tests lock the split into
// scenes (## headings), the line numbers (the writing page's paragraph numbers), what a line's picture and words are,
// and how lengths are computed: a line from its timed excerpts, a scene from its heading's range or its lines, the
// film from its scenes. Nothing is stored: the body stays raw Markdown (K1).

const lines = (body: string, nodes: BoardNode[] = []) => buildScript(body, scriptTimeResolver(nodes)).scenes.flatMap(scene => scene.rows.filter(isScriptLine));
const words = (line: ScriptLine) => line.segments.map(segment => 'text' in segment ? segment.text : `[${segment.footnote}]`).join('');

function videoExample() {
  const board = createExampleBoard('video');
  const draft = board.nodes.find(node => node.data.kind === 'draft')!;
  return { board, draft };
}

test('the example script splits into its three scenes with the ranges written in the headings', () => {
  const { board, draft } = videoExample();
  const model = buildScript(draft.data.body, scriptTimeResolver(board.nodes));
  assert.deepEqual(model.scenes.map(scene => scene.title), ['开场', '展开', '结尾']);
  assert.deepEqual(model.scenes.map(scene => scene.heading), [{ start: 0, end: 43 }, { start: 43, end: 110 }, { start: 110, end: 140 }]);
  assert.deepEqual(model.scenes.map(scene => scene.duration), [43, 67, 30], 'a scene with a range lasts that range');
  assert.deepEqual(model.scenes.map(scene => scene.durationFrom), ['heading', 'heading', 'heading']);
  assert.equal(model.sceneCount, 3);
  assert.equal(model.lineCount, 9);
  assert.equal(model.total, 140);
  assert.equal(scriptSummaryText(model), '共 3 场 9 行，成片约 2:20');
  assert.equal(model.videoSources.length, 1, 'one film behind the whole script');
});

test('line numbers are the paragraph numbers the writing page shows, and lines read without Markdown or links', () => {
  const { board, draft } = videoExample();
  const body = draft.data.body;
  const all = lines(body, board.nodes);
  assert.deepEqual(all.map(line => line.number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const line of all) assert.equal(line.number, draftParagraphIndexAt(body, line.caret), `line ${line.number} is the paragraph its caret lands in`);
  for (const line of all) {
    const text = words(line);
    for (const hidden of ['field://', '](', '[来源', '> ', '##']) assert.equal(text.includes(hidden), false, `line ${line.number} never shows ${hidden}`);
  }
  assert.deepEqual(all.filter(line => line.label).map(line => line.number), [1, 3, 6, 7, 9], 'the “画面：” and “镜头：” paragraphs carry the label instead of the words');
  assert.equal(words(all[0]), '路口只有一盏灯，铁锅冒着白汽。不配乐，只留油锅和风声。');
  // The quotation spans two transcript lines: they flow as one sentence, the reference link becomes footnote 1.
  assert.equal(words(all[4]), '摊主说，四点出摊不是为了赚钱，是为了等头班公交的司机。[1]');
  assert.equal(all[4].kind, 'quote');
  assert.equal(body.slice(all[4].caret, all[4].caret + 3), '摊主说', 'the caret goes to the first word of the quotation, after “> ”');
});

test('a line’s picture is its timed excerpt and its length is the excerpt’s start to end', () => {
  const { board, draft } = videoExample();
  const all = lines(draft.data.body, board.nodes);
  const shot = all.filter(line => line.shots.length);
  assert.deepEqual(shot.map(line => line.number), [5, 8], 'the reference-only link lines fold into the quotation above (no row of their own)');
  assert.deepEqual(shot.map(line => [line.shots[0].start, line.shots[0].end, line.duration]), [[72, 86, 14], [98, 110, 12]]);
  assert.equal(shot[0].shots[0].reference, 1);
  assert.equal(shot[1].shots[0].reference, 2);
  assert.ok(all.filter(line => !line.shots.length).every(line => line.duration === undefined), 'no excerpt: no length (the view writes “—”)');
});

test('without a range in the heading a scene lasts the sum of its lines; with neither it has no length', () => {
  const video: BoardNode = { id: 'film-1', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'video', title: '样片', body: '' } };
  const quoteA: BoardNode = { id: 'quote-a', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '摘录 · 00:10', body: '', citation: { nodeId: video.id, title: '样片', text: '第一句。', start: 10, end: 16.4 } } };
  const quoteB: BoardNode = { id: 'quote-b', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '摘录 · 00:30', body: '', citation: { nodeId: video.id, title: '样片', text: '第二句。', start: 30, end: 38 } } };
  const nodes = [video, quoteA, quoteB];
  const body = ['## 第一场', '', `开头一句。${formatDraftQuote(quoteA)}`, `接着说。${formatDraftQuote(quoteB)}`, '## 第二场', '', '只有文字，没有画面。'].join('\n');
  const model = buildScript(body, scriptTimeResolver(nodes));
  const round = (value?: number) => value === undefined ? value : Math.round(value * 1000) / 1000;
  assert.deepEqual(model.scenes.map(scene => [scene.title, round(scene.duration), scene.durationFrom]), [['第一场', 14.4, 'shots'], ['第二场', undefined, undefined]]);
  assert.equal(round(model.total), 14.4);
  assert.equal(model.untimedScenes, 1);
  assert.equal(scriptSummaryText(model), '共 2 场 5 行，成片约 0:14（1 场未定）');
  // Without the board only the `t=` of the link is known: a start, no end, so a frame but no length.
  const bare = buildScript(body);
  assert.equal(bare.timedShots, 2);
  assert.equal(bare.total, undefined);
  assert.equal(scriptSummaryText(bare), '共 2 场 5 行，成片时长未定');
});

test('text excerpts stay footnotes; only film positions are pictures', () => {
  const article: BoardNode = { id: 'article-1', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'note', title: '一篇文章', tags: ['文字资料'], body: '第一段。\n\n第二段原文。' } };
  const quote: BoardNode = { id: 'quote-text', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '摘录 · 第 2 段', body: '', citation: { nodeId: article.id, title: article.data.title, text: '第二段原文。', textAnchor: { from: 6, to: 12, prefix: '', suffix: '' } } } };
  const [line] = lines(`我抄下一句：${formatDraftQuote(quote)}`, [article, quote]).filter(item => item.kind === 'quote');
  assert.equal(line.shots.length, 0);
  assert.equal(words(line), '第二段原文。[1]');
});

test('scene headings: ranges in any common writing come out of the title; a clock time mid-title stays', () => {
  assert.deepEqual(headingTime('开场 00:00–00:43'), { title: '开场', start: 0, end: 43 });
  assert.deepEqual(headingTime('开场（00:00 - 00:43）'), { title: '开场', start: 0, end: 43 });
  assert.deepEqual(headingTime('00:43~01:50 展开'), { title: '展开', start: 43, end: 110 });
  assert.deepEqual(headingTime('长镜头 1:02:03–1:05:00'), { title: '长镜头', start: 3723, end: 3900 });
  assert.deepEqual(headingTime('早上 7:10 的公交'), { title: '早上 7:10 的公交', start: 430 });
  assert.deepEqual(headingTime('倒放 02:20–01:50'), { title: '倒放', start: 140 }, 'an end before the start is not a range');
  assert.deepEqual(headingTime('没有时间'), { title: '没有时间' });
});

test('durations read like a film’s: m:ss, h:mm:ss past an hour', () => {
  assert.equal(formatDuration(14), '0:14');
  assert.equal(formatDuration(13.4), '0:13');
  assert.equal(formatDuration(140), '2:20');
  assert.equal(formatDuration(600), '10:00');
  assert.equal(formatDuration(3723), '1:02:03');
});

test('a reference with nothing to hang on becomes a picture-only line; headings below ## are beats, not lines', () => {
  const body = ['## 开场', '', '[来源：样片 00:05](field://node/film-1?t=5)', '', '### 一组空镜', '', '街口。', '', '[来源：样片 00:09](field://node/film-1?t=9)'].join('\n');
  const model = buildScript(body);
  const [scene] = model.scenes;
  assert.equal(scene.rows.length, 3);
  const [first, beat, last] = scene.rows;
  assert.ok(isScriptLine(first) && first.number === undefined && first.shots[0].start === 5, 'picture only, no paragraph number');
  assert.ok(!isScriptLine(beat) && beat.title === '一组空镜');
  assert.ok(isScriptLine(last) && last.number === 1 && last.shots[0].start === 9, 'the link line folds into “街口。”');
  assert.equal(model.lineCount, 2);
});

test('which drafts open in 脚本 by themselves', () => {
  const { draft } = videoExample();
  assert.equal(prefersScript(draft.data.body), true, 'the example script');
  const writing = createExampleBoard('writing').nodes.find(node => node.data.kind === 'draft')!;
  assert.equal(prefersScript(writing.data.body), false, 'the example article');
  const article = ['## 一', '', '城市的早晨。', '', '[来源：样片 00:05](field://node/film-1?t=5)', '', '## 二', '', '另一段。'].join('\n');
  assert.equal(prefersScript(article), false, 'sections and one quoted video do not make an article a script');
  const labelled = ['## 一', '', '画面：路口。', '', '[来源：样片 00:05](field://node/film-1?t=5)', '', '## 二', '', '镜头：车站。'].join('\n');
  assert.equal(prefersScript(labelled), true, 'labelled shots with a film position read as a script');
  assert.equal(prefersScript('只有一段。'), false);
});

test('the view choice is remembered per card and the first guess does not follow later typing', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } };
  try {
    const { draft } = videoExample();
    assert.equal(defaultDraftView('card-script', draft.data.body), 'script');
    assert.equal(defaultDraftView('card-script', '一段普通的文字。'), 'script', 'the guess is made once per card');
    assert.equal(defaultDraftView('card-plain', '一段普通的文字。'), 'body');
    setDraftView('card-script', 'body');
    assert.equal(storedDraftView('card-script'), 'body');
    assert.deepEqual(JSON.parse(store.get('field-draft-view-v1')!), { 'card-script': 'body' });
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test('the script table export: one table per scene, sources and time codes, no internal links', () => {
  const { board, draft } = videoExample();
  const markdown = exportScriptMarkdown(draft.data.title, draft.data.body, board.nodes);
  assert.ok(markdown.startsWith('# 早餐摊 · 分镜脚本\n\n共 3 场 9 行，成片约 2:20'));
  assert.match(markdown, /## 开场（00:00–00:43，时长 0:43）/);
  assert.equal((markdown.match(/\| # \| 画面 \| 旁白 \| 时长 \|/g) ?? []).length, 3);
  assert.match(markdown, /\| 5 \| 凌晨四点的早餐摊 01:12–01:26 \| 摊主说，四点出摊不是为了赚钱，是为了等头班公交的司机。¹ \| 0:14 \|/);
  // A “画面：” line without an excerpt describes the shot: 画面 column, no 旁白 (as on screen).
  assert.match(markdown, /\| 1 \| 路口只有一盏灯，铁锅冒着白汽。不配乐，只留油锅和风声。 \| — \| — \|/);
  assert.match(markdown, /## 来源\n\n1\. 凌晨四点的早餐摊 01:12–01:26：摊主说，四点出摊不是为了赚钱，是为了等头班公交的司机。/);
  assert.equal(markdown.includes('field://'), false);
});

function render(node: BoardNode, nodes: BoardNode[]) {
  const noop = () => {};
  const actions: BoardActions = {
    updateCard: () => true, openCard: noop, deleteCard: noop, duplicateCard: noop, addQuote: () => true, addTextQuote: () => true, focusSource: noop,
    openDraftSource: () => true, draftReturn: null, returnToDraft: () => true, draftRestore: null, completeDraftRestore: noop,
    getMediaUrl: () => undefined, activeVideo: null, inspectedId: node.id, playVideo: noop,
    videoPlaybackVersion: 0, getVideoPlayback: () => ({ time: 0, paused: true }), bindVideoPlayer: noop, captureVideoPlayback: noop, restoreVideoPlayback: noop,
    setPendingTranscriptEdit: noop, cancelVideoImport: noop, retryVideoImport: noop, videoImportAvailable: true, videoImportActionPending: () => false, nodes,
  };
  return renderToStaticMarkup(createElement(BoardContext.Provider, { value: actions }, createElement(Inspector, {
    node, onClose: noop, onImportSubtitles: noop, onNativeTranscribe: async () => {}, onNotify: noop,
  })));
}

test('the example script opens in 脚本: a table of scenes and lines, tags back to the film, the film’s length below', () => {
  const { board, draft } = videoExample();
  const html = render(draft, board.nodes);
  const group = getByRole(html, 'group', '文稿视图');
  assert.equal(attr(getByRole(group, 'button', '脚本'), 'aria-pressed'), 'true');
  assert.equal(attr(getByRole(group, 'button', '正文'), 'aria-pressed'), 'false');
  const table = getBy(html, { role: 'table' });
  assert.match(attr(table, 'aria-label') ?? '', /3 场，9 行/);
  assert.deepEqual(getAllBy(table, { role: 'columnheader' }).map(cell => textContent(cell)), ['#', '画面', '旁白', '时长']);
  assert.equal(getAllBy(table, { role: 'row' }).length, 1 + 3 + 9, 'header, three scene rows, nine lines');
  getByRole(table, 'button', '回到原片 01:12');
  getByRole(table, 'button', '回到原片 01:38');
  getByRole(table, 'button', '回到原片 00:00', { attrs: { title: /凌晨四点的早餐摊/ } });
  assert.equal(mentions(html, 'field://'), false);
  assert.equal(mentions(html, '口播'), false);
  const footer = textContent(getBy(html, { tag: 'footer' }));
  assert.match(footer, /共 3 场 9 行，成片约 2:20/);
});

test('an ordinary draft stays in 正文 with the reading estimate (K11) and offers the same switch', () => {
  const draft: BoardNode = { id: 'plain-draft', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'draft', title: '一篇文章', body: '第一段。\n\n第二段。' } };
  const html = render(draft, [draft]);
  assert.equal(attr(getByRole(getByRole(html, 'group', '文稿视图'), 'button', '正文'), 'aria-pressed'), 'true');
  assert.equal(queryAll(html, { role: 'table' }).length, 0, 'no script table in 正文 (positive control: the example script test)');
  assert.match(textContent(getBy(html, { tag: 'footer' })), /预计阅读/);
});
