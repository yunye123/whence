import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorSelection, EditorState, Text } from '@codemirror/state';
import { insertDraftText } from '../src/Inspector';
import { formatDraftQuote, parseDraftReferences } from '../src/draft-references';
import { draftCharacterCount } from '../src/source-location';
import type { BoardNode } from '../src/model';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { analyzeDraftReferences, referenceExtension, referenceField, strayInternalLinks } from '../src/inspector/draft-editor/references';
import { SourceCard } from '../src/inspector/DraftSourcesList';
import { attr, getAllBy, textContent } from './helpers/markup';
import { analyzeDraftStructure } from '../src/inspector/draft-editor/markdown';
import { draftInsertion, fitQuoteToCaret } from '../src/inspector/draft-editor/insert';
import { resolveReferences } from '../src/inspector/draft-editor/sources';
import { draftQuotedCharacterCount, readingLength, readingMinutes, versionParagraphs } from '../src/inspector/draft-text';

// The CodeMirror draft editor (C11) keeps the stored body as the raw Markdown string and shows references as
// superscripts through replace decorations. These tests lock the pure parts: what is hidden, what each reference
// cites, paragraph numbering, the insertion path shared with insertDraftText, and the counts (PW-B1, PW-B2).

const textSource: BoardNode = { id: 'article-0001', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'note', title: '步行十五分钟，能到达什么', tags: ['文字资料'], body: '标题\n\n# 一节\n\n第一段。\n\n一座城市是否宜居，要看一个人步行十五分钟能完成多少件事。' } };
const textQuote: BoardNode = { id: 'c695cf76-ddf5-4793-8fbb-7d0f1eed38db', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '摘录 · 第 3 段', body: '适合作开头的论点。', citation: { nodeId: textSource.id, title: textSource.data.title, text: '一座城市是否宜居，要看一个人步行十五分钟能完成多少件事。', textAnchor: { from: 16, to: 16 + Array.from('一座城市是否宜居，要看一个人步行十五分钟能完成多少件事。').length, prefix: '', suffix: '' } } } };
const videoSource: BoardNode = { id: 'video-0002', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'video', title: '凌晨四点的早餐摊', body: '' } };
const videoQuote: BoardNode = { id: 'quote-video-3', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '摘录 · 01:12', body: '', citation: { nodeId: videoSource.id, title: videoSource.data.title, text: '四点出摊不是为了赚钱。', start: 72, end: 85.4 } } };

const body = [
  '凌晨四点，老周的早餐摊已经亮着灯。',
  '',
  `读资料时，有一句话我抄了下来：${formatDraftQuote(textQuote)}站在老周的摊前，我才发现这句话只说对了一半。`,
  '',
  `他说：“四点出摊不是为了赚钱。”[来源：凌晨四点的早餐摊 01:12](field://node/${videoSource.id}?quote=${videoQuote.id}&t=72)接着写。`,
].join('\n');

test('a reference alone on its line is folded onto the end of the quotation it closes', () => {
  const spans = analyzeDraftReferences(body);
  assert.equal(spans.length, 2);
  const [quoted, inline] = spans;
  const quoteLine = '> 一座城市是否宜居，要看一个人步行十五分钟能完成多少件事。';
  assert.equal(quoted.index, 1);
  assert.equal(quoted.mode, 'sup');
  assert.equal(quoted.hideFrom, body.indexOf(quoteLine) + quoteLine.length, 'the superscript sits right after the quotation');
  assert.ok(body.slice(quoted.hideFrom, quoted.hideTo).startsWith('\n\n[来源：'), 'the blank line and the link line are hidden together');
  assert.equal(body.slice(quoted.hideTo, quoted.hideTo + 1), '\n', 'the paragraph break after the link stays visible');
  assert.equal(body.slice(quoted.citedFrom, quoted.citedTo), '一座城市是否宜居，要看一个人步行十五分钟能完成多少件事。', 'the quotation text (without “> ”) is what it cites');
  assert.equal(inline.mode, 'sup');
  assert.equal(body.slice(inline.hideFrom, inline.hideTo), body.slice(inline.from, inline.to), 'an inline link hides only itself');
  assert.equal(body.slice(inline.citedFrom, inline.citedTo), '“四点出摊不是为了赚钱。”', 'an inline link cites the quotation marks right before it');
});

