import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EditorState } from '@codemirror/state';
import { analyzeDraftStructure } from '../src/inspector/draft-editor/markdown';
import { isBlockPart, parseReadingDocument } from '../src/inspector/reading-markdown';
import { parseDraftReferences } from '../src/draft-references';
import {
  draftFootnotes, draftParagraphIndexAt, draftParagraphNumbers, draftPreviewParagraphs, draftReadableSegments,
  paragraphIndexAt, sourcePreviewParagraphs, type DraftSegment,
} from '../src/source-location';

const lf = (body: string) => body.replace(/\r\n?/g, '\n');
const display = (parts: readonly DraftSegment[]) => parts.map(part => 'text' in part ? part.text : `[${part.footnote}]`).join('');
const footnotes = (parts: readonly DraftSegment[]) => parts.flatMap(part => 'footnote' in part ? [part.footnote] : []);
const ref = (id: string) => `[来源：${id}](field://node/${id})`;
const longLines = [
  '　　我第一次注意到那个图书角，是在一个加班到很晚的冬夜，地铁站出口往东走两百米。  ',
  '\t便利店门口的三个旧书架上贴着手写的纸条：看完放回来就好，不用登记。\t',
  '　　',
  '　　后来我问过很多人，几乎每个人都路过那个书架，却很少有人真正停下来翻一翻。  ',
];
const mixedSource = [
  '  # 标题 🧭  ', '　　首段 **原样**，标点与空白不可丢。\t',
  '## 小节', '- 列表一\n- 列表二', '> 引文一\n> 引文二',
  '```ts\n# 注释 🧪\nconst n = 1;', 'const m = 2;\n```', '---',
  '## 同块标题\n' + longLines.join('\n'), '尾段。  ',
].join('\n\n');

function assertSourceMatchesReading(body: string) {
  const text = lf(body);
  const actual = sourcePreviewParagraphs(body);
  const reading = parseReadingDocument(text).parts.filter(isBlockPart);
  assert.deepEqual(actual.map(({ from, to, number, heading }) => ({ from, to, number, heading })),
    reading.map(block => ({ from: block.from, to: block.to, number: block.kind !== 'rule' && 'para' in block ? block.para : 0,
      heading: block.kind === 'heading' || block.kind === 'rule' })));
  for (const paragraph of actual) {
    assert.equal(paragraph.text, text.slice(paragraph.from, paragraph.to));
    assert.ok(paragraph.text.trim(), 'whitespace-only blocks are skipped');
    if (paragraph.number) assert.equal(paragraphIndexAt(body, paragraph.from), paragraph.number);
  }
}

function writingNumbers(body: string) {
  const text = lf(body);
  const state = EditorState.create({ doc: text });
  const references = parseDraftReferences(text);
  const referenceLines = new Set<number>();
  for (const reference of references) {
    const line = state.doc.lineAt(reference.from);
    let rest = line.text;
    for (const other of references.filter(item => item.from >= line.from && item.to <= line.to).reverse()) {
      rest = rest.slice(0, other.from - line.from) + rest.slice(other.to - line.from);
    }
    if (!rest.trim()) referenceLines.add(line.number);
  }
  const structure = analyzeDraftStructure(state.doc, referenceLines);
  return [...structure.paragraph.entries()].filter(([, number]) => number > 0)
    .map(([line, number]) => ({ from: state.doc.line(line).from, number }));
}

function assertDraftOwners(body: string) {
  const text = lf(body);
  const actual = draftPreviewParagraphs(body);
  const counted = actual.filter(paragraph => paragraph.number > 0);
  const writing = writingNumbers(body);
  assert.deepEqual(counted.map(paragraph => paragraph.number), writing.map(paragraph => paragraph.number));
  for (const paragraph of writing) {
    const preview = counted.find(item => item.number === paragraph.number)!;
    assert.ok(preview.from <= paragraph.from && paragraph.from < preview.to);
  }
  const { starts, owner } = draftParagraphNumbers(text);
  owner.forEach((number, line) => {
    if (!number) return;
    const preview = counted.find(item => item.number === number)!;
    assert.ok(preview.from <= starts[line] && starts[line] <= preview.to, `owner of line ${line + 1}`);
    assert.equal(draftParagraphIndexAt(body, starts[line]), preview.number);
  });
  const indices = actual.flatMap(paragraph => footnotes(paragraph.parts)).sort((a, b) => a - b);
  assert.deepEqual(indices, draftFootnotes(text).map(note => note.index), 'every global reference occurs once');
}

