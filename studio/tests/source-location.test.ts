import test from 'node:test';
import assert from 'node:assert/strict';
import {
  citationLocationLabel, draftCharacterCount, draftFootnotes, draftReadableSegments,
  leadTitleEnd, paragraphIndexAt, quoteDisplayTitle, timeRangeLabel, uncountedChunk,
} from '../src/source-location';
import { plainTextParagraphs } from '../src/draft-export';
import { formatSourceLink } from '../src/draft-references';

test('paragraph numbers skip single-line headings and blank chunks', () => {
  const body = '# 标题\n\n第一段文字。\n\n\n第二段\n仍是第二段。\n\n## 小标题\n\n- 列表一\n- 列表二';
  assert.equal(paragraphIndexAt(body, body.indexOf('第一段')), 1);
  assert.equal(paragraphIndexAt(body, body.indexOf('仍是')), 2);
  assert.equal(paragraphIndexAt(body, body.indexOf('列表二')), 3);
  assert.equal(paragraphIndexAt(body, 0), 1, 'a heading resolves to the paragraph after it');
  assert.equal(paragraphIndexAt('', 0), undefined);
  assert.equal(paragraphIndexAt('一段话。\r\n\r\n二段话。', 8), 2, 'CRLF is normalized before counting');
});

test('CORE-13: a lone rule and a TXT title line take no paragraph number', () => {
  const md = '第一段。\n\n---\n\n第二段。\n\n***\n\n第三段。';
  assert.equal(paragraphIndexAt(md, md.indexOf('第二段')), 2, 'the rule between them is not a paragraph');
  assert.equal(paragraphIndexAt(md, md.indexOf('第三段')), 3);
  assert.equal(paragraphIndexAt(md, md.indexOf('---')), 2, 'a rule resolves to the paragraph after it');
  const txt = '夜里十点的社区图书角\n\n　　我第一次注意到那个图书角，是在一个加班到很晚的冬夜。\n\n　　后来我问过很多人。';
  assert.equal(paragraphIndexAt(txt, txt.indexOf('我第一次')), 1, 'the title line is not paragraph 1');
  assert.equal(paragraphIndexAt(txt, txt.indexOf('后来')), 2);
  assert.equal(uncountedChunk(txt, 0, txt.indexOf('\n'), true, true), 'title');
  const sentence = '这是一句完整的话。\n\n第二段。';
  assert.equal(paragraphIndexAt(sentence, sentence.indexOf('第二段')), 2, 'a first line that ends like a sentence still counts');
  assert.equal(paragraphIndexAt('只有一行标题', 0), 1, 'a lone short line with nothing after it is the text itself');
  const long = '这一行很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长没有标点\n\n下一段。';
  assert.equal(paragraphIndexAt(long, long.indexOf('下一段')), 2, 'more than 30 characters is not a title');
});

