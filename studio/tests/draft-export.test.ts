import test from 'node:test';
import assert from 'node:assert/strict';
import { createNode } from '../src/board-utils';
import { createBoard } from '../src/storage';
import { exportDraftMarkdown, exportBoardMarkdown } from '../src/draft-export';
import { formatDraftQuote, formatSourceLink } from '../src/draft-references';

test('pure manuscript preserves authored prose and the captured quotation without internal provenance', () => {
  const source = createNode('link'); source.id = 'source'; source.data.title = '文献'; source.data.url = 'https://example.com/article';
  const quote = createNode('quote'); quote.data.citation = { nodeId: source.id, title: source.data.title, text: '原文 [字面] 保留。\r\n第二行。' };
  const draft = createNode('draft'); draft.data.title = '我的稿'; draft.data.body = `我的观点。${formatDraftQuote(quote)}结尾自己的表达。`;
  const output = exportDraftMarkdown(draft, [source, quote, draft], false);
  assert.ok(output.startsWith('# 我的稿\n\n我的观点。'));
  assert.ok(output.includes('> 原文 [字面] 保留。\r\n> 第二行。'));
  assert.ok(output.includes('结尾自己的表达。'));
  assert.doesNotMatch(output, /field:\/\/|来源：|## 来源|example\.com/);
  assert.equal(draft.data.body, `我的观点。${formatDraftQuote(quote)}结尾自己的表达。`);
});

test('portable sources follow citation order and use original HTTP links instead of local playback URLs', () => {
  const video = createNode('video'); video.id = 'video'; video.data.title = '原片';
  video.data.url = 'media://private-asset/clip.mp4'; video.data.sourceUrl = 'https://example.com/watch?v=1'; video.data.nativeDirectory = 'C:\\private\\资料';
  const local = createNode('image'); local.id = 'local'; local.data.title = '本地参考'; local.data.mediaId = 'asset-id';
  const draft = createNode('draft'); draft.data.body = `[视频出处](${formatSourceLink(video.id, 0)})\n\n我的文字\n\n[画面出处](${formatSourceLink(local.id)})`;
  const output = exportDraftMarkdown(draft, [video, local, draft], true);
  assert.ok(output.includes('视频出处[^source-1]')); assert.ok(output.includes('画面出处[^source-2]'));
  assert.ok(output.includes('[^source-1]: 原片 · 00:00。原始视频来源。 原始链接：<https://example.com/watch?v=1>'));
  assert.ok(output.includes('[^source-2]: 本地参考。本机图片资料；交付时请另附原始文件。'));
  assert.ok(output.indexOf('[^source-1]:') < output.indexOf('[^source-2]:'));
  assert.doesNotMatch(output, /field:\/\/|media:\/\/|C:\\private/);
});

test('deleted sources explicitly preserve snapshots and code examples are left exact in either mode', () => {
  const draft = createNode('draft');
  const code = '`field://node/literal?t=4`\n\n```md\n[示例](field://node/literal)\n```';
  draft.data.body = `开头\n\n> 已保留的原文\n\n[来源：旧资料](${formatSourceLink('deleted', 6.25)})\n\n${code}`;
  const linked = exportDraftMarkdown(draft, [draft], true), pure = exportDraftMarkdown(draft, [draft], false);
  assert.ok(linked.includes('原始来源已移除；文稿中的引文为保留快照'));
  assert.ok(linked.includes('旧资料 · 00:06'));
  assert.ok(linked.includes('> 已保留的原文')); assert.ok(pure.includes('> 已保留的原文'));
  assert.ok(linked.includes(code)); assert.ok(pure.includes(code));
  assert.ok(!linked.includes('field://node/deleted')); assert.ok(!pure.includes('field://node/deleted'));
  draft.data.body = `[来源：旧资料 00:06](${formatSourceLink('deleted', 6.25)})`;
  assert.ok(exportDraftMarkdown(draft, [draft], true).includes('[^source-1]: 旧资料 · 00:06。'));
});

test('empty original source URL stays removed, while external author-written links remain untouched', () => {
  const source = createNode('video'); source.id = 'video'; source.data.sourceUrl = ''; source.data.url = 'https://example.com/removed'; source.data.mediaId = 'media';
  const draft = createNode('draft'); draft.data.body = `[自写网页](https://example.com/custom) [回查](${formatSourceLink(source.id)})`;
  const output = exportDraftMarkdown(draft, [source, draft], true);
  assert.ok(output.includes('[自写网页](https://example.com/custom)'));
  assert.ok(output.includes('本机视频资料'));
  assert.doesNotMatch(output, /example\.com\/removed/);
});

test('quote identity carries the captured title and time range and rejects unrelated quote metadata', () => {
  const source = createNode('video'); source.id = 'video'; source.data.title = '后来改名的原片'; source.data.sourceUrl = 'https://example.com/video';
  const quote = createNode('quote'); quote.id = 'quote'; quote.data.citation = { nodeId: source.id, title: '摘录时的原片', start: 10.25, end: 15.5, text: '准确原文。' };
  const draft = createNode('draft'); draft.data.body = formatDraftQuote(quote);
  const output = exportDraftMarkdown(draft, [source, quote, draft], true);
  assert.ok(output.includes('[^source-1]: 摘录时的原片 · 00:10–00:15'));
  assert.ok(output.includes('> 准确原文。')); assert.doesNotMatch(output, /field:\/\//);
  const foreignQuote = structuredClone(quote); foreignQuote.data.citation!.nodeId = 'another-source'; foreignQuote.data.citation!.title = '错误出处';
  const guarded = exportDraftMarkdown(draft, [source, foreignQuote, draft], true);
  assert.ok(guarded.includes('[^source-1]: 后来改名的原片 · 00:10。'));
  assert.ok(!guarded.includes('错误出处'));
  const missing = exportDraftMarkdown(draft, [quote, draft], true);
  assert.ok(missing.includes('摘录时的原片 · 00:10–00:15')); assert.ok(missing.includes('原始来源已移除'));
});

test('board export preserves spatial order, raw quotation and has unique footnote IDs across drafts', () => {
  const board = createBoard('blank'), source = createNode('link'), first = createNode('draft'), second = createNode('draft'), quote = createNode('quote');
  source.id = 'source'; source.data.title = '网页'; source.data.url = 'https://example.com/source'; source.position.y = 0;
  first.position.y = 100; first.data.title = '第一稿'; first.data.body = `正文甲 [出处](${formatSourceLink(source.id)})`;
  second.position.y = 200; second.data.title = '第二稿'; second.data.body = `正文乙 [出处](${formatSourceLink(source.id)})`;
  quote.position.y = 300; quote.data.body = '自己的理解'; quote.data.citation = { nodeId: source.id, title: source.data.title, text: '原文不改。' };
  board.nodes = [second, quote, first, source];
  const snapshot = structuredClone(board), output = exportBoardMarkdown(board);
  assert.ok(output.indexOf('## 第一稿') < output.indexOf('## 第二稿'));
  assert.ok(output.includes('> 原文不改。')); assert.ok(output.includes('我的理解：自己的理解'));
  const ids = [...output.matchAll(/^\[\^([^\]]+)\]:/gm)].map(match => match[1]);
  assert.equal(ids.length, 2); assert.equal(new Set(ids).size, 2);
  assert.doesNotMatch(output, /field:\/\//); assert.deepEqual(board, snapshot);
});

test('W-M4: the board export nests material headings under their card and keeps TXT paragraphs apart', async () => {
  const { parser } = await import('@lezer/markdown');
  const outline = (markdown: string) => {
    const headings: string[] = []; let paragraphs = 0;
    const tree = parser.parse(markdown);
    tree.iterate({ enter: node => {
      const level = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name)?.[1];
      if (level) headings.push(`H${level} ${markdown.slice(node.from, node.to).replace(/^#+\s*|\n[=-]+$/g, '').trim()}`);
      if (node.name === 'Paragraph') paragraphs++;
    } });
    return { headings, paragraphs };
  };
  const board = createBoard('blank'); board.title = '十五分钟的城市';
  const md = createNode('note'); md.id = 'md'; md.position.y = 0; md.data.title = '写作者的材料整理法'; md.data.tags = ['文字资料', 'Markdown'];
  md.data.body = '# 写作者的材料整理法\n\n导语。\n\n## 一、收集时就写下为什么\n\n正文。\n\n```md\n# 代码里的井号不是标题\n```\n\n小节\n---\n\n### 一个小检查\n\n结尾。';
  const lines = ['夜里十点的社区图书角', '　　我第一次注意到那个图书角，是在一个加班到很晚的冬夜，地铁站出口往东走两百米。', '　　便利店门口的三个旧书架上贴着手写的纸条：看完放回来就好，不用登记。', '　　', '　　后来我问过很多人，几乎每个人都路过那个书架，却很少有人真正停下来翻一翻。'];
  const txt = createNode('note'); txt.id = 'txt'; txt.position.y = 100; txt.data.title = '夜里十点的社区图书角'; txt.data.tags = ['文字资料', '纯文本'];
  txt.data.body = lines.join('\r\n');
  const poem = createNode('note'); poem.id = 'poem'; poem.position.y = 150; poem.data.title = '短句'; poem.data.tags = ['文字资料', '纯文本']; poem.data.body = '第一行\n第二行\n第三行';
  const draft = createNode('draft'); draft.position.y = 200; draft.data.title = '深夜读书的人需要什么';
  draft.data.body = `## 开头\n\n正文 [出处](${formatSourceLink(md.id)})`;
  board.nodes = [md, txt, poem, draft];
  const snapshot = structuredClone(board);
  const output = exportBoardMarkdown(board);
  const { headings } = outline(output);
  assert.deepEqual(headings, [
    'H1 十五分钟的城市',
    // CORE-33: the article's own “# 写作者的材料整理法” no longer repeats its card title.
    'H2 写作者的材料整理法', 'H4 一、收集时就写下为什么', 'H4 小节', 'H5 一个小检查',
    'H2 夜里十点的社区图书角',
    'H2 短句',
    'H2 深夜读书的人需要什么', 'H4 开头', 'H3 来源',
  ]);
  assert.ok(output.includes('```md\n# 代码里的井号不是标题\n```'), 'fenced code stays exact');
  const txtSection = output.slice(output.indexOf('## 夜里十点的社区图书角'), output.indexOf('## 短句'));
  assert.equal(outline(txtSection).paragraphs, 3, 'three prose lines stay three paragraphs; the TXT title line equal to the card title is not repeated (CORE-33)');
  assert.ok(!/^　/m.test(output), 'paragraph-leading full-width spaces are not exported');
  assert.ok(!/\n{3,}/.test(output), 'no runs of blank lines');
  assert.ok(output.includes('第一行  \n第二行  \n第三行'), 'short lines keep their breaks inside one paragraph');
  assert.deepEqual(board, snapshot, 'the board itself is untouched');
  // A single draft export keeps its own `## 来源` under the `#` title.
  assert.ok(exportDraftMarkdown(draft, board.nodes, true).includes('\n## 来源\n'));
});

test('CORE-14: a text source footnote names its paragraph and sentence; the board export keeps the place too', () => {
  const board = createBoard('blank');
  const article = createNode('note'); article.id = 'article'; article.data.title = '夜里十点的社区图书角'; article.data.tags = ['文字资料', '纯文本'];
  article.data.body = '夜里十点的社区图书角\n\n第一段。\n\n第二段。\n\n便利店门口的三个旧书架上贴着手写的纸条。';
  const sentence = '便利店门口的三个旧书架上贴着手写的纸条。';
  const from = article.data.body.indexOf(sentence);
  const quote = createNode('quote'); quote.id = 'q'; quote.data.title = `摘录 · ${article.data.title}`;
  quote.data.citation = { nodeId: article.id, title: article.data.title, text: sentence, textAnchor: { from, to: from + sentence.length, prefix: '', suffix: '' } };
  const draft = createNode('draft'); draft.data.title = '稿'; draft.data.body = `开头一段，按两次回车。\n\n${formatDraftQuote(quote)}结尾。`;
  board.nodes = [article, quote, draft];
  const output = exportDraftMarkdown(draft, board.nodes, true);
  assert.ok(output.includes(`[^source-1]: 夜里十点的社区图书角 · 第 3 段。原句：“${sentence}”。`), output);
  assert.doesNotMatch(output, /画布中的文字资料/);
  assert.ok(!/\n{3,}/.test(output), 'the inserted quotation leaves no run of blank lines');
  const plain = exportDraftMarkdown(draft, board.nodes, false);
  assert.ok(!/\n{3,}/.test(plain));
  const all = exportBoardMarkdown(board);
  assert.ok(all.includes('引用：夜里十点的社区图书角 · 第 3 段'), 'the excerpt keeps 第 3 段 in “文稿与参考资料”');
  assert.ok(all.includes('## 便利店门口的三个旧书架上贴着…') || all.includes(`## ${sentence.slice(0, 10)}`), 'the excerpt is titled by its sentence');
});
