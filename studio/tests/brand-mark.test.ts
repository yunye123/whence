import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkIcon, markDot, markPath, markSpec } from '../src/icons/field-icons';
import { ArticleIcon, DraftIcon, FolderMiniIcon, IndexCardMiniIcon, LightTableMiniIcon, ManuscriptMiniIcon, NoteIcon, NoteMiniIcon, QuoteIcon, SourceIcon, ThreadIcon, ProvenanceParagraphIcon, ProvenancePlayIcon } from '../src/icons/field-icons';
import { attr, getBy, getByRole, queryAll } from './helpers/markup';

// 2026-10-07 起的标志「原点」（DESIGN_SYSTEM §9）：纸边落在整数（设备）像素上，朱点和纸之间留纸色间隙。
const BRAND = {
  '24@1': 'M6 2H22V18H12.4A6.4 6.4 0 0 0 6 11.6Z',       // 品牌稿 mark-24
  '24@1.25': 'M8 3H27V22H16A8 8 0 0 0 8 14Z',            // 品牌稿 mark-24@1.25x
  '24@1.5': 'M9 3H33V27H18.5A9.5 9.5 0 0 0 9 17.5Z',     // 品牌稿 mark-24@1.5x
};

test('brand mark: each size and zoom draws the paper on whole device pixels with a gap around the zhu dot', () => {
  for (const size of [24, 28]) for (const dpr of [1, 1.25, 1.5]) {
    const spec = markSpec(size, dpr), { n, x, y, s, r, R } = spec, label = `${size}px @ ${dpr * 100}%`;
    assert.equal(n, size * dpr, `${label}: the drawing grid is the device pixel grid`);
    for (const edge of [x, y, x + s, y + s]) assert.ok(Number.isInteger(edge), `${label}: paper edge ${edge} is a whole pixel`);
    assert.ok(x - r >= 0 && y >= 0 && x + s <= n && y + s + r <= n, `${label}: paper and dot stay inside the box`);
    assert.ok(R - r >= 2, `${label}: at least 2 device pixels of paper colour between dot and paper`);
  }
  for (const [key, path] of Object.entries(BRAND)) {
    const [size, dpr] = key.split('@').map(Number);
    assert.equal(markPath(markSpec(size, dpr)), path, `${key} is the brand file's geometry`);
  }
  assert.deepEqual(markDot(28, 1), { cx: 7, cy: 21, r: 5 }, 'the welcome thread starts under the dot');
});

test('brand mark renders ink as currentColor and the dot from --brand-dot (mono fallback); server render uses 1x', () => {
  const html = renderToStaticMarkup(createElement(MarkIcon, { size: 24 }));
  assert.match(html, /viewBox="0 0 24 24"/);
  assert.ok(html.includes(`d="${BRAND['24@1']}"`));
  assert.match(html, /<circle cx="6" cy="18" r="4" style="fill:var\(--brand-dot, currentColor\)"/);
  assert.match(html, /aria-hidden="true"/);
});

test('six existing icon exports keep their accessible names and replace the hole/string metaphors', () => {
  for (const Icon of [QuoteIcon, SourceIcon, DraftIcon, NoteIcon, ArticleIcon]) {
    const html = renderToStaticMarkup(createElement(Icon, { title: '文具', size: 24 }));
    getByRole(html, 'img', '文具');
    assert.equal(queryAll(html, { tag: 'circle' }).length, 0, `${Icon.name}: no hole`);
    assert.equal(queryAll(html, { attrs: { 'stroke-dasharray': true } }).length, 0, `${Icon.name}: no crease or length rail`);
  }
  const thread = renderToStaticMarkup(createElement(ThreadIcon, { title: '连线' }));
  getByRole(thread, 'img', '连线');
  const dots = queryAll(thread, { tag: 'circle' });
  assert.equal(dots.length, 2);
  for (const dot of dots) assert.equal(attr(dot, 'fill'), 'currentColor');
});

test('directory stationery uses the approved 20 by 16 grid and token colours without faded strokes', () => {
  for (const Icon of [FolderMiniIcon, IndexCardMiniIcon, ManuscriptMiniIcon, NoteMiniIcon, LightTableMiniIcon]) {
    const html = renderToStaticMarkup(createElement(Icon));
    const svg = getBy(html, { tag: 'svg' });
    assert.equal(attr(svg, 'viewbox'), '0 0 20 16');
    assert.equal(attr(svg, 'width'), '20');
    assert.equal(attr(svg, 'height'), '16');
    assert.equal(attr(svg, 'aria-hidden'), 'true');
    assert.equal(queryAll(svg, { attrs: { opacity: true } }).length, 0);
    assert.equal(queryAll(svg, { attrs: { 'stroke-dasharray': true } }).length, 0);
  }
  const index = renderToStaticMarkup(createElement(IndexCardMiniIcon, { title: '摘录' }));
  getByRole(index, 'img', '摘录');
  getBy(index, { tag: 'path', attrs: { style: 'stroke:var(--zhu)' } });
});

test('provenance pictograms share approved solid geometry and carry no text into copied locations', () => {
  for (const Icon of [ProvenancePlayIcon, ProvenanceParagraphIcon]) {
    const html = renderToStaticMarkup(createElement(Icon));
    const svg = getBy(html, { tag: 'svg' });
    assert.equal(attr(svg, 'fill'), 'currentColor');
    assert.equal(attr(svg, 'stroke'), 'none');
    assert.equal(attr(svg, 'aria-hidden'), 'true');
    assert.equal(queryAll(svg, { tag: 'text' }).length, 0);
    getBy(svg, { tag: 'path' });
  }
});
