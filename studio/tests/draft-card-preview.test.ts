import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DraftCardBody, KEEP_CHARACTERS, splitKeep } from '../src/cards/DraftCardBody';
import { DraftOverview } from '../src/cards/overview/DraftOverview';
import { DRAFT_AUTO_BUDGET, manuscriptBudget, manuscriptCacheInfo, manuscriptProjection, manuscriptReferences, planManuscript } from '../src/cards/draft-preview';
import { draftPreviewParagraphs, draftFootnotes } from '../src/source-location';
import { formatDraftQuote } from '../src/draft-references';
import { queryAll, textContent } from './helpers/markup';
import type { CardActions } from '../src/board-context';
import type { BoardNode } from '../src/model';

const board = { sourceNodeIds: new Set(['s1']), focusSource: () => {} } as unknown as CardActions;
const face = (body: string) => renderToStaticMarkup(createElement(DraftCardBody, { id: 'd1', data: { kind: 'draft', title: '复查文稿', body }, board, activate: () => {}, openCard: () => {}, previewWidth: 448 }));

test('a reference-only line folds into its owner, expressed by the margin circle and clickable stamp without superscript', () => {
  const quote = { id: 'q1', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '摘录 · 第 2 段', body: '', citation: { nodeId: 's1', title: '复查文字资料', text: '好的作品，来自反复回到原文。', textAnchor: { from: 0, to: 14, prefix: '', suffix: '', text: '好的作品，来自反复回到原文。' } } } } as BoardNode;
  const body = `我的判断：创作需要证据。${formatDraftQuote(quote)}`;
  const html = face(body);
  assert.equal(queryAll(html, { className: 'field-card__draft-paragraph' }).length, 2);
  assert.equal(queryAll(html, { tag: 'sup' }).length, 0);
  const circle = queryAll(html, { attrs: { 'data-edge-anchor': 'para-ref' } })[0];
  assert.equal(circle.attrs['data-pn'], '2');
  assert.equal(circle.attrs['data-cite-key'], 'q1');
  assert.equal(queryAll(html, { attrs: { 'data-edge-anchor': 'stamp' } }).length, 1);
  assert.equal(queryAll(html, { attrs: { 'data-footnote': '1' } }).length, 1);
  assert.doesNotMatch(textContent(html), /field:\/\//);
});

test('the kept tail remains compatible, including whitespace and references', () => {
  assert.deepEqual(splitKeep([{ text: 'one more step' }]), { head: [{ text: 'one more ' }], tail: [{ text: 'step' }] });
  assert.deepEqual(splitKeep([{ text: '写进第二段 原文' }, { ref: 2 }]), { head: [{ text: '写进第' }], tail: [{ text: '二段 原文' }, { ref: 2 }] });
  assert.equal(KEEP_CHARACTERS, 4);
  assert.match(face('我的判断，也需要自己的声音。'), /keep-together/);
});

