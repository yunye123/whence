import test from 'node:test';
import assert from 'node:assert/strict';

import { assertNone, getBy, getByLabel, isButton, queryAll, textContent } from './helpers/markup';
import { render, article } from './helpers/card-faces';
import { sourcePreviewParagraphs } from '../src/source-location';

test('an imported article is a folder with verbatim numbered paragraphs and reading, without in-place editing', () => {
  const html = render(article.data, {}, article.id);
  assert.ok(isButton(getByLabel(html, `展开阅读：${article.data.title}`)));
  assertNone(html, { label: /^编辑笔记：/ });
  assertNone(html, { attrs: { 'data-note-preview': true } }, 'double-click opens reading instead of note editing');
  assert.match(textContent(html), /约 1,\d00 字/);
  const paragraphs = queryAll(html, { attrs: { 'data-source-from': true } });
  assert.ok(paragraphs.length);
  const original = article.data.body.replace(/\r\n?/g, '\n');
  for (const paragraph of paragraphs) {
    assert.equal(textContent(paragraph), original.slice(Number(paragraph.attrs['data-source-from']), Number(paragraph.attrs['data-source-to'])));
  }
  assert.equal(getBy(html, { className: 'field-card__folder-tab' }).attrs['data-folder-tab'], 'article');
  assert.match(textContent(html), new RegExp(`${sourcePreviewParagraphs(original).filter(p => p.number).length} 段`));
  assert.match(getBy(html, { tag: 'article' }).attrs['aria-label'], /^文字资料：/);
});
