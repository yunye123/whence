import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import { ArticleCardBody } from '../src/cards/ArticleCardBody';
import { LinkCardBody } from '../src/cards/LinkCardBody';
import { FolderOverview } from '../src/cards/overview/FolderOverview';
import { paragraphIndexAt, sourcePreviewParagraphs } from '../src/source-location';
import type { CardData } from '../src/model';
import type { CardBodyProps, CardMedia, ExcerptMark } from '../src/cards/types';
import { queryAll, getBy, textContent } from './helpers/markup';
import { render } from './helpers/card-faces';

const media: CardMedia = { mediaError: false, loadingMedia: false, unavailableMedia: false, mediaStateMessage: '', setMediaError() {}, setPosterError() {} };
function face(body: string, marks: readonly ExcerptMark[] = [], link = false, width?: number) {
  const data: CardData = { kind: link ? 'link' : 'note', title: '原件标题', body, tags: link ? undefined : ['文字资料', 'Markdown'], url: link ? 'https://example.org/原文' : undefined };
  const props = { id: 'source', data, board: {}, activate() {}, openCard() {}, previewWidth: width, marks, connectable: false } as unknown as CardBodyProps & { marks: readonly ExcerptMark[]; connectable: boolean };
  return renderToStaticMarkup(createElement(ReactFlowProvider, null, link ? createElement(LinkCardBody, { ...props, media }) : createElement(ArticleCardBody, props)));
}

const cases = [
  '# 标题\n\n文 / 林冉\n\n第一段 **原始格式**。\n\n第二段 emoji 👩🏽‍💻，链接 [原件](https://example.org)。\n\n第三段。',
  'TXT 标题\n' + Array.from({ length: 5 }, (_, i) => `${i}。` + '　中文原文与 English 👩🏽‍💻。'.repeat(8)).join('\n'),
  '第一段。\r\n\r\n第二段带有\t空格  和 Markdown **符号**。',
  '长原文。' + '文字与 English emoji 🌿 保真。'.repeat(420),
];
for (const [index, body] of cases.entries()) for (const link of [false, true]) test(`folder UTF-16 slices match reading, case ${index}, link ${link}`, () => {
  const normalized = body.replace(/\r\n?/g, '\n');
  const paragraphs = sourcePreviewParagraphs(body);
  const numbered = paragraphs.filter(p => p.number);
  const last = numbered.at(-1)!;
  const html = face(body, [{ quoteId: 'actual-quote', from: last.from, to: last.to }], link, 178);
  const rendered = queryAll(html, { attrs: { 'data-source-from': true } });
  assert.ok(rendered.length);
  for (const p of rendered) {
    const from = Number(p.attrs['data-source-from']);
    const to = Number(p.attrs['data-source-to']);
    assert.equal(textContent(p), normalized.slice(from, to));
    if (p.attrs['data-pn']) assert.equal(Number(p.attrs['data-pn']), paragraphIndexAt(body, from));
  }
  const mark = getBy(html, { tag: 'mark', attrs: { 'data-quote-id': 'actual-quote' } });
  assert.equal(textContent(mark), last.text);
  assert.equal(mark.attrs['data-edge-anchor'], 'excerpt-row');
  assert.ok(queryAll(html, { attrs: { 'data-quote-id': true } }).every(p=>p.attrs['data-quote-id']==='actual-quote'), 'trace addresses are actual quote ids, never offset keys');
  assert.equal(queryAll(html, { label: '从这张卡片连线' }).length, 1, 'one output per material body');
  assert.equal(getBy(html, { className: 'field-card__article' }).attrs['data-folder-narrow'], '');
});

