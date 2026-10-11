import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TextReading from '../src/inspector/TextReading';
import type { ReadingTrace } from '../src/inspector/TextReading';
import { adjacentSentence, isBlockPart, parseReadingDocument, trimToVisible } from '../src/inspector/reading-markdown';
import { offsetOfPoint, pointAtOffset } from '../src/inspector/reading-selection';
import type { TextWalkNode } from '../src/inspector/reading-selection';
import { duplicateTitleFrom, readsByDefault } from '../src/inspector/TextSourceSection';
import { paragraphIndexAt } from '../src/source-location';
import { attr, descendants, getByLabel, hasClass, parseMarkup, queryAll, textContent } from './helpers/markup';
import type { MarkupElement, MarkupNode } from './helpers/markup';

// K9-13 / PR-M2: the reading view renders Markdown, but `.inspector-reading-body` keeps every source character
// (syntax in hidden spans, paragraph numbers as pseudo-elements). These tests pin that contract for real-world
// samples, the agreement of paragraph numbers with `paragraphIndexAt`, and the DOM ↔ offset mapping.

const SAMPLES: Record<string, string> = {
  article: [
    '# 步行十五分钟，能到达什么', '', '文 / 林冉', '', '## 引子', '',
    '早上七点出门，十五分钟里，你能买到一份早饭、把孩子送进学校、在社区医院挂上号吗？', '',
    '这个问题比房价更**诚实**。房价告诉你一座城市有多贵，这个问题告诉你，住在这里的日子是什么样子。', '',
    '## 一、把城市折叠进十五分钟', '', '> 一座城市是否宜居，要看一个人步行十五分钟能完成多少件事。', '> 距离不是用公里计算的。', '',
    '- **筛选**：先看早餐摊', '- [ ] 补一个反例', '- [x] 采访钳工', '  续行仍属于这一项', '',
    '1. 第一项', '2. 第二项', '', '---', '', '```js', 'const a = 1;', '', 'const b = 2;', '```', '',
    '链接 [城市观察](https://example.com/a "标题") 与 [内部](field://node/abc?t=3)，自动 <https://example.com/b>。', '',
    '![一张图](https://example.com/p.png) 图后文字，`代码` 与 \\*转义\\* 和 ~~删除~~。', '',
    '## 小标题紧跟正文', '这一段没有空行，紧跟在小标题下面。', '',
  ].join('\n'),
  plainText: '　　第一段用单个换行分段，这一行足够长，读起来像一段完整的散文段落。\n　　第二段也是这样，单个换行之后就是新的意思，不该挤成一团。\n　　第三段结束。\n',
  leadingGaps: '\n\n  \n开头前面有空行。\n\n\n\n中间有多个空行。   \n\n结尾有空白。\n\n  ',
  emoji: '🌿 人们站进候车亭。\n老人把伞向陌生人移了半寸。\n\n**粗体里有 🌿 emoji**，*斜体*，_下划线_ 与 snake_case_name。',
  sections: '一、把城市折叠进十五分钟\n\n正文第一段。\n\n二、谁在走\n\n正文第二段。',
  unclosed: '``` 未闭合的代码\n仍然是代码\n\n空行之后\n\n**不闭合的粗体 和 [不完整的链接](',
  // W-M1: a TXT saved from Word or Notepad breaks paragraphs with one newline; every line is a numbered paragraph.
  txtLines: '夜里十点的图书角\n　　我第一次注意到那个图书角，是在一个加班到很晚的冬夜，地铁站出口往东走两百米，有一家二十四小时营业的便利店。\n　　便利店门口的三个旧书架上贴着手写的纸条：看完放回来就好，不用登记。那天风很大，我在书架前站了十几分钟。\n　　\n二、后来\n　　后来我问过很多人，几乎每个人都路过那个书架，却很少有人真正停下来翻一翻，人们需要的不只是书。\n',
  leadHeadingProse: '## 小标题\n第一行足够长，读起来像一段完整的散文段落，单换行之后是新的一段。\n第二行同样足够长，单个换行之后就是新的意思，不该和上一行挤成一团。',
};

