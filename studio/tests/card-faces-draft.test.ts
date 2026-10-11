import test from 'node:test';
import assert from 'node:assert/strict';

import { closest, getAllBy, getByLabel, hasClass, isButton, queryAll, textContent } from './helpers/markup';
import { render, writing, draft } from './helpers/card-faces';

test('a draft card shows readable prose with margin owners and footnotes, never field:// or Markdown (PW-B1, PW-B2)', () => {
  const html = render(draft.data, { sourceNodeIds: new Set(writing.nodes.map(node => node.id)) }, draft.id);
  assert.doesNotMatch(html, /field:\/\//);
  assert.doesNotMatch(textContent(html), /(^|\n)\s*>|\]\(|##/);
  const refs = queryAll(html, { attrs: { 'data-footnote': true } });
  assert.equal(queryAll(html, { tag: 'sup' }).length, 0);
  assert.ok(queryAll(html, { attrs: { 'data-pn': true } }).length >= 2);
  const footnotes = getAllBy(html, { label: /^回到第 \d 处引用的来源：/ });
  assert.ok(refs.length >= 2 && footnotes.length === refs.length, 'one footnote row per global reference');
  footnotes.forEach(button => assert.ok(isButton(button) && hasClass(button, 'nodrag')));
  assert.match(textContent(html), /第二稿/);
  assert.match(textContent(html), /\d[\d,]* 字/);
  const open = getByLabel(html, `打开文稿编辑：${draft.data.title}`);
  assert.ok(closest(open, { className: 'card-drag-content' }));
});