test('cross-paragraph and overlapping quotes retain exact intersections and actual quote ids', () => {
  const body = '开头原文。\n\n第二段 👩🏽‍💻 保留空格。\n\n第三段继续。\n\n尾段。';
  const paragraphs = sourcePreviewParagraphs(body);
  const from = paragraphs[1].from + 2, to = paragraphs[2].to - 1;
  const html = face(body, [{ quoteId: 'q-cross', from, to }, { quoteId: 'q-overlap', from: from + 1, to: from + 4 }]);
  const marks = queryAll(html, { tag: 'mark', attrs: { 'data-quote-id': 'q-cross' } });
  assert.ok(marks.length >= 2);
  for (const mark of queryAll(html, { tag: 'mark' })) {
    assert.equal(textContent(mark), body.slice(Number(mark.attrs['data-mark-from']), Number(mark.attrs['data-mark-to'])));
  }
  assert.ok(queryAll(html, { tag: 'mark', attrs: { 'data-quote-id': 'q-overlap' } }).length);
});

test('invalid stale ranges do not create yellow marks or guess a matching sentence', () => {
  const html = face('相同的原句。\n\n相同的原句。', [{ quoteId: 'old-source', from: 999, to: 1000 }, { quoteId: 'reverse', from: 9, to: 2 }, { quoteId: 'nan', from: NaN, to: 4 }]);
  assert.equal(queryAll(html, { tag: 'mark' }).length, 0);
});

test('missing width SSR retains raw text without claiming canvas measurement', () => {
  for(const width of [undefined,178]) {
    const html = face('第一段 🌿。\n\n第二段。', [], false, width);
    assert.equal(textContent(getBy(html, { attrs: { 'data-pn': '1' } })), '第一段 🌿。');
    assert.equal(queryAll(html, { attrs: { 'data-measured': true } }).length, 0);
    assert.equal(queryAll(html, { attrs: { 'data-plan-ready': true } }).length, 0);
  }
});

test('folder overview distinguishes tab and jacket while keeping title text unchanged', () => {
  for (const kind of ['note', 'link'] as const) {
    const title = '15-Minute City 中文标题';
    const data: CardData = { kind, title, body: '原文。', tags: kind === 'note' ? ['文字资料'] : undefined };
    const html = renderToStaticMarkup(createElement(FolderOverview, { data, title, media, previewWidth: 178 }));
    assert.equal(textContent(getBy(html, { tag: 'h3' })), title);
    assert.equal(getBy(html, { className: 'field-card__overview' }).attrs['data-folder-overview'], kind === 'note' ? 'article' : 'link');
  }
});

test('long-source folder DOM is bounded, excluding wbr and retaining the original baseline comparison', () => {
  const data: CardData = { kind: 'note', title: '8k 原件', body: '原文。'.repeat(2800), tags: ['文字资料'] };
  const html = render(data);
  const count = queryAll(html, {}).filter(p => p.tag !== 'wbr').length;
  assert.ok(count <= Math.min(150, Math.floor(23 * 1.5)), `folder baseline 23; actual ${count}`);
});

test('six excerpted paragraphs keep a bounded DOM in both source materials', () => {
  const body=Array.from({length:6},(_,i)=>`第 ${i+1} 段原文。`).join('\n\n');
  const marks=sourcePreviewParagraphs(body).map(p=>({quoteId:`quote-${p.number}`,from:p.from,to:p.to}));
  for(const kind of ['note','link'] as const) {
    const data:CardData={kind,title:'六段原件',body,tags:kind==='note'?['文字资料']:undefined,url:kind==='link'?'https://example.org':undefined};
    const html=render(data,{excerptMarks:()=>marks});
    const count=queryAll(html,{}).filter(p=>p.tag!=='wbr').length;
    assert.ok(count<=150, `${kind}: ${count} elements`);
    // Same fixture rendered from 9bb2b76 snapshots: article 29, link 33 (main's temporary ArticleBody).
    // Evidence: output/desk-v2/W3-B/six-mark-dom-baseline.json. Original shared 23/24 checks remain intact.
    const baseline=kind==='note'?29:33;
    assert.ok(count<=Math.floor(baseline*1.5),`${kind}: ${count} exceeds its measured same-mark baseline ${baseline}`);
  }
});