function renderBody(source: string, options: { range?: { from: number; to: number } | null; traces?: ReadingTrace[]; hiddenHeading?: number | null } = {}) {
  const document = parseReadingDocument(source);
  const html = renderToStaticMarkup(createElement(TextReading, { document, range: options.range ?? null, traces: options.traces, hiddenHeading: options.hiddenHeading ?? null, onSelection: () => {} }));
  return { document, html, body: getByLabel(html, '资料阅读正文') };
}

function toWalk(node: MarkupNode, parent: TextWalkNode | null): TextWalkNode {
  if (node.kind === 'text') return { nodeType: 3, nodeValue: node.text, textContent: node.text, childNodes: [], parentNode: parent };
  const element: TextWalkNode = { nodeType: 1, nodeValue: null, textContent: '', childNodes: [], parentNode: parent };
  element.childNodes = node.children.map(child => toWalk(child, element));
  element.textContent = Array.from(element.childNodes).map(child => child.textContent ?? '').join('');
  return element;
}
function walkTexts(root: TextWalkNode, out: TextWalkNode[] = []): TextWalkNode[] {
  for (const child of Array.from(root.childNodes)) child.nodeType === 3 ? out.push(child) : walkTexts(child, out);
  return out;
}
function insideHidden(element: MarkupElement, text: MarkupNode): boolean {
  const find = (node: MarkupElement, hidden: boolean): boolean | undefined => {
    for (const child of node.children) {
      if (child === text) return hidden;
      if (child.kind === 'element') { const result = find(child, hidden || hasClass(child, 'md-mark')); if (result !== undefined) return result; }
    }
    return undefined;
  };
  return !!find(element, false);
}

test('rendered reading text equals the LF source exactly for every Markdown sample', () => {
  for (const [name, source] of Object.entries(SAMPLES)) {
    const { body } = renderBody(source);
    assert.equal(textContent(body), source, `${name}: textContent must equal the source`);
  }
});

test('located quotations, traces and flat fallbacks keep the text and one labelled mark', () => {
  const source = SAMPLES.article;
  const sentence = '一座城市是否宜居，要看一个人步行十五分钟能完成多少件事。';
  const from = source.indexOf(sentence);
  const single = renderBody(source, { range: { from, to: from + sentence.length }, traces: [{ from, to: from + sentence.length, quoteIds: ['q1'] }] });
  assert.equal(textContent(single.body), source);
  const marks = queryAll(single.body, { label: '摘录原文', role: 'mark' });
  assert.equal(marks.length, 1);
  assert.equal(textContent(marks[0]), sentence);

  // A quotation across blocks and across list items still yields one mark whose text is the exact slice.
  for (const [a, b] of [['早上七点出门', '是什么样子。'], ['**筛选**', '补一个反例'], ['距离不是', '先看早餐摊']]) {
    const start = source.indexOf(a), end = source.indexOf(b) + b.length;
    const crossing = renderBody(source, { range: { from: start, to: end }, traces: [{ from: start, to: end, quoteIds: ['q2', 'q3'] }] });
    assert.equal(textContent(crossing.body), source, `${a}…${b}: text unchanged`);
    const located = queryAll(crossing.body, { label: '摘录原文', role: 'mark' });
    assert.equal(located.length, 1, `${a}…${b}: one mark`);
    assert.equal(textContent(located[0]), source.slice(start, end));
  }
  const trace = renderBody(source, { traces: [{ from: source.indexOf('这个问题比'), to: source.indexOf('是什么样子。') + 6, quoteIds: ['q4'] }] });
  assert.equal(queryAll(trace.body, { role: 'mark' }).length, 0, 'an excerpt trace is not an announced highlight');
  assert.ok(queryAll(trace.body, { attrs: { 'data-quotes': 'q4' } }).length >= 1);
  assert.equal(textContent(trace.body), source);
});

