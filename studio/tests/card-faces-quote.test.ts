import test from 'node:test';
import assert from 'node:assert/strict';

import { excerptDisplayTitle } from '../src/cards/card-utils';

import { assertNone, attr, getBy, getByLabel, hasClass, isButton, textContent } from './helpers/markup';
import { render, film, filmQuote, article, textQuote } from './helpers/card-faces';

test('an excerpt keeps a head stamp that returns to the exact place, and shows the sentence as its title (C13)', () => {
  const html = render(filmQuote.data, { sourceNodeIds: new Set([film.id]) }, filmQuote.id);
  const tag = getByLabel(html, '回到原片 01:12');
  assert.ok(isButton(tag) && hasClass(tag, 'field-card__citation') && hasClass(tag, 'nodrag'), 'the tag is the way back');
  assert.equal(attr(tag, 'title'), '回到原始素材');
  for (const token of ['tag-btn', 'nodrag', 'nowheel', 'nopan']) assert.ok(hasClass(tag, token));
  assert.equal(attr(tag, 'data-edge-anchor'), 'stamp');
  assert.ok(getBy(tag, { className: 'tag--stamp' }));
  assert.ok(getBy(tag, { attrs: { 'data-provenance-icon': 'video' } }));
  assertNone(tag, { className: 'tag__hole' });
  assert.match(textContent(tag), /01:12–01:26/);
  const title = getBy(html, { tag: 'h3' });
  assert.match(textContent(title), /^摊主说，四点出摊/, 'display title is the sentence opening');
  assert.doesNotMatch(textContent(title), /^摘录 · /);
  // K12 (CHROME-16): the “…” names the sentence like the card does — two excerpts from one source share a stored title.
  assert.match(attr(getBy(html, { label: /^更多操作：/ }), 'aria-label')!, /^更多操作：摊主说，四点出摊/);
  const article = getBy(html, { tag: 'article' });
  assert.equal(textContent(getBy(html, { attrs: { id: attr(article, 'aria-describedby')! } })), '来源：凌晨四点的早餐摊');
});

test('a text excerpt names its paragraph when App can count it, and becomes an inert dashed tag when the source is gone', () => {
  const located = render(textQuote.data, { sourceNodeIds: new Set([article.id]), sourceParagraph: () => 3 }, textQuote.id);
  assert.ok(isButton(getByLabel(located, '回到原文第 3 段')));
  assert.ok(getBy(located, { attrs: { 'data-provenance-icon': 'text' } }));
  assert.equal(textContent(getBy(located, { tag: 'h3' })), excerptDisplayTitle(textQuote.data));
  assert.ok(textQuote.data.citation!.text!.startsWith(textContent(getBy(located, { tag: 'h3' })).replace(/…$/, '')), '`摘录 · <来源标题>` is a default title too');
  assert.equal(excerptDisplayTitle({ ...textQuote.data, title: '我改过的标题' }), '我改过的标题');
  const fallback = render(textQuote.data, { sourceNodeIds: new Set([article.id]) }, textQuote.id);
  assert.ok(isButton(getByLabel(fallback, '回到原文')), 'before integration the tag still returns to the source');
  assert.ok(getBy(fallback, { className: 'tag-btn' }), 'positive control for the gone-source absence check');
  const gone = render(textQuote.data, { sourceNodeIds: new Set() }, textQuote.id);
  assertNone(gone, { className: 'tag-btn' }, 'a removed source leaves no clickable tag');
  assert.ok(getBy(gone, { attrs: { title: '来源卡片已不在当前画布' } }));
  assert.match(textContent(gone), /来源已不在画布/);
  assert.match(textContent(gone), new RegExp(textQuote.data.citation!.text!.slice(0, 8)), 'the snapshot text stays');
});