test('no field:// link, UUID or link markup is left outside a hidden range (PW-B1)', () => {
  const samples = [
    body,
    `[来源：开头](field://node/${textSource.id})\n\n正文。`,
    `## 小标题\n\n[来源：标题后](field://node/${textSource.id}?quote=${textQuote.id})\n\n正文。`,
    `裸链接 field://node/${textSource.id}?t=3 之后。`,
    '代码里的 `[示例](field://node/not-a-source)` 也不显示。',
    `${formatDraftQuote(textQuote)}${formatDraftQuote(textQuote)}`,
  ];
  for (const sample of samples) {
    const spans = analyzeDraftReferences(sample);
    const hidden = [...spans.map(span => ({ from: span.hideFrom, to: span.hideTo })), ...strayInternalLinks(sample, spans)];
    for (let index = sample.indexOf('field://'); index >= 0; index = sample.indexOf('field://', index + 1)) {
      assert.ok(hidden.some(range => index >= range.from && index < range.to), `field:// at ${index} is hidden in ${JSON.stringify(sample.slice(0, 40))}`);
    }
    for (const reference of parseDraftReferences(sample)) {
      assert.ok(hidden.some(range => reference.from >= range.from && reference.to <= range.to), 'the whole link text is covered');
    }
    for (let a = 0; a < spans.length; a++) for (let b = a + 1; b < spans.length; b++) {
      assert.ok(spans[a].hideTo <= spans[b].hideFrom, 'hidden ranges never overlap');
    }
  }
  const atStart = analyzeDraftReferences(samples[1])[0];
  assert.equal(atStart.mode, 'label', 'a reference with nothing above it keeps its own line as a labelled number');
  const afterHeading = analyzeDraftReferences(samples[2])[0];
  assert.equal(afterHeading.mode, 'label', 'a reference is never folded onto a heading');
  const repeated = analyzeDraftReferences(samples[5]);
  assert.deepEqual(repeated.map(span => span.index), [1, 2], 'repeats are separate occurrences in body order');
});

test('references resolve to their exact place, the writer\'s understanding and a return action', () => {
  const [quoted, inline] = resolveReferences(analyzeDraftReferences(body), [textSource, textQuote, videoSource, videoQuote]);
  assert.equal(quoted.title, '步行十五分钟，能到达什么');
  assert.equal(quoted.location, '第 2 段', 'text places use paragraphIndexAt (the title line and the heading are not counted, CORE-13)');
  assert.equal(quoted.actionLabel, '回到原文第 2 段');
  assert.equal(quoted.mine, '适合作开头的论点。');
  assert.equal(inline.title, '凌晨四点的早餐摊', 'the time suffix of the stored label is not part of the title');
  assert.equal(inline.location, '01:12–01:26', 'video places are time ranges, end rounded up');
  assert.equal(inline.actionLabel, '回到原片 01:12');
  const [gone] = resolveReferences(analyzeDraftReferences(body), []);
  assert.equal(gone.source, undefined);
  assert.equal(gone.quoteMissing, true);
});

test('paragraph numbers run as the reader sees them: headings and folded reference lines are not counted', () => {
  const sample = `# 题目\n\n第一段。\n\n> 引文${'\n\n'}[来源：资料](field://node/${textSource.id})\n\n第三段，\n同一段的第二行。\n\n## 小节\n\n- 列表一\n- 列表二`;
  const state = EditorState.create({ doc: sample });
  const spans = analyzeDraftReferences(sample);
  const referenceLines = new Set(spans.map(span => state.doc.lineAt(span.from).number));
  const structure = analyzeDraftStructure(state.doc, referenceLines);
  const numbered = [...structure.paragraph.entries()].filter(([, value]) => value > 0).map(([line, value]) => [state.doc.line(line).text, value]);
  assert.deepEqual(numbered, [['第一段。', 1], ['> 引文', 2], ['第三段，', 3], ['- 列表一', 4]]);
  assert.equal(structure.kinds[0], 'heading');
  assert.equal(structure.kinds[state.doc.lineAt(spans[0].from).number - 1], 'reference');
  const fenced = analyzeDraftStructure(Text.of(['```', '[x](field://node/a)', '```', '', '后文']), new Set());
  assert.deepEqual([...fenced.kinds], ['fence', 'code', 'fence', 'blank', 'text']);
});

test('inserting into the editor gives the same body and caret as insertDraftText (C11)', () => {
  const raw = '甲\r\n乙\r丙🌿丁';
  const lf = raw.replace(/\r\n?/g, '\n');
  const cases: [number, number, string, [string, string] | undefined][] = [
    [4, 6, '新增\r\n一行\r尾', undefined],
    [2, 2, formatDraftQuote(textQuote), undefined],
    [0, 1, '小标题', ['\n## ', '\n']],
    [lf.length, lf.length, '列表内容', ['\n- ', '\n']],
  ];
  for (const [from, to, text, wrap] of cases) {
    const state = EditorState.create({ doc: raw, selection: EditorSelection.single(from, to) });
    assert.equal(state.doc.toString(), lf, 'the editor holds the LF view of a CRLF body');
    const insertion = draftInsertion(state, text, wrap);
    assert.ok(insertion);
    const next = state.update(insertion.spec).state;
    const expected = insertDraftText(raw, from, to, text, wrap);
    assert.equal(next.doc.toString(), expected.body);
    assert.equal(next.selection.main.head, expected.cursor);
    assert.equal(insertion.body, expected.body);
  }
});