test('paragraph numbers are pseudo-element data that agree with paragraphIndexAt; headings are not counted', () => {
  for (const [name, source] of Object.entries(SAMPLES)) {
    const { body, document } = renderBody(source);
    const numbered = descendants(body).filter(element => attr(element, 'data-para'));
    assert.equal(numbered.length, document.paragraphs, `${name}: every paragraph block carries its number`);
    numbered.forEach((element, index) => {
      const para = Number(attr(element, 'data-para'));
      assert.equal(para, index + 1, `${name}: numbers run from 1 without gaps`);
      assert.equal(paragraphIndexAt(source, Number(attr(element, 'data-from'))), para, `${name}: block ${para} agrees with paragraphIndexAt`);
    });
    for (const heading of descendants(body).filter(element => /^h[2-5]$/.test(element.tag))) assert.equal(attr(heading, 'data-para'), undefined, `${name}: headings are not numbered`);
  }
});

test('W-M1: single-newline TXT paragraphs are numbered line by line, the same as paragraphIndexAt', () => {
  const source = SAMPLES.txtLines;
  const { body, document } = renderBody(source);
  assert.equal(textContent(body), source, 'the text stays exactly the source');
  const numbered = descendants(body).filter(element => attr(element, 'data-para'));
  // NEXT_ROUND (INSP-11 / CORE-13): the short first line followed by one newline is the title, not paragraph 1.
  assert.deepEqual(numbered.map(element => Number(attr(element, 'data-para'))), [1, 2, 3, 4], 'two paragraphs, the section line and the last paragraph; the title and the blank-looking line are not counted');
  assert.equal(document.paragraphs, 4);
  assert.equal(document.parts.find(isBlockPart)?.kind, 'heading', 'the title line reads as the title');
  assert.equal(document.headings[0]?.text, '夜里十点的图书角');
  const last = source.indexOf('后来我问过');
  assert.equal(paragraphIndexAt(source, last), 4);
  assert.equal(Number(attr(numbered[3], 'data-from')), source.lastIndexOf('\n', last) + 1, 'the last paragraph is its own block');
  assert.ok(document.headings.some(heading => heading.text === '二、后来'), 'a section line inside the lines still reaches the contents');
  const lead = renderBody(SAMPLES.leadHeadingProse);
  assert.deepEqual(descendants(lead.body).filter(element => attr(element, 'data-para')).map(element => attr(element, 'data-para')), ['1', '2']);
  assert.equal(lead.document.headings[0]?.text, '小标题', 'the lead heading stays in the contents');
});

test('INSP-11: a TXT paragraph indent stays in the text but is hidden like Markdown syntax', () => {
  const source = SAMPLES.plainText;
  const { body, document } = renderBody(source);
  assert.equal(textContent(body), source, 'the indent is still part of the DOM text (K9-13)');
  const marks = descendants(body).filter(element => hasClass(element, 'md-mark'));
  assert.equal(marks.filter(element => /^　+$/.test(textContent(element))).length, 3, 'each paragraph indent sits in a hidden md-mark span');
  const second = source.indexOf('　　第二段');
  assert.deepEqual(trimToVisible(document, second, second + 4), { from: second + 2, to: second + 4 }, 'a selection never starts with the hidden indent');
});