test('source: mixed headings, lists, quotes, fenced chunks and long TXT agree with reading and citation locations', () => {
  assertSourceMatchesReading(mixedSource);
  assertSourceMatchesReading(mixedSource.replace(/\n/g, '\r\n'));
  assertSourceMatchesReading('图书角\n' + longLines.join('\n'));
  assertSourceMatchesReading('## 小标题\n' + longLines.join('\n'));
});

test('source: short lines stay together, whitespace gaps skip, and title/rule number zero follows the existing contract', () => {
  for (const body of ['', ' \t\n\n　　\n', '# 独立标题', '---', '只有一行标题', '第一行\n第二行\n第三行',
    '标题\n正文。', '标题\n\n正文。', '\n\n\t正文。  \n\n\n尾段。', '```\n\n# 围栏内的标题\n\n```']) {
    assertSourceMatchesReading(body);
  }
  const paragraphs = sourcePreviewParagraphs('图书角\n' + longLines.join('\n'));
  assert.equal(paragraphs[0].text, '图书角\n', 'the title retains its original terminating LF');
  assert.deepEqual(paragraphs.slice(1).map(paragraph => paragraph.text), longLines.filter(line => line.trim()));
  assert.deepEqual(sourcePreviewParagraphs('---').map(paragraph => [paragraph.number, paragraph.heading]), [[0, true]]);
  assert.equal(sourcePreviewParagraphs('只有一行标题')[0].number, 1);
});

test('source: UTF-16 LF ranges retain spaces, Markdown and exact mark/wbr slices across emoji and paragraph boundaries', () => {
  const raw = '题目\r\n\r\n　　甲🧭乙 **加粗**  \r\n\r\n\t第二段🧪末尾。\t\r\n';
  const text = lf(raw);
  const paragraphs = sourcePreviewParagraphs(raw);
  const from = text.indexOf('🧭');
  const to = text.indexOf('🧪') + '🧪'.length;
  assert.equal('🧭'.length, 2);
  assert.notEqual(raw.indexOf('🧭'), from, 'raw CRLF offsets must not be passed as normalized offsets');
  for (const paragraph of paragraphs.filter(item => item.to > from && item.from < to)) {
    const localFrom = Math.max(from, paragraph.from) - paragraph.from;
    const localTo = Math.min(to, paragraph.to) - paragraph.from;
    const marked = paragraph.text.slice(localFrom, localTo);
    assert.equal(marked, text.slice(Math.max(from, paragraph.from), Math.min(to, paragraph.to)));
    // Removing zero-text mark/wbr wrappers must restore the verbatim paragraph; no Markdown cleanup here.
    assert.equal(paragraph.text.slice(0, localFrom) + marked + paragraph.text.slice(localTo), paragraph.text);
  }
  assert.equal(paragraphs[1].text, '　　甲🧭乙 **加粗**  ');
  assert.equal(paragraphs[2].text, '\t第二段🧪末尾。\t\n');
  assert.strictEqual(sourcePreviewParagraphs(raw.replace(/\r\n/g, '\r')), sourcePreviewParagraphs(text));
});

const mixedDraft = [
  '# 稿名 🧭', `第一段 **加粗**，\n第二行 ${ref('a')}。`,
  '## 小节', '- 列表一\n1. 列表二', '> 引文🧪\n> 下一行', `${ref('b')}  ${ref('c')}`,
  '```ts\n# 是代码\n' + ref('ignored-code') + '\n\nconst x = 1;\n```',
  `尾段 [网页](https://example.com) 与 ![图](asset.png) ${ref('d')}。`,
].join('\n\n');

