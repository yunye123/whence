import test from 'node:test';
import assert from 'node:assert/strict';

import { type CardActions } from '../src/board-context';
import CanvasCard from '../src/CanvasCard';

import { CardData } from '../src/model';
import { approxCharacters, articleSummary, draftStage, hasNoteTitle, joinLines, lengthMarks, platformLabel, railKeyAt, railSegments, stationeryKind } from '../src/cards/card-utils';
import { mediaProblem, mediaProblemKind } from '../src/cards/MediaProblem';
import { wordPieces } from '../src/cards/Words';

import { noop, render, video } from './helpers/card-faces';
import { getBy, queryAll, textContent } from './helpers/markup';

test('known width invalidates the card memo while position and automatic height do not', () => {
  const compare = (CanvasCard as unknown as { compare: (a: object, b: object) => boolean }).compare;
  const props = { id: 'card', data: { kind: 'note', title: '笔记', body: '正文' }, selected: false, width: 290 };
  assert.equal(compare(props, { ...props, width: 220 }), false, 'a resize must reach W3 text planning');
  assert.equal(compare(props, { ...props, positionAbsoluteX: 100, height: 480 }), true, 'auto height cannot feed back into the text budget');
  assert.equal(compare(props, { ...props, selected: true }), false);
});

test('seven display materials retain stored field kinds, headers and exactly one in/out on ordinary cards', () => {
  const samples: Array<[CardData, string]> = [
    [{ kind: 'video', title: '原片', body: '' }, 'print'],
    [{ kind: 'note', title: '原文', body: '', tags: ['文字资料'] }, 'folder'],
    [{ kind: 'link', title: '网页', body: '网页上的原文。', url: 'https://example.com' }, 'folder'],
    [{ kind: 'quote', title: '摘录', body: '原话。' }, 'index'],
    [{ kind: 'draft', title: '稿子', body: '正文。' }, 'manuscript'],
    [{ kind: 'note', title: '笔记', body: '想法。' }, 'note'],
    [{ kind: 'image', title: '照片', body: '' }, 'photo'],
    [{ kind: 'frame', title: '参考', body: '' }, 'lighttable'],
  ];
  for (const [data, stationery] of samples) {
    assert.equal(stationeryKind(data), stationery);
    const html = render(data);
    const root = getBy(html, { tag: 'article', attrs: { 'data-stationery': stationery } });
    assert.equal(root.attrs['data-kind'], data.kind);
    assert.equal(queryAll(root, { tag: 'header' }).length, 1);
    if (data.kind === 'frame') continue;
    assert.equal(queryAll(root, { tag: 'footer' }).length, 1);
    assert.equal(queryAll(root, { label: '连接到这张卡片' }).length, 1);
    assert.equal(queryAll(root, { label: '从这张卡片连线' }).length, 1);
  }
});

test('only a user-named note shows its title; the hidden-title negative has a positive control', () => {
  const data: CardData = { kind: 'note', title: '观察街角', body: '保留这一句。' };
  const custom = getBy(render(data), { tag: 'h3' });
  assert.equal(textContent(custom), data.title);
  assert.ok(!custom.attrs.class?.split(' ').includes('sr-only'));
  for (const title of ['', '笔记', ' 笔记 ']) {
    const root = getBy(render({ ...data, title }), { tag: 'article' });
    assert.ok(!('data-has-title' in root.attrs));
    assert.ok(getBy(root, { tag: 'h3' }).attrs.class?.split(' ').includes('sr-only'));
  }
  assert.equal(hasNoteTitle({ ...data, tags: ['文字资料'] }), false);
});

test('a link receives UTF-16 excerpt marks on its body output rail', () => {
  const data: CardData = { kind: 'link', title: '来源', body: '原文内容保留。', url: 'https://example.com' };
  const html = render(data, { excerptMarks: () => [{ quoteId: 'q', from: 0, to: 4 }] });
  const rail = getBy(html, { className: 'field-card__length-rail' });
  assert.equal(queryAll(rail, { tag: 'span' }).length, 1);
  assert.equal(queryAll(rail, { label: '从这张卡片连线' }).length, 1);
  assert.equal(queryAll(getBy(render(data), { className: 'field-card__length-rail' }), { tag: 'span' }).length, 0);
});