const cases = [
  ['backtick code', '```md\n[字面链接](field://node/code)\n```'],
  ['tilde code', '~~~md\nfield://node/code\n~~~'],
  ['inline code', '正文 `field://node/code` 继续。'],
  ['escaped link', String.raw`转义 \[来源：字面](field://node/escaped)`],
  ['invalid link', '[来源：无效](field://node/)'],
  ['inline emphasis', '这是*强调*句，和 **加重**字。'],
  ['list/task/strike', '1. 第一条\n2) ~~第二条~~\n- [x] 完成'],
  ['CRLF/code/emoji', '# 开头\r\n\r\n```md\r\nfield://node/code 😀\r\n```\r\n\r\n正文😀。[来源：真实](field://node/s1?quote=q1)'],
  ['Markdown inside code', '```md\n# 代码标题\n> 引用\n- [x] 列表\n[字面链接](field://node/code)\n[外部链接](https://example.com)\n![图像描述](https://example.com/a.png)\n```'],
] as const;
for (const [name, body] of cases) test(`display-only cleanup: ${name}; original API and global parser preserved`, () => {
  const original = draftPreviewParagraphs(body);
  const before = JSON.stringify(original);
  const projection = manuscriptProjection(body);
  const prose = projection.paragraphs.map(p => p.text).join(' ');
  assert.doesNotMatch(prose, /field:\/\/|`|~~~|~~|\]\(|(?:^|\s)(?:\d+[.)]|[-+*#>]) |\[[ xX]\]/);
  assert.equal(JSON.stringify(original), before);
  assert.equal(projection.footnotes.length, draftFootnotes(body).length, 'literal code never becomes a reference');
  if (name.includes('code')) assert.ok(JSON.stringify(original).includes('field://'));
  assert.doesNotMatch(textContent(face(body)), /field:\/\/|~~~|~~/);
});

test('the planner fits whole paragraphs, includes stamp height, keeps a heading with the next passage', () => {
  const projection = manuscriptProjection('第一段。\n\n## 小标题\n\n> 引文。\n\n[来源：文献](field://node/s1?quote=q1)\n\n第三段。');
  const plan = planManuscript(projection, 376, 112, () => 1);
  assert.equal(plan.status, 'measured');
  assert.deepEqual(plan.visible.map(p => p.number), [1]);
  assert.deepEqual(plan.folded.map(p => p.number), [0, 2, 3]);
  assert.equal(plan.height, 32);
  const larger = planManuscript(projection, 376, 160, () => 1);
  assert.deepEqual(larger.visible.map(p => p.number), [1, 0, 2, 3]);
});

test('an oversized first paragraph is folded whole, SSR/unknown width are deferred rather than fabricated', () => {
  const p = manuscriptProjection('很长的第一段。\n\n第二段。');
  assert.equal(planManuscript(p, 100, 80, () => 20).visible.length, 0);
  for (const plan of [planManuscript(p, 376, 80, null), planManuscript(p, undefined, 80, () => { throw new Error('must defer'); })]) {
    assert.equal(plan.status, 'deferred'); assert.equal(plan.height, null);
  }
  assert.match(face('正文'), /data-draft-plan="deferred"/);
  assert.equal(manuscriptBudget(undefined, 2), DRAFT_AUTO_BUDGET);
  assert.ok(manuscriptBudget(260, 2) < manuscriptBudget(400, 2));
});

test('a heading-only or final heading remains visible when its complete block fits', () => {
  for (const body of ['# 标题', '正文。\n\n## 尾标题']) {
    const p = manuscriptProjection(body), plan = planManuscript(p, 376, 120, () => 1);
    assert.equal(plan.visible.length, p.paragraphs.length);
    assert.equal(plan.folded.length, 0);
  }
  assert.equal(planManuscript(manuscriptProjection('# 标题\n\n正文。'), 376, 64, () => 1).visible.length, 2, 'last owner needs no folding row reserve');
});

test('small fixed heights fold complete global reference rows, including the persistent 160px minimum', () => {
  assert.deepEqual(manuscriptReferences(160, 20), { rows: 0, compact: true });
  assert.deepEqual(manuscriptReferences(220, 20), { rows: 1, compact: false });
  assert.deepEqual(manuscriptReferences(undefined, 20), { rows: 6, compact: false });
  assert.equal(manuscriptBudget(160, 20), 22);
});

test('far reference bars preserve each visible cite key even when two references share one owner', () => {
  const body = '同一段。[来源：一](field://node/s1?quote=q1) [来源：二](field://node/s2?quote=q2)';
  const html = renderToStaticMarkup(createElement(DraftOverview, { id: 'd1', data: { kind: 'draft', title: '概览', body }, title: '概览',
    media: { mediaError: false, loadingMedia: false, unavailableMedia: false, mediaStateMessage: '', setMediaError: () => {}, setPosterError: () => {} } }));
  const anchors = queryAll(html, { attrs: { 'data-edge-anchor': 'para-ref' } });
  assert.deepEqual(anchors.map(a => a.attrs['data-cite-key']), ['q1', 'q2']);
  assert.deepEqual(anchors.map(a => a.attrs['data-footnote']), ['1', '2']);
});

test('projection shares LF cache objects, freezes results, retains global footnotes beyond the preview, bounded at 200', () => {
  const body = '首段。\n\n[来源：一](field://node/s1)\n\n后段。[来源：二](field://node/s2)';
  const p = manuscriptProjection(body);
  assert.equal(manuscriptProjection(body.replaceAll('\n', '\r\n')), p);
  assert.deepEqual(p.paragraphs.filter(p => p.number).map(p => p.footnotes), [[1], [2]]);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.paragraphs) && Object.isFrozen(p.footnotes));
  for (let i = 0; i < 220; i++) manuscriptProjection(`缓存边界 ${i}`);
  assert.equal(manuscriptCacheInfo().projections, 200);
});

test('a leading reference keeps the quote owner and very tall plans still obey the DOM envelope', () => {
  const p = manuscriptProjection('[来源：前置](field://node/s1)\n\n> 引文。');
  assert.equal(p.paragraphs[0].quoted, true);
  const long = manuscriptProjection(Array.from({length: 60}, (_, i) => `第${i + 1}段。`).join('\n\n'));
  const plan = planManuscript(long, 376, 5000, () => 1);
  assert.ok(plan.visible.length > 0 && plan.visible.length <= 6);
  assert.ok(plan.folded.length > 0);
});