test('draft: line owners and paragraph numbers agree with analyzeDraftStructure across headings, list, quote, fence and CRLF', () => {
  assertDraftOwners(mixedDraft);
  assertDraftOwners(mixedDraft.replace(/\n/g, '\r\n'));
  const paragraphs = draftPreviewParagraphs(mixedDraft);
  assert.deepEqual(paragraphs.filter(item => item.heading).map(item => item.number), [0, 0]);
  assert.deepEqual(footnotes(paragraphs.find(item => item.number === 3)!.parts), [2, 3], 'reference-only line folds into quote');
  assert.deepEqual(footnotes(paragraphs.find(item => item.number === 5)!.parts), [4], 'last paragraph uses full-draft numbering');
});

test('draft: readable parts use the existing rules and keep globally masked references inside code as literal code', () => {
  const body = `正文 **加粗** 与 \`内联\` [网址](https://example.com) ![图注](file.png) ${ref('a')}。`;
  assert.deepEqual(draftPreviewParagraphs(body)[0].parts, draftReadableSegments(body));
  assert.doesNotMatch(display(draftPreviewParagraphs(body)[0].parts), /field:\/\/|\*\*|https:\/\//);
  const paragraphs = draftPreviewParagraphs(mixedDraft);
  const code = paragraphs.find(paragraph => display(paragraph.parts).includes('ignored-code'))!;
  assert.equal(code.number, 4);
  assert.deepEqual(footnotes(code.parts), [], 'a slice must not turn globally fenced code into a reference');
  assert.ok(display(code.parts).includes('field://node/ignored-code'), 'literal code follows draftReadableSegments unchanged');
  assert.equal(footnotes(paragraphs[paragraphs.length - 1].parts)[0], 4);
  const splitFence = '```\n\n' + ref('masked') + '\n\n```\n\n尾段 ' + ref('real');
  assertDraftOwners(splitFence);
  assert.deepEqual(draftPreviewParagraphs(splitFence).flatMap(paragraph => footnotes(paragraph.parts)), [1]);
  assert.ok(draftPreviewParagraphs(splitFence).some(paragraph => display(paragraph.parts).includes('field://node/masked')));
  for (const literal of ['\\' + ref('escaped'), '`' + ref('inline-code') + '`', '[无效](field://node/a?bad=1)']) {
    const raw = '正文 ' + literal + '。';
    assert.deepEqual(draftPreviewParagraphs(raw)[0].parts, draftReadableSegments(raw));
  }
});

test('draft: independent reference lines merge into the preceding paragraph with whitespace and full-document indices', () => {
  const body = `  第一段🧭。\t\n\n  ${ref('a')}  \n\n\t${ref('b')}\t\n\n第二段 ${ref('c')}。`;
  assertDraftOwners(body);
  const paragraphs = draftPreviewParagraphs(body);
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0].from, 0);
  assert.equal(paragraphs[0].to, body.indexOf('\n\n第二段'));
  assert.deepEqual(paragraphs[0].parts, draftReadableSegments(body.slice(0, paragraphs[0].to)));
  assert.deepEqual(footnotes(paragraphs[1].parts), [3]);
  assert.equal(paragraphs[1].from, body.indexOf('第二段'));
  const fenceAndReference = `正文。\n\n\`\`\`\n\`\`\`\n${ref('a')}\n\n尾段。`;
  assertDraftOwners(fenceAndReference);
  const folded = draftPreviewParagraphs(fenceAndReference).find(paragraph => paragraph.number === 1)!;
  assert.deepEqual(footnotes(folded.parts), [1], 'a reference-only line adjacent to uncounted fence lines still folds above');
  assert.doesNotMatch(display(folded.parts), /```/, 'fence-only items remain separate');
});

test('draft: leading and heading-separated reference-only lines fold once without duplicating headings or reversing references', () => {
  const body = `${ref('a')}\n\n# 稿名\n\n${ref('b')}\n\n正文。\n\n## 小节\n\n${ref('c')}\n\n末段。`;
  assertDraftOwners(body);
  const paragraphs = draftPreviewParagraphs(body);
  const first = paragraphs.find(paragraph => paragraph.number === 1)!;
  assert.deepEqual(footnotes(first.parts), [1, 2, 3]);
  assert.doesNotMatch(display(first.parts), /稿名|小节/);
  assert.equal(first.from, 0);
  assert.equal(first.to, body.indexOf('\n\n末段'));
  assert.deepEqual(paragraphs.filter(paragraph => paragraph.heading).map(paragraph => display(paragraph.parts)), ['稿名', '小节']);
  for (const note of draftFootnotes(body)) {
    assert.equal(draftParagraphIndexAt(body, note.from), first.number);
  }
});

