// W2-C target contracts, written before the component migration (K12).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import MaterialsLibrary, { cardFacet } from '../src/shell/MaterialsLibrary';
import BoardLibrary from '../src/BoardLibrary';
import type { Board, BoardNode, Workspace } from '../src/model';
import { attr, getBy, getByRole, hasClass, queryAll } from './helpers/markup';

const noop = () => {};
const node = (id: string, kind: BoardNode['data']['kind'], x = 0, y = 0): BoardNode => ({ id, type: 'card', position: { x, y }, data: { kind, title: id, body: '' } });
const board: Board = { id: 'sidebar-test', title: '目录', description: '', category: 'video', createdAt: '', updatedAt: '', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] };
const render = (nodes: BoardNode[], facet: 'all' | 'source' | 'quote' | 'mine' | 'image' = 'all', selectedIds: string[] = []) => renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(MaterialsLibrary, { board: { ...board, nodes }, facet, selectedIds, onRevealCard: noop, onOpenCard: noop })));

test('W2-C: four directory headings remain filter buttons, including every empty group', () => {
  const html = render([]);
  const group = getByRole(html, 'group', '素材筛选');
  for (const name of ['来源', '摘录', '我写的', '图片']) {
    const button = getByRole(group, 'button', `只看${name}，0 张`);
    assert.equal(attr(button, 'aria-pressed'), 'false');
    assert.equal(attr(button, 'disabled'), undefined);
  }
  assert.equal(queryAll(html, { className: 'library-facet' }).length, 4);
  getBy(html, { className: 'library-empty', text: '还没有卡片' });
});

test('W2-C: filtering hides unrelated rows and always offers a clear action for empty results', () => {
  const source = node('原片', 'video');
  getBy(render([source]), { className: 'library-item', text: '原片' }); // positive control
  const html = render([source], 'quote');
  assert.equal(queryAll(html, { className: 'library-item' }).length, 0);
  assert.equal(attr(getByRole(html, 'button', '只看摘录，0 张'), 'aria-pressed'), 'true');
  getByRole(html, 'button', '清除筛选');
  getBy(html, { className: 'library-empty', text: '本画布没有摘录。' });
});

test('W2-C: quote rows carry the raw display title and full time range; current hooks survive', () => {
  const quote = node('引句', 'quote');
  quote.data.title = '摘录 · 01:12';
  quote.data.citation = { nodeId: 'source', title: '原片', text: '这是一句原话。', start: 72, end: 86 };
  const html = render([quote], 'all', [quote.id]);
  const item = getBy(html, { className: 'library-item' });
  assert.ok(hasClass(item, 'is-current'));
  assert.ok(hasClass(item, 'is-quote'));
  getBy(item, { tag: 'strong', text: '这是一句原话。' });
  getBy(item, { className: 'library-meta', text: '01:12–01:26' });
  assert.ok(hasClass(getBy(item, { className: 'library-icon' }), 'quote'));
});

test('W2-C: text quotes include paragraph and source without changing the original data', () => {
  const source = node('来源名', 'note'); source.data.tags = ['文字资料']; source.data.body = '第一段。\n\n第二段。';
  const quote = node('摘录', 'quote'); quote.data.citation = { nodeId: source.id, title: source.data.title, text: '第二段。', textAnchor: { from: 6, to: 10, prefix: '', suffix: '' } };
  const before = JSON.stringify([source, quote]);
  getBy(render([source, quote]), { className: 'library-meta', text: '第 2 段 · 来源名' });
  assert.equal(JSON.stringify([source, quote]), before);
});

test('W2-C: tray image members default to folded with a separate accessible disclosure', () => {
  const frame = node('看图台', 'frame'); frame.style = { width: 1000, height: 1000 };
  const image = node('组内图片', 'image', 100, 100); image.style = { width: 100, height: 100 };
  const before = JSON.stringify([frame, image]);
  const html = render([frame, image]);
  assert.equal(attr(getByRole(html, 'button', '展开分组成员：看图台'), 'aria-expanded'), 'false');
  getBy(html, { className: 'library-item', attrs: { 'data-card-id': frame.id } });
  assert.equal(queryAll(html, { className: 'library-item', attrs: { 'data-card-id': image.id } }).length, 0);
  getBy(render([image]), { className: 'library-item', text: image.id }); // positive control
  assert.equal(JSON.stringify([frame, image]), before);
});

test('W2-C: covers use manuscript fallback for unresolved media and count expanded board groups', () => {
  const workspace: Workspace = { schema: 1, activeBoardId: board.id, boards: [{ ...board, cover: 'media://unresolved', groupId: 'group' }], groups: [{ id: 'group', title: '进行中' }] };
  const html = renderToStaticMarkup(createElement(BoardLibrary, { workspace, disabled: false, onSwitch: noop, onNew: noop, onChange: noop }));
  getBy(html, { className: 'board-cover-fallback' });
  getBy(html, { className: 'board-group-count', text: '1' });
  assert.equal(queryAll(html, { tag: 'img' }).length, 0);
  for (const name of ['画布排序', '新建画布分组', '新建画布']) getByRole(html, 'button', name);
});

test('W2-C: semantic categories preserve article, note and frame distinctions', () => {
  assert.equal(cardFacet({ kind: 'note', title: '', body: '', tags: ['文字资料'] }), 'source');
  assert.equal(cardFacet({ kind: 'note', title: '', body: '' }), 'mine');
  assert.equal(cardFacet({ kind: 'frame', title: '', body: '' }), null);
});
