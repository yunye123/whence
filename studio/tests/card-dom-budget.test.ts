import test from 'node:test';
import assert from 'node:assert/strict';
import { render, film, filmQuote, article, draft } from './helpers/card-faces';
import { queryAll } from './helpers/markup';
import type { CardData } from '../src/model';

// Measured on 78078e6 before W2-A edits. Same fixtures and renderer, excludes <wbr> only.
// Evidence: output/desk-v2/W2-A/dom-baseline.json. W3 adds its new long-content/state fixtures here.
const samples: Array<[string, number, CardData]> = [
  ['print', 57, film.data], ['folder', 23, article.data], ['index', 33, filmQuote.data], ['manuscript', 64, draft.data],
  ['note', 23, { kind: 'note', title: '笔记', body: '这是一张便笺。' }],
  ['photo', 24, { kind: 'image', title: '图片', body: '', url: '/image.png' }],
  ['lighttable', 15, { kind: 'frame', title: '参考', body: '' }],
  ['link', 24, { kind: 'link', title: '网页', body: '原文内容。', url: 'https://example.com' }],
];
for (const [kind, baseline, data] of samples) test(`DOM budget: ${kind} ≤ 1.5 × ${baseline} and ≤ 150`, () => {
  const html = render(data);
  assert.equal(queryAll(html, { tag: 'article' }).length, 1, 'a missing card cannot pass the budget');
  const count = queryAll(html, {}).filter(el => el.tag !== 'wbr').length;
  assert.ok(count > 0 && count <= Math.min(150, Math.floor(baseline * 1.5)), `${count} elements; baseline ${baseline}`);
});

// W3-D: deferred SSR projection is counted honestly (not used as layout-read evidence).
for (const [name, body] of [
  ['long prose', Array.from({ length: 80 }, (_, i) => `第${i + 1}段，原文不截断，整段折叠。`).join('\n\n')],
  ['mixed cited/code', '# 开场\n\n> 引文😀。\n\n[来源：原文](field://node/s1?quote=q1)\n\n~~~md\nfield://node/literal\n~~~\n\n结束。'],
  ['twenty references', Array.from({ length: 20 }, (_, i) => `段落${i + 1}。[来源：文献${i + 1}](field://node/s${i + 1}?quote=q${i + 1})`).join('\n\n')],
]) test(`DOM budget: manuscript ${name} ≤ 150`, () => {
  const html = render({ kind: 'draft', title: '稿纸预算', body });
  const count = queryAll(html, {}).filter(el => el.tag !== 'wbr').length;
  assert.ok(count > 0 && count <= 150, `${count} elements`);
  assert.equal(queryAll(html, { tag: 'article' }).length, 1);
});