test('DOM points map to source offsets and back for every visible character', () => {
  for (const [name, source] of Object.entries(SAMPLES)) {
    const { body } = renderBody(source);
    const root = toWalk(body, null);
    const texts = walkTexts(root);
    const markupTexts: MarkupNode[] = [];
    const collect = (node: MarkupElement) => { for (const child of node.children) child.kind === 'text' ? markupTexts.push(child) : collect(child); };
    collect(body);
    let offset = 0;
    texts.forEach((text, index) => {
      const length = text.nodeValue!.length;
      const visible = !insideHidden(body, markupTexts[index]);
      for (let at = 0; at <= length; at++) {
        assert.equal(offsetOfPoint(root, text, at), offset + at, `${name}: text point ${index}:${at}`);
        if (!visible || at === length) continue;
        const start = pointAtOffset(root, offset + at, 'forward'), end = pointAtOffset(root, offset + at + 1, 'backward');
        assert.ok(start && start.node === text && start.offset === at, `${name}: start of visible character ${offset + at}`);
        assert.ok(end && end.node === text && end.offset === at + 1, `${name}: end of visible character ${offset + at}`);
      }
      offset += length;
    });
    assert.equal(offset, source.length, `${name}: text nodes cover the source`);
    // Element boundary points (Range on an element and a child index) count the text before that child.
    const element = Array.from(root.childNodes).find(child => child.nodeType === 1 && child.childNodes.length > 1);
    if (element) {
      let before = 0;
      for (let child = 0; child < element.childNodes.length; child++) {
        assert.equal(offsetOfPoint(root, element, child), (offsetOfPoint(root, element, 0) ?? 0) + before);
        before += element.childNodes[child].textContent?.length ?? 0;
      }
    }
    assert.equal(offsetOfPoint(root, root, root.childNodes.length), source.length);
  }
});

test('selections shrink to what a reader sees and sentences select one at a time', () => {
  const source = SAMPLES.article;
  const document = parseReadingDocument(source);
  const heading = source.indexOf('## 引子');
  assert.deepEqual(trimToVisible(document, heading, heading + '## 引子\n\n'.length), { from: heading + 3, to: heading + 5 });
  const bold = source.indexOf('**诚实**');
  const inner = trimToVisible(document, bold, bold + 6);
  assert.equal(source.slice(inner!.from, inner!.to), '诚实', 'leading and trailing syntax is not part of the quote');
  const middle = trimToVisible(document, bold - 1, bold + 7);
  assert.equal(source.slice(middle!.from, middle!.to), '更**诚实**。', 'syntax inside the selection stays: the quote is an exact slice');
  const start = source.indexOf('早上七点');
  const first = adjacentSentence(document, start, 1)!;
  assert.equal(source.slice(first.from, first.to), '早上七点出门，十五分钟里，你能买到一份早饭、把孩子送进学校、在社区医院挂上号吗？');
  const second = adjacentSentence(document, first.to, 1)!;
  assert.equal(source.slice(second.from, second.to), '这个问题比房价更**诚实**。');
  assert.deepEqual(adjacentSentence(document, second.from, -1), first);
  const title = duplicateTitleFrom(document, '步行十五分钟，能到达什么');
  assert.equal(title, 0);
  const skipped = adjacentSentence(document, 0, 1, title)!;
  assert.equal(source.slice(skipped.from, skipped.to), '早上七点出门，十五分钟里，你能买到一份早饭、把孩子送进学校、在社区医院挂上号吗？', 'the hidden duplicate title, the byline and the heading are never selected (INSP-07)');
  assert.deepEqual(adjacentSentence(document, first.from, -1, title), null, 'nothing readable comes before the first sentence');
  const lead = source.indexOf('## 小标题紧跟正文');
  const afterLead = adjacentSentence(document, lead, 1, title)!;
  assert.equal(source.slice(afterLead.from, afterLead.to), '这一段没有空行，紧跟在小标题下面。', 'a heading line that opens a paragraph is skipped');
  const section = parseReadingDocument(['一、谁在走', '', '第一句话。第二句话。'].join('\n'));
  const firstPlain = adjacentSentence(section, 0, 1)!;
  assert.equal(section.text.slice(firstPlain.from, firstPlain.to), '第一句话。', 'a “一、” section line is not a sentence');
});