test('card helpers: platform, counts, stages, summaries, rails and word break points', () => {
  assert.equal(platformLabel({ kind: 'video', title: '', body: '', sourceUrl: 'https://www.douyin.com/video/1' }), '抖音');
  assert.equal(platformLabel({ kind: 'video', title: '', body: '', url: '/assets/samples/breakfast-stall.mp4' }, true), '示例短片');
  assert.equal(platformLabel({ kind: 'video', title: '', body: '', mediaId: 'm' }), '本机视频');
  assert.equal(platformLabel({ kind: 'note', title: '', body: '', tags: ['文字资料', 'Markdown'] }), 'Markdown 文件');
  assert.equal(approxCharacters(406), '406 字');
  assert.equal(approxCharacters(6180), '约 6,200 字');
  assert.equal(approxCharacters(1863, 10), '约 1,860 字');
  assert.deepEqual([0, 1, 2, 11].map(draftStage), ['第一稿', '第二稿', '第三稿', '第 12 稿']);
  assert.equal(articleSummary({ title: '标题', body: '# 标题\n\n文 / 某人\n\n## 引子\n\n第一段**重点**。\n\n- 列表项' }), '第一段重点。列表项');
  // A TXT file: its title line with no blank line after it, full-width paragraph indents; paragraphs join
  // CJK-aware — no gap after “。”, one space between Latin paragraphs (CANVAS-05).
  assert.equal(articleSummary({ title: '夜里十点的社区图书角', body: '夜里十点的社区图书角\n　　我第一次注意到它。\n　　地铁站出口往东。' }), '我第一次注意到它。地铁站出口往东。');
  assert.equal(articleSummary({ title: 'T', body: 'Walkable streets.\n\nShops open early.' }), 'Walkable streets. Shops open early.');
  // The note's simple-tier preview joins lines CJK-aware: no gap after “。” (CANVAS-15), a space between Latin words.
  assert.equal(joinLines('城市醒来之前的那一个小时。\n冷青蓝打底。\n\n人都在做事'), '城市醒来之前的那一个小时。冷青蓝打底。人都在做事');
  assert.equal(joinLines('blue hour\nwarm lamp\n灯'), 'blue hour warm lamp 灯');
  const lines = Array.from({ length: 300 }, (_, index) => ({ id: `l${index}`, start: index * 2, end: index * 2 + 2, text: '句' }));
  const segments = railSegments(lines, [{ start: 10, end: 14 }]);
  assert.ok(segments.length <= 96, 'long transcripts merge into a bounded number of cells');
  assert.equal(segments.filter(segment => segment.marked).length >= 1, true);
  assert.deepEqual(railSegments(undefined), []);
  // The playing sentence lights the rail cell that holds it (same grouping), nothing between sentences.
  const keys = new Set(segments.map(segment => segment.key));
  assert.ok(keys.has(railKeyAt(lines, 301)!), 'the lit key is one of the rail cells');
  assert.equal(railKeyAt(lines, 301), segments[Math.floor(150 / Math.ceil(300 / 96))].key);
  assert.equal(railKeyAt([{ id: 'a', start: 1, end: 2, text: '一' }, { id: 'b', start: 4, end: 5, text: '二' }], 3), undefined);
  assert.equal(railKeyAt(undefined, 3), undefined);
  assert.deepEqual(lengthMarks(1000, [{ from: 200, to: 300 }, { start: 3 }]), [{ left: .2, width: .1, key: '200-300' }]);
  const pieces = wordPieces('摊主说，四点出摊不是为了赚钱。')!;
  assert.ok(pieces.length > 2 && pieces.every(piece => !/^[，。]/.test(piece)), 'punctuation joins the word before it');
  assert.equal(pieces.join(''), '摊主说，四点出摊不是为了赚钱。');
  assert.equal(wordPieces('15-Minute City'), null, 'Latin text keeps the browser line breaking');
});

test('broken pictures and films say what is wrong once, with the one action that can help (CORE-08)', () => {
  assert.equal(mediaProblemKind(false, 'missing'), 'missing');
  assert.equal(mediaProblemKind(true, 'error'), 'unreadable');
  assert.equal(mediaProblemKind(true, 'ready'), 'undecodable');
  assert.equal(mediaProblemKind(false, 'ready'), undefined);
  const data = { kind: 'image', title: '坏图', body: '', mediaId: 'm1' } as CardData;
  const board = { retryMedia: noop, readOnly: false } as unknown as CardActions;
  const missing = mediaProblem('image', 'missing', 'n1', data, board, noop, noop);
  assert.equal(missing.message, '图片未找到');
  assert.equal(missing.action?.name, '重新读取：坏图');
  const broken = mediaProblem('image', 'undecodable', 'n1', data, board, noop, noop);
  assert.equal(broken.message, '这张图片无法显示');
  assert.equal(broken.action?.name, '检查素材：坏图', 'reading a damaged file again changes nothing, so it is not offered');
  let replaced = '';
  const withReplace = mediaProblem('video', 'undecodable', 'n1', { ...data, kind: 'video' }, { ...board, replaceMedia: (id: string) => { replaced = id; } } as unknown as CardActions, noop, noop);
  assert.equal(withReplace.message, '这段视频无法播放');
  assert.equal(withReplace.action?.label, '换一个视频');
  withReplace.action?.run();
  assert.equal(replaced, 'n1');
});