test('draft: blank documents skip, reference-only documents retain unnumbered global footnotes, and fence-only blocks do not invent owners', () => {
  assert.deepEqual(draftPreviewParagraphs(' \r\n\t\r\n　'), []);
  const onlyReferences = `${ref('a')}\n\n${ref('b')}`;
  assertDraftOwners(onlyReferences);
  assert.deepEqual(draftPreviewParagraphs(onlyReferences).map(item => item.number), [0, 0]);
  assert.deepEqual(draftPreviewParagraphs(onlyReferences).flatMap(item => footnotes(item.parts)), [1, 2]);
  for (const body of ['# 标题', '```\n```', '```\n\n代码🧪\n\n```', '## 同块标题\n正文。\n' + ref('a')]) {
    assertDraftOwners(body);
  }
});

test('both APIs: cache by normalized content, freeze arrays/items/parts, and leave strings and canonical owners unchanged', () => {
  const body = `# 标题\n\n正文🧪。 ${ref('a')}`;
  const owners = draftParagraphNumbers(body);
  const before = { starts: [...owners.starts], owner: [...owners.owner] };
  const source = sourcePreviewParagraphs(body);
  const draft = draftPreviewParagraphs(body);
  assert.strictEqual(sourcePreviewParagraphs(body.replace(/\n/g, '\r\n')), source);
  assert.strictEqual(draftPreviewParagraphs(body.replace(/\n/g, '\r')), draft);
  for (const result of [source, draft]) {
    assert.ok(Object.isFrozen(result));
    assert.ok(result.every(Object.isFrozen));
    assert.throws(() => { (result as unknown as { number: number }[])[0].number = 999; }, TypeError);
  }
  assert.ok(draft.every(paragraph => Object.isFrozen(paragraph.parts) && paragraph.parts.every(Object.isFrozen)));
  const textPart = draft[0].parts[0] as { text: string };
  assert.throws(() => { textPart.text = '改写'; }, TypeError);
  assert.deepEqual({ starts: owners.starts, owner: [...owners.owner] }, before);
  assert.strictEqual(draftParagraphNumbers(body), owners);
  assert.equal(body, `# 标题\n\n正文🧪。 ${ref('a')}`);
});

test('both APIs: bounded 200-entry FIFO caches preserve recent identity and evict old content independently', () => {
  const oldest = '缓存最早正文，🧭。';
  const source = sourcePreviewParagraphs(oldest);
  const draft = draftPreviewParagraphs(oldest);
  for (let index = 0; index < 200; index++) sourcePreviewParagraphs(`资料缓存正文 ${index}。`);
  assert.notStrictEqual(sourcePreviewParagraphs(oldest), source);
  assert.strictEqual(draftPreviewParagraphs(oldest), draft, 'the source cache cannot evict draft entries');
  for (let index = 0; index < 200; index++) draftPreviewParagraphs(`文稿缓存正文 ${index}。`);
  assert.notStrictEqual(draftPreviewParagraphs(oldest), draft);
  assert.deepEqual(sourcePreviewParagraphs(oldest), source);
  assert.deepEqual(draftPreviewParagraphs(oldest), draft);
  assert.strictEqual(sourcePreviewParagraphs('资料缓存正文 199。'), sourcePreviewParagraphs('资料缓存正文 199。'));
  assert.strictEqual(draftPreviewParagraphs('文稿缓存正文 199。'), draftPreviewParagraphs('文稿缓存正文 199。'));
});

test('product API module stays independent of reading/editor packages', () => {
  const source = readFileSync(new URL('../src/source-location.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import .*from ['"][^'"]*(?:inspector|codemirror|reading-markdown|draft-editor)/m);
});
