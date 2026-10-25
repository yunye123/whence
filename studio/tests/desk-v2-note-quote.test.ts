import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoteOverview } from '../src/cards/overview/NoteOverview';
import { QuoteOverview } from '../src/cards/overview/QuoteOverview';
import { NoteCardBody } from '../src/cards/NoteCardBody';
import { quoteLocation, QuoteTag } from '../src/cards/QuoteCardBody';
import type { CardBodyProps } from '../src/cards/types';
import type { CardOverviewProps } from '../src/cards/overview/types';
import type { CardData, CardTone } from '../src/model';
import { render, filmQuote, film, textQuote, article, noop } from './helpers/card-faces';
import { assertNone, attr, getBy, getByLabel, hasClass, queryAll, textContent } from './helpers/markup';

test('index snapshot stays exact and understanding has a visible label; SSR defers unavailable measurement', () => {
  const source = '  原话🌿。\r\n\r\n第二句：FIELD 2026，保留标点。  ';
  const data = { ...filmQuote.data, body: '这句是我的理解。', citation: { ...filmQuote.data.citation!, text: source } };
  const before = structuredClone(data);
  const html = render(data, { sourceNodeIds: new Set([film.id]) });
  const readable = getBy(html, { className: 'field-card__quote-text' });
  assert.equal(textContent(readable), source);
  for (const token of ['nodrag', 'nowheel', 'nopan']) assert.ok(hasClass(readable, token));
  assert.equal(attr(readable, 'tabindex'), '-1', 'pointer copy focus adds no tab stop');
  assert.match(attr(readable, 'style')!, /user-select:text/);
  assert.ok(hasClass(getBy(html, { className: 'field-card__quote-content' }), 'card-drag-content'), 'body padding still drags');
  const label = getBy(html, { className: 'field-card__quote-note-label' });
  assert.equal(textContent(label), '我的理解');
  assert.equal(hasClass(label, 'sr-only'), false);
  assertNone(html, { attrs: { 'data-text-planned': true } });
  assert.deepEqual(data, before);
});

test('quote stamp action retains source id, start, origin id and no storage title mutation', () => {
  const calls: unknown[][] = [];
  const props = { id: 'quote-origin', data: filmQuote.data,
    board: { sourceNodeIds: new Set([film.id]), focusSource: (...args: unknown[]) => calls.push(args) },
    activate: (_event: unknown, action: () => void) => action(), openCard: noop } as unknown as CardBodyProps;
  const el = QuoteTag(props)!;
  el.props.onClick({});
  assert.deepEqual(calls, [[filmQuote.data.citation!.nodeId, 72, false, 'quote-origin']]);
  assert.match(filmQuote.data.title, /^摘录 · /);
  assert.deepEqual(quoteLocation({ ...props, data: { ...filmQuote.data, citation: { ...filmQuote.data.citation!, start: 0, end: 0 } } }),
    { label: '00:00', action: '回到原片 00:00' });
});

for (const tone of ['paper', 'butter', 'mint', 'lavender', 'blue'] as CardTone[]) test(`note tone ${tone} keeps header/footer and user title, default title stays hidden`, () => {
  const body = '开头。\r\n\r\n  思路🌿，原字保留。';
  const html = render({ kind: 'note', title: '我的想法', body, tone });
  assert.ok(hasClass(getBy(html, { tag: 'article' }), `field-card--${tone}`));
  const header = getBy(html, { tag: 'header' });
  assert.equal(hasClass(getBy(header, { tag: 'h3' }), 'sr-only'), false);
  assert.equal(textContent(getBy(html, { attrs: { 'data-note-preview': true } })), body);
  getBy(html, { tag: 'footer' });
  const untitled = render({ kind: 'note', title: '笔记', body, tone });
  assert.ok(hasClass(getBy(getBy(untitled, { tag: 'header' }), { tag: 'h3' }), 'sr-only'));
  assertNone(untitled, { role: 'textbox' });
  assert.ok(getByLabel(html, '编辑笔记：我的想法'));
  const readOnly = render({ kind: 'note', title: '我的想法', body, tone }, { readOnly: true });
  getByLabel(readOnly, '展开阅读：我的想法');
  assertNone(readOnly, { label: /^编辑笔记：/ });
});

