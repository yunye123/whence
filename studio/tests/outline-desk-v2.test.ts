import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Board, BoardNode } from '../src/model';
import OutlineView, { draftOutline, moveDraftSection } from '../src/shell/OutlineView';
import { draftParagraphIndexAt } from '../src/source-location';
import { getAllBy, getBy, isDisabled, textContent } from './helpers/markup';

const node = (id: string, kind: BoardNode['data']['kind'], title: string, body: string): BoardNode => ({ id, type: 'card', position: { x: 0, y: 0 }, data: { kind, title, body } });
const board = (nodes: BoardNode[]): Board => ({ id: 'outline-test', title: '大纲验证', description: '', category: 'writing', createdAt: '', updatedAt: '', nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
const render = (nodes: BoardNode[]) => renderToStaticMarkup(createElement(OutlineView, { board: board(nodes), onOpenCard() {}, onImport() {}, onReorderDraft() {} }));
const source = node('source', 'note', '雨中的车站', '# 雨中的车站\n\n第一段。\n\nKeep  two spaces，慢慢走。');
const quote = node('quote', 'quote', '摘录 · 雨中的车站', 'Keep  two spaces，慢慢走。');
quote.data.citation = { nodeId: source.id, title: source.data.title, text: quote.data.body, textAnchor: { from: source.data.body.indexOf('Keep'), to: source.data.body.length, prefix: '', suffix: '' } };
const ref = '[来源：雨中的车站](field://node/source?quote=quote)';
const body = `# 出发\n\n开头😀。\n\n## 等待\n\n> Keep  two spaces，慢慢走。\n\n${ref}\n\n## 回家\n\n回到书桌。`;
const draft = node('draft', 'draft', '等待与出发', body);

test('each manuscript has a framed paper header, existing metadata below its title and canonical paragraph margins', () => {
  const snapshot = JSON.stringify([draft, quote, source]);
  const html = render([draft, quote, source, node('second', 'draft', '第二篇', '第二篇正文。')]);
  assert.equal(getAllBy(html, { className: 'outline-draft' }).length, 2);
  const paper = getBy(html, { label: '文稿：等待与出发' });
  assert.equal(getAllBy(paper, { className: 'outline-draft__rule' }).length, 1);
  const head = getBy(paper, { className: 'outline-row--draft' });
  assert.match(textContent(head), /3 节　1 处引用　正文/);
  const rows = getAllBy(paper, { className: 'outline-row--section' });
  assert.deepEqual(rows.map(row => getBy(row, { className: 'outline-section__paragraph' }).attrs['data-para']), ['1', '2', '3']);
  assert.equal(getBy(paper, { className: 'outline-ref__paragraph' }).attrs['data-para'], String(draftParagraphIndexAt(body, body.indexOf(ref))));
  assert.equal(JSON.stringify([draft, quote, source]), snapshot, 'rendering must not mutate source text or board nodes');
});

test('reference stamp uses the canonical source location while the quotation retains spaces and textContent', () => {
  const html = render([draft, quote, source]);
  const row = getBy(html, { className: 'outline-row--ref' });
  assert.equal(isDisabled(row), false);
  assert.equal(textContent(getBy(row, { className: 'outline-ref__text' })), quote.data.citation!.text);
  assert.equal(textContent(getBy(row, { className: 'tag__body' })), '第 2 段');
  assert.equal(getBy(row, { className: 'tag--stamp-mini' }).tag, 'span');
  assert.equal(textContent(getBy(row, { className: 'outline-ref__paragraph' })), '', 'margin number is a pseudo-element, not copied text');
});

test('missing source and quote keep the reference row disabled with the existing removal title and a dashed stamp state', () => {
  const present = getBy(render([draft, quote, source]), { className: 'outline-row--ref' });
  assert.equal(isDisabled(present), false);
  const gone = getBy(render([draft]), { className: 'outline-row--ref' });
  assert.equal(isDisabled(gone), true);
  assert.equal(gone.attrs.title, '来源卡片已不在当前画布');
  assert.equal(getBy(gone, { className: 'tag--gone' }).tag, 'span');
  assert.match(textContent(gone), /来源已移除/);
  assert.equal(textContent(getBy(gone, { className: 'tag__body' })), '原文');
  assert.equal(isDisabled(getBy(render([draft, quote]), { className: 'outline-row--ref' })), false, 'a retained quote remains navigable as before');
});

test('unused quotes live outside manuscript papers and the empty outline preserves its import action', () => {
  const unused = structuredClone(quote); unused.id = 'unused';
  const html = render([draft, quote, source, unused]);
  const group = getBy(html, { label: '还没写进文稿的摘录' });
  assert.equal(getAllBy(group, { className: 'outline-row--ref' }).length, 1);
  assert.equal(getBy(group, { className: 'outline-refs--loose' }).tag, 'ul');
  const empty = getBy(render([]), { className: 'outline-empty' });
  assert.match(textContent(empty), /大纲还是空的/);
  assert.equal(getBy(empty, { role: 'button', name: '导入素材' }).tag, 'button');
  assert.equal(getAllBy(render([source]), { className: 'outline-row--card' }).length, 1, 'source-only boards retain the existing type list');
});

test('CRLF and emoji offsets agree with canonical draft paragraphs and reordering keeps the existing intro guard', () => {
  const crlf = { ...draft, data: { ...draft.data, body: body.replace(/\n/g, '\r\n') } };
  assert.deepEqual(getAllBy(render([crlf, quote, source]), { className: 'outline-ref__paragraph' }).map(el => el.attrs['data-para']), ['2']);
  const intro = `前言。\n\n${body}`;
  assert.equal(moveDraftSection(intro, 0, 1), intro);
  const moved = moveDraftSection(body, 2, 1);
  assert.deepEqual(draftOutline(moved).map(section => section.heading), ['出发', '回家', '等待']);
  assert.equal(moved.replace(/\s/g, '').length, body.replace(/\s/g, '').length);
});