test('INSP-11 / CORE-13 (NEXT_ROUND decision): a TXT title followed by only one newline is a title, shared by reading, tags and export', () => {
  const txt = '夜里十点的社区图书角\n　　我第一次注意到那个图书角，是在一个加班到很晚的冬夜。\n\n　　后来我问过很多人。';
  assert.equal(leadTitleEnd(txt, 0, txt.indexOf('\n\n'), true), txt.indexOf('\n') + 1);
  assert.equal(paragraphIndexAt(txt, 0), 1, 'the title resolves to the paragraph after it');
  assert.equal(paragraphIndexAt(txt, txt.indexOf('我第一次')), 1, 'the line under the title is paragraph 1');
  assert.equal(paragraphIndexAt(txt, txt.indexOf('后来')), 2);
  const prose = '图书角\n第一行足够长，读起来像一段完整的散文段落，单换行之后是新的一段。\n第二行同样足够长，单个换行之后就是新的意思，不该和上一行挤成一团。';
  assert.equal(paragraphIndexAt(prose, prose.indexOf('第二行')), 2, 'long lines under the title still count one per line');
  const sentence = '这是一句完整的话。\n第二行接着写。';
  assert.equal(leadTitleEnd(sentence, 0, sentence.length, true), null, 'a first line that ends like a sentence is text');
  const tooLong = '这一行很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长没有标点\n下一行。';
  assert.equal(leadTitleEnd(tooLong, 0, tooLong.length, true), null, 'more than 30 characters is not a title');
  assert.equal(leadTitleEnd('标题\n正文。', 0, 6, false), null, 'only the document\'s first line can be the title');
  assert.equal(leadTitleEnd('- 列表\n- 第二项', 0, 9, true), null, 'Markdown block syntax is not a title');
  assert.equal(leadTitleEnd('只有一行', 0, 4, true), null, 'nothing after it: not a title');
  assert.equal(leadTitleEnd('第一行\n第二行\n第三行', 0, 11, true), null, 'short lines all alike (a poem, an address) have no title');
  assert.equal(leadTitleEnd('静夜思\n床前明月光，\n疑是地上霜。', 0, 17, true), 4, 'a short title over punctuated lines is a title');
  assert.equal(plainTextParagraphs('图书角\n这是第一句话。\n这是第二句话。'), '图书角\n\n这是第一句话。  \n这是第二句话。', 'the export keeps the title apart from the text');
  assert.equal(plainTextParagraphs('一句话。\n第二行'), '一句话。  \n第二行', 'no title: unchanged');
});

test('W-M1: a chunk of long single-newline lines counts one paragraph per line; other chunks count once', () => {
  const lines = ['夜里十点的社区图书角', '　　我第一次注意到那个图书角，是在一个加班到很晚的冬夜，地铁站出口往东走两百米。', '　　便利店门口的三个旧书架上贴着手写的纸条：看完放回来就好，不用登记。', '　　', '　　后来我问过很多人，几乎每个人都路过那个书架，却很少有人真正停下来翻一翻。'];
  const body = lines.join('\n');
  // The short first line followed by one newline is the title (NEXT_ROUND decision): it resolves to paragraph 1.
  assert.equal(paragraphIndexAt(body, body.indexOf('夜里')), 1);
  assert.equal(paragraphIndexAt(body, body.indexOf('我第一次')), 1);
  assert.equal(paragraphIndexAt(body, body.indexOf('便利店')), 2);
  assert.equal(paragraphIndexAt(body, body.indexOf('后来')), 3, 'a whitespace-only line is not counted');
  assert.equal(paragraphIndexAt(body, body.indexOf('便利店') - 1), 2, 'the newline between lines belongs to the next paragraph');
  const crlf = body.replace(/\n/g, '\r\n');
  assert.equal(paragraphIndexAt(crlf, body.indexOf('便利店')), 2, 'offsets are LF offsets of the normalized text');
  assert.equal(paragraphIndexAt('第一行\n第二行\n第三行', 8), 1, 'short lines (a poem, an address) stay one paragraph');
  const lead = '## 小标题\n第一行足够长，读起来像一段完整的散文段落，单换行之后是新的一段。\n第二行同样足够长，单个换行之后就是新的意思，不该和上一行挤成一团。';
  assert.equal(paragraphIndexAt(lead, 0), 1, 'the lead heading resolves to the first line');
  assert.equal(paragraphIndexAt(lead, lead.indexOf('第二行')), 2);
  const fenced = '```py\nx = 1\n\n# 注释\n\ny = 2\n```\n\n正文。';
  assert.equal(paragraphIndexAt(fenced, fenced.indexOf('正文')), 4, 'a # line inside a code fence is code, not a heading');
});