test('a note of pictures folds to the first picture and keeps the rest for opening', () => {
  const body = '这是不该摊在画布上的长正文。识别出来的字留到打开之后。';
  const html = render({
    kind: 'note', title: '酒照喝', body,
    pictures: ['field-picture:pic-a:1', 'field-picture:pic-b:2', 'field-picture:pic-c:3'],
  });
  const article = getBy(html, { tag: 'article' });
  assert.equal(attr(article, 'data-has-cover'), '');
  const images = queryAll(html, { tag: 'img' });
  assert.equal(images.length, 1);
  assert.equal(attr(images[0], 'src'), 'blob:isolated-media');
  assert.match(textContent(html), /3 张/);
  assert.equal(html.includes(body), false);
  assertNone(html, { attrs: { 'data-note-preview': true } });
  getByLabel(html, '展开阅读：酒照喝');
});

test('note editor retains nokey/maxLength, source body and no preview focus trap', () => {
  const body = '第一行：想法。\n第二行。';
  const props = { id: 'note', data: { kind: 'note', title: '笔记', body }, board: { updateCard: noop },
    activate: noop, openCard: noop, noteEditing: true, noteRef: { current: null }, beginNoteEditing: noop,
    finishNoteEditing: noop } as unknown as Parameters<typeof NoteCardBody>[0];
  const html = renderToStaticMarkup(createElement(NoteCardBody, props));
  const editor = getBy(html, { tag: 'textarea' });
  for (const token of ['nodrag', 'nowheel', 'nokey']) assert.ok(hasClass(editor, token));
  assert.equal(attr(editor, 'maxLength'), '300000');
  assert.equal(textContent(editor), body);
});

test('far index uses a stamp rectangle with stamp anchor and no hole or secondary understanding', () => {
  const props = { data: { ...filmQuote.data, body: '我的理解。' }, title: '原句', media: {} } as CardOverviewProps;
  const html = renderToStaticMarkup(createElement(QuoteOverview, props));
  getBy(html, { className: 'field-card__overview-tag', attrs: { 'data-edge-anchor': 'stamp' } });
  assertNone(html, { className: 'field-card__overview-hole' });
  assertNone(html, { className: 'field-card__overview-reading' });
  assert.equal(textContent(getBy(html, { tag: 'h3' })), filmQuote.data.citation!.text);
});

test('far note keeps the first source sentence and falls back to title for an empty note', () => {
  const props = { data: { kind: 'note', title: '标题', body: '  第一想法🌿。第二想法。' }, title: '标题', media: {} } as CardOverviewProps;
  const html = renderToStaticMarkup(createElement(NoteOverview, props));
  assert.equal(textContent(getBy(html, { tag: 'h3' })), '  第一想法🌿。');
  const empty = renderToStaticMarkup(createElement(NoteOverview, { ...props, data: { ...props.data, body: '' } }));
  assert.equal(textContent(getBy(empty, { tag: 'h3' })), '标题');
  const blankStart = renderToStaticMarkup(createElement(NoteOverview, { ...props, data: { ...props.data, body: '\n\n第一想法。第二想法。' } }));
  assert.equal(textContent(getBy(blankStart, { tag: 'h3' })), '第一想法。');
  const blankQuote = renderToStaticMarkup(createElement(QuoteOverview, { ...props, data: { ...filmQuote.data, citation: { ...filmQuote.data.citation!, text: '\n ' } } }));
  assert.equal(textContent(getBy(blankQuote, { tag: 'h3' })), '标题');
});

// Existing common budget keeps all original baselines. These extra long/state cases use the
// measured pre-W3-C same-renderer baselines in output/desk-v2/W3-C/dom-baseline.json.
for (const [name, data, baseline] of [
  ['long index', { ...filmQuote.data, citation: { ...filmQuote.data.citation!, text: '原句🌿。'.repeat(400) } }, 31],
  ['understanding index', { ...textQuote.data, body: '我的理解。'.repeat(150) }, 31],
  ['long titled note', { kind: 'note', title: '长便笺', body: '连续想法。'.repeat(400) }, 23],
] as Array<[string, CardData, number]>) test(`extra DOM budget: ${name} ≤1.5×baseline and ≤150 (excluding wbr)`, () => {
  const html = render(data, { sourceNodeIds: new Set([film.id, article.id]) });
  assert.equal(queryAll(html, { tag: 'article' }).length, 1);
  const count = queryAll(html, {}).filter(el => el.tag !== 'wbr').length;
  assert.ok(count > 0 && count <= Math.min(150, Math.floor(baseline * 1.5)), `${count} / baseline ${baseline}`);
});
