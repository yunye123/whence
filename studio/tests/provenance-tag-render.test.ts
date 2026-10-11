import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProvenanceTag, { ProvenanceTagShape } from '../src/components/ProvenanceTag';
import { attr, getBy, getByRole, hasClass, queryAll, textContent } from './helpers/markup';

test('stamp is a nodrag/nopan button with its existing action and tooltip', () => {
  const html = renderToStaticMarkup(createElement(ProvenanceTag, {
    variant: 'stamp', label: '01:12–01:26', actionLabel: '回到原片 01:12',
    title: '跳转至 01:12', onActivate: () => {}, className: 'nowheel',
  }));
  const button = getByRole(html, 'button', '回到原片 01:12');
  for (const token of ['field-card__citation', 'tag-btn', 'nodrag', 'nopan', 'nowheel']) assert.ok(hasClass(button, token));
  assert.equal(attr(button, 'title'), '跳转至 01:12');
  assert.equal(textContent(getBy(button, { className: 'tag__body' })), '01:12–01:26');
  const icon = getBy(button, { tag: 'svg', attrs: { 'data-provenance-icon': 'video' } });
  assert.equal(attr(icon, 'aria-hidden'), 'true');
  assert.equal(queryAll(button, { tag: 'circle' }).length, 0, 'no tag hole geometry');
});

test('legacy size callers receive the new stamp and mini stamp without losing location text', () => {
  const full = renderToStaticMarkup(createElement(ProvenanceTagShape, { label: '01:12–01:26' }));
  assert.ok(hasClass(getBy(full, { className: 'tag' }), 'tag--stamp'));
  const mini = renderToStaticMarkup(createElement(ProvenanceTag, { label: '第 3 段', size: 'mini' }));
  const tag = getBy(mini, { className: 'tag' });
  assert.ok(hasClass(tag, 'tag--mini'));
  assert.ok(hasClass(tag, 'tag--stamp-mini'));
  assert.equal(textContent(getBy(tag, { className: 'tag__body' })), '第 3 段');
  assert.equal(queryAll(mini, { role: 'button' }).length, 0);
});

test('explicit provenance kind handles ReactNode labels and no-time video excerpts', () => {
  const cases = [
    { label: '原文', kind: 'text' as const },
    { label: '查看来源', kind: 'text' as const },
    { label: createElement('span', {}, '00:00–00:14'), kind: 'video' as const },
    { label: '01:12', kind: 'text' as const },
  ];
  for (const props of cases) {
    const html = renderToStaticMarkup(createElement(ProvenanceTagShape, props));
    getBy(html, { tag: 'svg', attrs: { 'data-provenance-icon': props.kind } });
    assert.equal(queryAll(html, { tag: 'svg' }).length, 1);
  }
});

test('removed sources are inert, keep snapshots and explain why they cannot be opened', () => {
  const active = renderToStaticMarkup(createElement(ProvenanceTag, { label: '01:12', onActivate: () => {} }));
  getByRole(active, 'button'); // positive control for the absence assertion
  for (const variant of ['stamp', 'stamp-mini'] as const) {
    const gone = renderToStaticMarkup(createElement(ProvenanceTag, {
      label: '01:12', variant, gone: true, onActivate: () => {},
    }));
    assert.equal(queryAll(gone, { role: 'button' }).length, 0);
    getBy(gone, { attrs: { title: '来源卡片已不在当前画布' } });
    assert.ok(hasClass(getBy(gone, { className: 'tag' }), 'tag--gone'));
    assert.equal(textContent(getBy(gone, { className: 'tag__body' })), '01:12');
  }
});

test('stamp-mini remains actionable when requested and variant wins over legacy size', () => {
  const html = renderToStaticMarkup(createElement(ProvenanceTag, {
    variant: 'stamp-mini', label: '第 5 段', actionLabel: '回到原文第 5 段', onActivate: () => {},
  }));
  const button = getByRole(html, 'button', '回到原文第 5 段');
  assert.ok(hasClass(getBy(button, { className: 'tag' }), 'tag--stamp-mini'));
  const full = renderToStaticMarkup(createElement(ProvenanceTagShape, { variant: 'stamp', size: 'mini', label: '原文' }));
  assert.ok(hasClass(getBy(full, { className: 'tag' }), 'tag--stamp'));
});