test('time range labels round the end up and switch to hours past 60 minutes', () => {
  assert.equal(timeRangeLabel(72, 85.2), '01:12–01:26');
  assert.equal(timeRangeLabel(3725), '1:02:05');
  assert.equal(timeRangeLabel(undefined), undefined);
  assert.equal(citationLocationLabel({ nodeId: 'a', title: 't', textAnchor: { from: 0, to: 1, prefix: '', suffix: '' } }, 3), '第 3 段');
  assert.equal(citationLocationLabel({ nodeId: 'a', title: 't', start: 72, end: 86 }), '01:12–01:26');
});

test('default quote titles display the quotation start; user titles stay', () => {
  const display = quoteDisplayTitle({ title: '摘录 · 01:12', body: '', citation: { nodeId: 'a', title: '', text: '摊主说，四点出摊不是为了赚钱，是为了等第一班公交的司机。' } });
  assert.ok(display.endsWith('…'));
  assert.ok([...display].length <= 19);
  assert.equal(quoteDisplayTitle({ title: '开头的论点', body: '任何原文' }), '开头的论点');
  assert.equal(quoteDisplayTitle({ title: '摘录 · 00:06', body: '短句。' }), '短句。');
  assert.equal(quoteDisplayTitle({ title: '摘录 · 第 3 段', body: '原文一句。' }), '原文一句。');
});

test('draft footnotes and readable text never expose field links', () => {
  const href = formatSourceLink('node-1', 72, 'quote-1');
  const body = `开头。\n\n> 一句原文\n\n[来源：凌晨四点的早餐摊 01:12](${href})\n\n结尾。`;
  const notes = draftFootnotes(body);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].label, '凌晨四点的早餐摊');
  assert.equal(notes[0].location, '01:12');
  assert.equal(notes[0].quoteNodeId, 'quote-1');
  const readable = draftReadableSegments(body).map(segment => ('text' in segment ? segment.text : `[${segment.footnote}]`)).join('');
  assert.doesNotMatch(readable, /field:|\]\(|^>/m);
  assert.match(readable, /\[1\]/);
  assert.equal(draftCharacterCount(body), [...'开头。一句原文结尾。'].length);
});

test('C13: stored time ranges and “摘录 · <source title>” are default titles too; a renamed quote keeps its name', () => {
  const citation = { nodeId: 'a', title: '步行十五分钟能到的城市', text: '菜市场是他每天要去的地方。' };
  assert.equal(quoteDisplayTitle({ title: '摘录 · 01:12–01:26', body: '', citation }), '菜市场是他每天要去的地方。');
  assert.equal(quoteDisplayTitle({ title: '摘录 · 步行十五分钟能到的城市', body: '', citation }), '菜市场是他每天要去的地方。');
  assert.equal(quoteDisplayTitle({ title: '摘录 · 步行十五分钟', body: '', citation }), '菜市场是他每天要去的地方。');
  assert.equal(quoteDisplayTitle({ title: '摘录 · 我自己的题目', body: '', citation }), '摘录 · 我自己的题目');
});

test('CORE-21: timecode rolls over to hours, so every place reads like the tag', async () => {
  const { timecode } = await import('../src/model');
  assert.equal(timecode(59), '00:59');
  assert.equal(timecode(3599), '59:59');
  assert.equal(timecode(3600), '1:00:00');
  assert.equal(timecode(4512), '1:15:12');
  assert.equal(timeRangeLabel(4512, 4538.2), '1:15:12–1:15:39');
});

test('CORE-35: a line break between CJK text disappears on one line; between Western words it is a space', async () => {
  const { singleLineText } = await import('../src/source-location');
  assert.equal(singleLineText('四点出摊不是为了赚钱，\n是怕老主顾扑空。'), '四点出摊不是为了赚钱，是怕老主顾扑空。');
  assert.equal(singleLineText('the quick\nbrown fox'), 'the quick brown fox');
  assert.equal(singleLineText('中文\r\nEnglish'), '中文 English');
  assert.equal(quoteDisplayTitle({ title: '摘录 · 00:28', body: '', citation: { nodeId: 'v', title: '片', text: '赚钱，\n是怕' } }), '赚钱，是怕');
});
