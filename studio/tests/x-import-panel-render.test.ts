import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import XImportPanel, { type XImportPanelProps } from '../src/XImportPanel';
import { assertNone, getBy, getByLabel, getByRole, isDisabled, isReadOnly, mentions, textContent } from './helpers/markup';

// Behaviour contracts only: the labelled source field, submit/cancel availability, read-only and busy
// states, alert semantics and the honesty copy (source, author/link, third-party service). Attribute order
// and element types beyond roles are not asserted (EN-M2, map-tests §3.3). Copy may move between visible
// text, placeholder and title, so `mentions` checks text and attribute values together.

const sample = 'https://x.com/akokoi1/status/2104200939095904322?s=20';
function render(props: Partial<XImportPanelProps> = {}) {
  return renderToStaticMarkup(createElement(XImportPanel, {
    value: sample, onChange: () => {}, onImport: () => {}, onCancel: () => {},
    available: true, busy: false, ...props,
  }));
}
const sourceField = (html: string) => getByLabel(html, 'X 推文链接或分享文案', { role: 'textbox' });
const submit = (html: string) => getBy(html, { role: 'button', attrs: { type: 'submit' } }, 'the panel keeps a submit button');

test('X panel detects one unique post and exposes a labelled source input', () => {
  const html = render({ value: `${sample}\nhttps://twitter.com/akokoi1/status/2104200939095904322/photo/1` });
  assert.match(textContent(html), /识别到 1 条推文/);
  sourceField(html);
  assert.ok(mentions(html, '文章请粘贴文章所在推文链接'));
  assert.ok(mentions(html, '作者和原链接'));
  assert.ok(mentions(html, '第三方公开接口'));
  assert.equal(isDisabled(submit(html)), false, 'a valid single post can be submitted');
});

test('unavailable and read-only imports cannot submit', () => {
  const unavailable = render({ available: false });
  assert.ok(mentions(unavailable, '请在来处桌面版导入'));
  assert.ok(isDisabled(submit(unavailable)));
  const readOnly = render({ readOnly: true });
  assert.ok(mentions(readOnly, '当前窗口只读'));
  assert.ok(isReadOnly(sourceField(readOnly)), 'the source field stays readable but cannot be edited');
  assert.ok(isDisabled(submit(readOnly)));
});

test('busy imports block repeated submission and commit has no cancellation promise', () => {
  const busy = render({ busy: true, progress: '正在读取第 2 条推文…' });
  assert.match(textContent(busy), /正在读取第 2 条推文/);
  assert.equal(isDisabled(getByRole(busy, 'button', '取消导入')), false, 'a running import can be cancelled');
  assert.ok(isDisabled(submit(busy)));
  const committing = render({ busy: true, committing: true });
  assert.match(textContent(committing), /正在保存到画布/);
  assertNone(committing, { role: 'button', name: /取消/ }, 'positive controls: the busy render above and the idle render (取消)');
  assert.ok(getByRole(render(), 'button', '取消'));
  assert.ok(isDisabled(sourceField(committing)));
  assert.ok(isDisabled(submit(committing)));
});

test('direct article links and batches above ten clearly block submission', () => {
  const article = render({ value: 'https://x.com/i/article/2104200939095904322' });
  const alert = getByRole(article, 'alert');
  assert.match(textContent(alert), /文章 ID 与推文 ID 不同/);
  assert.ok(isDisabled(submit(article)));
  const batch = render({ value: Array.from({ length: 11 }, (_, index) => `https://x.com/example/status/${1000 + index}`).join('\n') });
  assert.match(textContent(batch), /识别到 11 条推文/);
  assert.ok(mentions(batch, '一次最多导入 10 条推文'));
  assert.ok(isDisabled(submit(batch)));
});
