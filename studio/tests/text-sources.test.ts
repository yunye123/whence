import assert from 'node:assert/strict';
import test from 'node:test';
import { createNode } from '../src/board-utils';
import { getCardBounds } from '../src/card-placement';
import { formatDraftQuote, parseDraftReferences } from '../src/draft-references';
import type { BoardNode } from '../src/model';
import { createBoard, exportBoard, importBoard, STORAGE_LIMITS, validateBoard } from '../src/storage';
import { createTextQuoteBatch, isTextSourceFile, readTextSource, TEXT_SOURCE_LIMITS } from '../src/text-sources';
import { createTextAnchor } from '../src/text-anchor';

function sourceBoard(kind: 'note' | 'link' = 'note', body = '第一段\r\n  第二段🙂保留前后空白  \n第三段') {
  const board = createBoard('blank'), source = createNode(kind, { x: 100, y: 80 });
  source.data.title = '阅读资料'; source.data.body = body;
  board.nodes = [source];
  return { board, source };
}

function overlaps(left: BoardNode, right: BoardNode) {
  const a = getCardBounds(left), b = getCardBounds(right);
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test('TXT and Markdown recognition uses the final extension, independent of Windows MIME hints', () => {
  for (const name of ['资料.txt', '文章.MD', '资料.v2.TXT']) {
    for (const type of ['', 'application/octet-stream', 'text/plain']) assert.equal(isTextSourceFile({ name, type }), true);
  }
  for (const name of ['资料.pdf', '资料.docx', '文章.md.exe', 'txt', '文章.md ', '网页.html']) assert.equal(isTextSourceFile({ name, type: 'text/plain' }), false);
});

test('UTF-8 import removes one leading BOM and preserves whitespace, line endings and literal markup', async () => {
  const body = '  开头\r\n# 标题\n<script>只是原文</script>\r末尾\t \n';
  const bytes = new TextEncoder().encode(`\uFEFF${body}`);
  const result = await readTextSource(new File([bytes], '资料.v2.MD', { type: 'application/octet-stream' }));
  assert.deepEqual(result, { title: '资料.v2', body, tags: ['文字资料', 'Markdown'] });
  const interiorBom = await readTextSource(new File(['开头\uFEFF原文'], '资料.txt'));
  assert.equal(interiorBom.body, '开头\uFEFF原文');
  const twoBoms = await readTextSource(new File([new TextEncoder().encode('\uFEFF\uFEFF原文')], '资料.txt'));
  assert.equal(twoBoms.body, '\uFEFF原文');
});

test('W-M2: GBK (GB18030) and UTF-16 TXT files import with the exact text and say which encoding was read', async () => {
  // 「夜里十点」在 GB18030 里的字节，CRLF 保留。
  const gbk = new Uint8Array([0xd2, 0xb9, 0xc0, 0xef, 0xca, 0xae, 0xb5, 0xe3, 0x0d, 0x0a, 0xa1, 0xa1, 0xa1, 0xa1, 0xce, 0xd2]);
  const result = await readTextSource(new File([gbk], '旧稿.txt'));
  assert.equal(result.body, ['夜里十点', '　　我'].join(String.fromCharCode(13, 10)));
  assert.equal(result.encoding, 'gb18030');
  assert.deepEqual(result.tags, ['文字资料', '纯文本']);
  const utf16 = new Uint8Array([0xff, 0xfe, 0x5c, 0x4e, 0x0a, 0x00, 0x61, 0x00]);
  const wide = await readTextSource(new File([utf16], '宽字符.txt'));
  assert.equal(wide.body, ['乜', 'a'].join(String.fromCharCode(10)));
  assert.equal(wide.encoding, 'utf-16le');
  assert.equal((await readTextSource(new File(['普通正文'], '普通.txt'))).encoding, undefined, 'UTF-8 stays the quiet default');
});

test('invalid UTF-8, NUL, empty and whitespace-only sources fail visibly', async () => {
  const damagedUtf8 = new TextEncoder().encode('这是一段用 UTF-8 保存的中文文字，中间少了一个字节。');
  for (const bytes of [new Uint8Array([0xc3, 0x28]), new Uint8Array([0xff, 0xfe, 0x61]), new Uint8Array([...damagedUtf8.slice(0, 7), ...damagedUtf8.slice(8)])]) {
    await assert.rejects(readTextSource(new File([bytes], '损坏.txt')), /无法识别的字符.*另存为/);
  }
  await assert.rejects(readTextSource(new File(['正文\u0000尾部'], '空字符.md')), /空字符/);
  for (const content of ['', ' \r\n\t\u3000', '\uFEFF']) await assert.rejects(readTextSource(new File([content], '空白.txt')), /没有可导入的正文/);
  await assert.rejects(readTextSource(new File(['正文'], '错误.pdf')), /TXT.*Markdown/);
});

test('file and UTF-16 body limits reject oversized material without truncating or reading oversized bytes', async () => {
  const exact = '🙂'.repeat(TEXT_SOURCE_LIMITS.characters / 2);
  assert.equal((await readTextSource(new File([exact], '边界.txt'))).body, exact);
  await assert.rejects(readTextSource(new File([`${exact}甲`], '过长.txt')), /100,000/);
  const tooLarge = new File([new Uint8Array(TEXT_SOURCE_LIMITS.bytes + 1)], '过大.txt');
  let read = false;
  tooLarge.arrayBuffer = async () => { read = true; return new ArrayBuffer(0); };
  await assert.rejects(readTextSource(tooLarge), /1 MB/);
  assert.equal(read, false);
  await assert.rejects(readTextSource(new File(['a'.repeat(TEXT_SOURCE_LIMITS.bytes)], '字节边界.txt')), /100,000/);
});

test('import title removes only the final extension and stays within 120 UTF-16 units without cutting emoji', async () => {
  const title = 'a'.repeat(119) + '🙂' + '剩余';
  const result = await readTextSource(new File(['正文'], `${title}.txt`));
  assert.equal(result.title, 'a'.repeat(119));
  assert.ok(result.title.length <= 120);
  assert.equal((await readTextSource(new File(['正文'], '资料.md.txt'))).title, '资料.md');
});

test('note and link selections create one immutable literal snapshot and one source edge without video metadata', () => {
  for (const kind of ['note', 'link'] as const) {
    const { board, source } = sourceBoard(kind);
    source.data.transcriptRevision = 'unrelated-video-field';
    const visibleBody = source.data.body.replace(/\r\n?/g, '\n');
    const from = visibleBody.indexOf('  第二段'), to = visibleBody.indexOf('\n第三段');
    const before = structuredClone(board);
    const result = createTextQuoteBatch(board, source.id, { from, to, bodySnapshot: source.data.body });
    assert.deepEqual(board, before);
    assert.equal(result.quotes.length, 1);
    assert.equal(result.board.nodes.length, board.nodes.length + 1);
    assert.equal(result.board.edges.length, board.edges.length + 1);
    const quote = result.quotes[0];
    assert.equal(quote.data.body, '');
    assert.deepEqual(quote.data.citation, { nodeId: source.id, title: source.data.title, text: '  第二段🙂保留前后空白  ', textAnchor: createTextAnchor(source.data.body, from, to) });
    assert.equal(result.board.edges[0].source, source.id);
    assert.equal(result.board.edges[0].target, quote.id);
    assert.deepEqual(result.board.viewport, board.viewport);
    assert.doesNotThrow(() => validateBoard(result.board));
  }
});

test('textarea LF offsets select the exact raw substring across CRLF, lone CR and emoji', () => {
  const body = '甲\r\n乙\r丙\n🙂丁\r\n末尾';
  const visible = body.replace(/\r\n?/g, '\n');
  const { board, source } = sourceBoard('note', body);
  const quote = createTextQuoteBatch(board, source.id, { from: visible.indexOf('乙'), to: visible.indexOf('末尾'), bodySnapshot: body }).quotes[0];
  assert.equal(quote.data.citation?.text, '乙\r丙\n🙂丁\r\n');
  assert.deepEqual(quote.data.citation?.textAnchor, { from: visible.indexOf('乙'), to: visible.indexOf('末尾'), prefix: '甲\n', suffix: '末尾' });
  const emojiFrom = visible.indexOf('🙂');
  assert.equal(createTextQuoteBatch(board, source.id, { from: emojiFrom, to: emojiFrom + 2, bodySnapshot: visible }).quotes[0].data.citation?.text, '🙂');
  assert.throws(() => createTextQuoteBatch(board, source.id, { from: emojiFrom, to: emojiFrom + 1 }), /完整字符/);
  assert.equal(source.data.body, body);
});

test('selection snapshots permit only newline normalization and bounds use the textarea length', () => {
  const { board, source } = sourceBoard('link', 'a\r\nb\rc');
  assert.equal(createTextQuoteBatch(board, source.id, { from: 2, to: 3, bodySnapshot: 'a\nb\nc' }).quotes[0].data.citation?.text, 'b');
  assert.throws(() => createTextQuoteBatch(board, source.id, { from: 2, to: 3, bodySnapshot: 'a\nB\nc' }), /正文已经变化/);
  assert.throws(() => createTextQuoteBatch(board, source.id, { from: 0, to: 6, bodySnapshot: source.data.body }), /选区无效/);
  assert.equal(createTextQuoteBatch(board, source.id, { from: 0, to: 5 }).quotes[0].data.citation?.text, source.data.body);
});

test('the 20,000-unit selection limit follows visible LF text while its snapshot retains original CRLF bytes', () => {
  const raw = '字\r\n'.repeat(10_000);
  const { board, source } = sourceBoard('note', `${raw}尾`);
  const quote = createTextQuoteBatch(board, source.id, { from: 0, to: 20_000 }).quotes[0];
  assert.equal(quote.data.citation?.text, raw);
  assert.equal(quote.data.citation?.text?.length, 30_000);
  assert.throws(() => createTextQuoteBatch(board, source.id, { from: 0, to: 20_001 }), /20,000/);
});

test('missing or unsupported sources and stale selection snapshots reject instead of creating misleading quotes', () => {
  const { board, source } = sourceBoard('note', '旧的正文');
  const range = { from: 0, to: 4, bodySnapshot: source.data.body };
  source.data.body = '新的正文';
  const before = structuredClone(board);
  assert.throws(() => createTextQuoteBatch(board, source.id, range), /正文已经变化，请重新选择要摘录的文字/);
  assert.throws(() => createTextQuoteBatch(board, 'missing', { from: 0, to: 1 }), /来源卡片已被移除/);
  for (const kind of ['video', 'image', 'draft', 'quote', 'frame'] as const) {
    const other = createNode(kind); other.data.body = '不能冒充文字来源';
    assert.throws(() => createTextQuoteBatch({ ...board, nodes: [other] }, other.id, { from: 0, to: 1 }), /笔记或网页资料/);
  }
  assert.deepEqual(board, before);
  assert.equal(createTextQuoteBatch(board, source.id, { from: 0, to: 4 }).quotes[0].data.citation?.text, '新的正文');
});

test('non-integer, reversed, out-of-bounds, blank and split-surrogate selections fail atomically', () => {
  const { board, source } = sourceBoard('note', '甲🙂乙 \n');
  const before = structuredClone(board);
  for (const range of [{ from: -1, to: 2 }, { from: 0.5, to: 2 }, { from: 0, to: NaN }, { from: 0, to: Infinity }, { from: 3, to: 2 }, { from: 2, to: 2 }, { from: 0, to: 99 }]) {
    assert.throws(() => createTextQuoteBatch(board, source.id, range), /选区无效/);
  }
  assert.throws(() => createTextQuoteBatch(board, source.id, { from: 1, to: 2 }), /完整字符/);
  assert.throws(() => createTextQuoteBatch(board, source.id, { from: 2, to: 3 }), /完整字符/);
  assert.throws(() => createTextQuoteBatch(board, source.id, { from: 4, to: 6 }), /有内容/);
  assert.deepEqual(board, before);
});

test('the exact 20,000-unit quote boundary succeeds while larger selections and capacity failures preserve the board', () => {
  const { board, source } = sourceBoard('note', '字'.repeat(20_001));
  const before = structuredClone(board);
  assert.equal(createTextQuoteBatch(board, source.id, { from: 0, to: 20_000 }).quotes[0].data.citation?.text?.length, 20_000);
  assert.throws(() => createTextQuoteBatch(board, source.id, { from: 0, to: 20_001 }), /20,000/);
  assert.throws(() => createTextQuoteBatch(board, source.id, { from: 0, to: 1 }, { limits: { nodes: 1, edges: 1500 } }), /1 张卡片/);
  assert.throws(() => createTextQuoteBatch(board, source.id, { from: 0, to: 1 }, { limits: { nodes: 500, edges: 0 } }), /0 条连线/);
  assert.deepEqual(board, before);
});

test('legacy stored sources longer than the new file import limit can still quote their later passages', () => {
  const body = `${'字'.repeat(100_050)}末段🙂`, { board, source } = sourceBoard('note', body);
  assert.doesNotThrow(() => validateBoard(board));
  const from = body.indexOf('末段'), result = createTextQuoteBatch(board, source.id, { from, to: body.length });
  assert.equal(result.quotes[0].data.citation?.text, '末段🙂');
  assert.equal(result.quotes[0].data.citation?.textAnchor?.from, from);
  assert.equal(result.quotes[0].data.citation?.textAnchor?.to, body.length);
  assert.equal(source.data.body, body);
});

test('storage validation prevents a partial successful result for malformed boards or invalid explicit positions', () => {
  const { board, source } = sourceBoard();
  const malformed = { ...board, edges: [{ id: 'dangling', source: source.id, target: 'missing' }] };
  const before = structuredClone(malformed);
  assert.throws(() => createTextQuoteBatch(malformed, source.id, { from: 0, to: 2 }), /不存在的卡片/);
  assert.deepEqual(malformed, before);
  assert.throws(() => createTextQuoteBatch(board, source.id, { from: 0, to: 2 }, { position: { x: 20_000_000, y: 0 } }), /范围|位置/);
  assert.throws(() => createTextQuoteBatch(board, source.id, { from: 0, to: 2 }, { position: { x: NaN, y: 0 } }), /位置无效/);
  const full = { ...board, nodes: [source, ...Array.from({ length: STORAGE_LIMITS.nodes - 1 }, () => createNode('note'))] };
  assert.throws(() => createTextQuoteBatch(full, source.id, { from: 0, to: 2 }, { limits: { nodes: 9999, edges: 9999 } }), /500 张卡片/);
  assert.equal(full.nodes.length, STORAGE_LIMITS.nodes);
});

test('repeated text excerpts avoid existing cards and each other, while an explicit placement is retained', () => {
  const { board, source } = sourceBoard();
  const blocker = createNode('note', { x: 460, y: 115 }); blocker.style = { width: 400, height: 800 };
  board.nodes.push(blocker);
  let current = board;
  const quotes: BoardNode[] = [];
  for (let count = 0; count < 4; count++) {
    const result = createTextQuoteBatch(current, source.id, { from: 0, to: 3 }, { measurements: { [source.id]: { width: 500, height: 700 } } });
    current = result.board; quotes.push(result.quotes[0]);
  }
  for (const [index, quote] of quotes.entries()) {
    assert.ok(quote.position.x >= source.position.x + 500);
    assert.equal(overlaps(quote, blocker), false);
    assert.equal(overlaps(quote, source), false);
    for (const other of quotes.slice(index + 1)) assert.equal(overlaps(quote, other), false);
  }
  const point = { x: 42, y: 64 };
  assert.deepEqual(createTextQuoteBatch(board, source.id, { from: 0, to: 3 }, { position: point }).quotes[0].position, point);
});

test('source edits and deletion leave the quote snapshot intact; portable import remaps surviving citations and draft links', async () => {
  const { board, source } = sourceBoard('note', '原文 <标签> 与 **符号**\r\n第二段');
  const result = createTextQuoteBatch(board, source.id, { from: 0, to: source.data.body.replace(/\r\n?/g, '\n').length, bodySnapshot: source.data.body });
  const quote = result.quotes[0], snapshot = structuredClone(quote.data.citation);
  source.data.body = '后来重写的正文'; source.data.title = '后来改名';
  assert.deepEqual(quote.data.citation, snapshot);
  const draft = createNode('draft'); draft.data.body = formatDraftQuote(quote);
  const portable = { ...result.board, nodes: [...result.board.nodes, draft] };
  const imported = await importBoard(new File([await exportBoard(portable)], '文字画布.field.json'));
  const nextSource = imported.nodes.find(node => node.data.kind === 'note')!;
  const nextQuote = imported.nodes.find(node => node.data.kind === 'quote')!;
  assert.deepEqual(nextQuote.data.citation, { ...snapshot, nodeId: nextSource.id });
  assert.equal(parseDraftReferences(imported.nodes.find(node => node.data.kind === 'draft')!.data.body)[0].sourceNodeId, nextSource.id);
  assert.equal(parseDraftReferences(imported.nodes.find(node => node.data.kind === 'draft')!.data.body)[0].quoteNodeId, nextQuote.id);
  const deleted = { ...portable, nodes: portable.nodes.filter(node => node.id !== source.id), edges: [] };
  const restoredMissing = await importBoard(new File([await exportBoard(deleted)], '缺失来源.field.json'));
  assert.deepEqual(restoredMissing.nodes.find(node => node.data.kind === 'quote')!.data.citation, snapshot);
  assert.equal(parseDraftReferences(restoredMissing.nodes.find(node => node.data.kind === 'draft')!.data.body)[0].sourceNodeId, source.id);
});