test('a quotation after empty lines does not add more of them (INSP-36)', () => {
  const quote = formatDraftQuote(videoQuote);
  assert.ok(quote.startsWith('\n\n> '), 'formatDraftQuote itself is unchanged (K1)');
  const paragraph = '一段话。';
  for (const [before, expectedLead] of [[paragraph, 2], [`${paragraph}\n`, 1], [`${paragraph}\n\n`, 0], [`${paragraph}\n  \n`, 0], ['', 0]] as const) {
    const fitted = fitQuoteToCaret(before, quote);
    assert.equal(/^\n*/.exec(fitted)![0].length, expectedLead, JSON.stringify(before));
    assert.equal(fitted.replace(/^\n*/, ''), quote.replace(/^\n*/, ''), 'only leading line breaks are dropped');
    assert.match(before + fitted, /([^\n]|^)(\n[ \t]*)*\n?> /);
  }
  assert.equal(fitQuoteToCaret(`${paragraph}\n\n`, '纯文字'), '纯文字', 'text without leading breaks is left alone');
});

test('counts and reading time read only the prose (PW-B2)', () => {
  const quotedCount = draftQuotedCharacterCount(body);
  assert.equal(quotedCount, Array.from('一座城市是否宜居，要看一个人步行十五分钟能完成多少件事。').length);
  assert.ok(draftCharacterCount(body) > quotedCount);
  const plain = '凌晨四点，老周的早餐摊已经亮着灯。'.repeat(20);
  const withLinks = `${plain}${formatDraftQuote(textQuote).replace(/> [^\n]+/, '')}`;
  assert.equal(readingMinutes(withLinks), readingMinutes(plain), 'UUIDs and link markup add no reading time');
  assert.match(readingLength('字'.repeat(2400)), /^6 分钟$/);
  assert.equal(readingLength('短句。'), '不到 1 分钟');
  assert.equal(readingLength(''), '0 分钟');
});

test('a version preview lists readable paragraphs without link markup', () => {
  assert.deepEqual(versionParagraphs(`# 题目\n\n第一段 **重点**。${formatDraftQuote(textQuote)}结尾。`), ['题目', '第一段 重点。', '一座城市是否宜居，要看一个人步行十五分钟能完成多少件事。', '结尾。']);
});

test('a superscript right after full-width closing punctuation tucks into the punctuation\'s empty half', () => {
  const sample = `他说：“四点出摊不是为了赚钱。”[来源：资料](field://node/${textSource.id})接着写。${formatDraftQuote(textQuote)}没有标点的引用[来源：资料](field://node/${textSource.id})`;
  const state = EditorState.create({ doc: sample, extensions: [referenceExtension] });
  const widgets: { from: number; afterPunct: boolean }[] = [];
  state.field(referenceField).decorations.between(0, sample.length, (from, _to, value) => {
    const widget = value.spec.widget as { afterPunct?: boolean } | undefined;
    if (widget && 'afterPunct' in widget) widgets.push({ from, afterPunct: !!widget.afterPunct });
  });
  assert.deepEqual(widgets.map(widget => widget.afterPunct), [true, true, false], '” and 。 tuck in; a plain character does not');
});

test('margin and drawer cards name their actions with the contract words; the popover copy stays unique', () => {
  const [reference] = resolveReferences(analyzeDraftReferences(body), [textSource, textQuote, videoSource, videoQuote]);
  const actions = { open: () => {}, locate: () => {} };
  const names = (variant: 'margin' | 'popover') => getAllBy(renderToStaticMarkup(createElement(SourceCard, { reference, variant, actions })), { tag: 'button' })
    .map(element => attr(element, 'aria-label') || textContent(element));
  const margin = names('margin');
  assert.ok(margin.includes('查看第1处引用来源') && margin.includes('定位第1处引用到正文'), `margin card: ${margin.join(' | ')}`);
  assert.ok(margin.includes('回到原文第 2 段'), 'the tag names its return action');
  const popover = names('popover');
  assert.ok(popover.includes('查看来源') && popover.includes('定位到正文'), `popover: ${popover.join(' | ')}`);
  assert.equal(popover.some(name => /第\d+处引用/.test(name)), false, 'contract names appear once, on the margin card');
});