test('internal links never become hrefs and the duplicate title heading stays in the text', () => {
  const { html, body } = renderBody(SAMPLES.article, { hiddenHeading: 0 });
  assert.equal(descendants(html).some(element => Object.values(element.attrs).some(value => /^\s*field:/i.test(value))), false);
  assert.ok(descendants(body).some(element => element.tag === 'a' && attr(element, 'href') === 'https://example.com/a'));
  const hidden = descendants(body).find(element => hasClass(element, 'is-duplicate-title'));
  assert.ok(hidden && textContent(hidden).includes('步行十五分钟'));
  assert.equal(textContent(body), SAMPLES.article);
});

test('imported text and saved post prose open in reading; own notes and empty bodies open the editor', () => {
  assert.equal(readsByDefault({ kind: 'note', title: '', body: '正文', tags: ['文字资料', 'Markdown'] }), true);
  assert.equal(readsByDefault({ kind: 'note', title: '', body: '我的想法' }), false);
  assert.equal(readsByDefault({ kind: 'note', title: '', body: '  ', tags: ['文字资料'] }), false);
  assert.equal(readsByDefault({ kind: 'link', title: '', body: '推文', sourceOriginalText: '推文' }), true);
  assert.equal(readsByDefault({ kind: 'link', title: '', body: '网页摘要' }), false);
});

test('a fenced code block is one <code> with plain text inside; a blank line inside the fence starts a numbered part', () => {
  const { body } = renderBody(SAMPLES.article);
  const blocks = descendants(body).filter(element => element.tag === 'pre');
  assert.equal(blocks.length, 2, 'the blank line inside the fence splits the code into two paragraphs (paragraphIndexAt)');
  for (const pre of blocks) {
    assert.equal(descendants(pre).filter(element => element.tag === 'code').length, 1, 'no inline-code chips nested inside a code block');
    assert.ok(attr(pre, 'data-para'), 'each part carries its paragraph number');
  }
  assert.ok(hasClass(blocks[0], 'is-continuing') && hasClass(blocks[1], 'is-continued'), 'the two parts are marked so they read as one block');
  assert.equal(`${textContent(blocks[0])}\n\n${textContent(blocks[1])}`, '```js\nconst a = 1;\n\nconst b = 2;\n```');
  assert.equal(textContent(body), SAMPLES.article);
});

test('X post prose keeps every character and turns blank lines into paragraph gaps', async () => {
  const { default: XPostSection } = await import('../src/inspector/XPostSection');
  const { BoardContext } = await import('../src/board-context');
  const post = '第一段第一行。\n第一段第二行。\n\n第二段🌿。\n\n\n第三段。';
  const view = { xPostSource: undefined, preferVideoText: true, xPostText: post, xPostPartial: false, xPostHasSnapshot: true, xPostLong: false, xPostPreview: post, xPostLoading: false, xPostError: undefined } as never;
  const html = renderToStaticMarkup(createElement(BoardContext.Provider, { value: { readOnly: false, nodes: [] } as never },
    createElement(XPostSection, { nodeId: 'x', view, xPostExpanded: false, onExpand: () => {}, rememberVisit: () => {} })));
  const region = getByLabel(html, '推文正文');
  assert.ok(textContent(region).includes(post), 'the prose text is exactly the post, line breaks included');
  const paragraphs = descendants(region).filter(element => hasClass(element, 'x-post-para'));
  assert.deepEqual(paragraphs.map(element => textContent(element)), ['第一段第一行。\n第一段第二行。', '第二段🌿。', '第三段。']);
  const single = renderToStaticMarkup(createElement(BoardContext.Provider, { value: { readOnly: false, nodes: [] } as never },
    createElement(XPostSection, { nodeId: 'x', view: { ...(view as object), xPostText: '一行。\n两行。', xPostPreview: '一行。\n两行。' } as never, xPostExpanded: false, onExpand: () => {}, rememberVisit: () => {} })));
  assert.equal(descendants(getByLabel(single, '推文正文')).filter(element => hasClass(element, 'x-post-para')).length, 0, 'a post without blank lines stays one block of text');
});
