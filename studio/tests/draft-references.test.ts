import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDraftQuote, formatSourceLink, parseDraftReferences, parseSourceLink, remapDraftSourceLinks } from '../src/draft-references';
import { createNode, duplicateNode } from '../src/board-utils';
import { createBoard, exportBoard, importBoard } from '../src/storage';

test('source targets round trip encoded IDs, zero and fractional timestamps', () => {
  for (const sourceNodeId of ['source-1', '中文 [来源]/(一)\\路径', 'old(id)', "apostrophe'", '含 空格']) {
    for (const time of [undefined, 0, .125, 604800, 1e-7]) {
      const href = formatSourceLink(sourceNodeId, time);
      assert.deepEqual(parseSourceLink(href), { sourceNodeId, ...(time === undefined ? {} : { time }) });
      assert.ok(!/[()\[\]\\'\s]/.test(href));
    }
  }
  assert.deepEqual(parseSourceLink('field://node/legacy(one)?t=6.25'), { sourceNodeId: 'legacy(one)', time: 6.25 });
});

test('quote-aware targets round trip either query order, encoded IDs, and optional video time', () => {
  for (const sourceNodeId of ['source', '中文 / 资料🙂']) {
    for (const quoteNodeId of ['quote', '摘录 [二]🙂/?&#']) {
      for (const time of [undefined, 0, 6.25]) {
        const href = formatSourceLink(sourceNodeId, time, quoteNodeId);
        assert.deepEqual(parseSourceLink(href), { sourceNodeId, quoteNodeId, ...(time === undefined ? {} : { time }) });
        assert.ok(!/[()\[\]\\'\s]/.test(href));
      }
    }
  }
  assert.deepEqual(parseSourceLink('field://node/source?t=06.250&quote=excerpt'), { sourceNodeId: 'source', time: 6.25, quoteNodeId: 'excerpt' });
  assert.deepEqual(parseSourceLink('field://node/source?quote=excerpt&t=.5'), { sourceNodeId: 'source', quoteNodeId: 'excerpt', time: .5 });
  const sourceNodeId = '源'.repeat(160), quoteNodeId = '摘'.repeat(160);
  assert.deepEqual(parseSourceLink(formatSourceLink(sourceNodeId, 0, quoteNodeId)), { sourceNodeId, quoteNodeId, time: 0 });
});

test('bad percent encodings, ambiguous targets and invalid times never throw or become playable links', () => {
  for (const href of [
    'field://node/%E0%A4%A', 'field://node/%', 'field://node/%00', 'field://node/', 'field://node/a/b',
    'https://node/id?t=1', 'field://user@node/id', 'field://node/id#part',
    'field://node/id?t=', 'field://node/id?t=-1', 'field://node/id?t=Infinity', 'field://node/id?t=NaN',
    'field://node/id?t=604801', 'field://node/id?t=0x10', 'field://node/id?t=1&t=2', 'field://node/id?t=%',
    'field://node/id?other=1', 'field://node/id?t=1garbage',
    'field://node/id?quote=', 'field://node/id?quote=%00', 'field://node/id?quote=%',
    'field://node/id?quote=a&quote=b', 'field://node/id?quote=a&t=1&t=2', 'field://node/id?quote=a&other=1',
    'field://node/id?quote=a&', 'field://node/id?quote=a#part', 'field://node/id?quote=a&t=-1',
    `field://node/id?quote=${'a'.repeat(161)}`,
    'field://node/id?quote=\uD800', 'field://node/\uDC00',
  ]) assert.equal(parseSourceLink(href), null, href);
});

test('formatting rejects malformed identities and query injection through an untyped timestamp', () => {
  for (const sourceId of ['', ' ', '\u0000', '\uD800', 'a'.repeat(161)]) assert.throws(() => formatSourceLink(sourceId), /引用来源/);
  for (const quoteId of ['', '\u007f', '\uDC00', 'a'.repeat(161)]) assert.throws(() => formatSourceLink('source', 0, quoteId), /引用来源/);
  for (const time of [-1, Infinity, NaN, 604801, '1&quote=forged' as unknown as number]) assert.throws(() => formatSourceLink('source', time), /引用来源/);
});

test('source and quote IDs remap independently while time spelling, prose, code and link titles stay exact', () => {
  const source = '来源(one)', quote = '摘录(two)';
  const body = `[引用](<field://node/${encodeURIComponent(source)}?t=06.250&quote=${encodeURIComponent(quote)}> "原题")\n`
    + 'field://node/missing-source?quote=surviving-quote&t=0\n'
    + 'field://node/surviving-source?quote=missing-quote\n'
    + '`field://node/missing-source?quote=surviving-quote`';
  const remapped = remapDraftSourceLinks(body, new Map([[source, 'new-source'], [quote, 'new-quote'], ['surviving-quote', 'new-surviving-quote'], ['surviving-source', 'new-surviving-source']]));
  assert.equal(remapped, body.replace(encodeURIComponent(source), 'new-source').replace(encodeURIComponent(quote), 'new-quote')
    .replace('quote=surviving-quote&t=0', 'quote=new-surviving-quote&t=0').replace('node/surviving-source?', 'node/new-surviving-source?'));
  const refs = parseDraftReferences(remapped);
  assert.deepEqual(refs.map(reference => [reference.sourceNodeId, reference.quoteNodeId, reference.time]), [
    ['new-source', 'new-quote', 6.25], ['missing-source', 'new-surviving-quote', 0], ['new-surviving-source', 'missing-quote', undefined],
  ]);
  assert.throws(() => remapDraftSourceLinks(body, new Map([[source, '\u0000']])), /引用来源/);
});

test('portable quote-aware import remaps both identities in current and historical draft text', async () => {
  const board = createBoard('blank'), source = createNode('note'), quote = createNode('quote'), draft = createNode('draft');
  source.data.body = '原文';
  quote.data.citation = { nodeId: source.id, title: source.data.title, text: '原文' };
  draft.data.body = formatDraftQuote(quote);
  draft.data.draftVersions = [{ id: 'version', title: '旧稿', body: draft.data.body, createdAt: board.createdAt }];
  board.nodes = [source, quote, draft];
  const imported = await importBoard(new File([await exportBoard(board)], 'with-quotes.field.json'));
  const nextSource = imported.nodes.find(node => node.data.kind === 'note')!, nextQuote = imported.nodes.find(node => node.data.kind === 'quote')!, nextDraft = imported.nodes.find(node => node.data.kind === 'draft')!;
  for (const body of [nextDraft.data.body, nextDraft.data.draftVersions![0].body]) {
    const ref = parseDraftReferences(body)[0];
    assert.equal(ref.sourceNodeId, nextSource.id);
    assert.equal(ref.quoteNodeId, nextQuote.id);
  }
  assert.equal(nextQuote.data.citation!.nodeId, nextSource.id);
});

test('occurrences keep order, duplicates, absent source IDs and exact textarea UTF-16 offsets', () => {
  const first = '[来源甲](field://node/source?t=0)', second = '[再看甲](field://node/source?t=6.5)';
  const body = `🙂 文稿开头 ${first}\n${second}\n${first}\nfield://node/already-deleted?t=8`;
  const refs = parseDraftReferences(body);
  assert.equal(refs.length, 4);
  assert.deepEqual(refs.map(({ sourceNodeId, time }) => [sourceNodeId, time]), [['source', 0], ['source', 6.5], ['source', 0], ['already-deleted', 8]]);
  assert.equal(new Set(refs.map(reference => reference.id)).size, 4);
  assert.equal(refs[0].from, body.indexOf(first));
  assert.equal(refs[0].to, body.indexOf(first) + first.length);
  assert.deepEqual(refs.map(reference => body.slice(reference.from, reference.to)), [first, second, first, 'field://node/already-deleted?t=8']);
  assert.deepEqual(parseDraftReferences(body), refs);
});

test('quote insertion escapes Markdown labels and preserves every character of the captured text', () => {
  const quote = createNode('quote');
  const snapshot = '原文 [不改](字面) \\ 路径\r\n第二行\r第三行\n最后一行\n';
  quote.data.body = '自己的理解不能替换原文';
  quote.data.citation = { nodeId: 'source(one)', title: '标题 [甲](乙) \\ 目录\r\n续行', start: 6.25, text: snapshot };
  const inserted = formatDraftQuote(quote);
  const quoteEnd = inserted.lastIndexOf('\n\n[来源：');
  const recovered = inserted.slice(2, quoteEnd).replace(/(^|\r\n|\r|\n)> /g, '$1');
  assert.equal(recovered, snapshot);
  const refs = parseDraftReferences(inserted);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].label, '来源：标题 [甲](乙) \\ 目录 续行 00:06');
  assert.equal(refs[0].sourceNodeId, 'source(one)');
  assert.equal(refs[0].quoteNodeId, quote.id);
  assert.equal(refs[0].time, 6.25);
  assert.ok(inserted.includes(`source%28one%29?quote=${quote.id}&t=6.25`));
});

test('legacy quote without citation links to the quote itself and keeps its body', () => {
  const quote = createNode('quote'); quote.data.body = '旧摘录原文';
  const formatted = formatDraftQuote(quote);
  assert.ok(formatted.includes('> 旧摘录原文'));
  assert.equal(parseDraftReferences(formatted)[0].sourceNodeId, quote.id);
});

test('existing links with unescaped balanced ID parentheses remain navigable and remappable', () => {
  const body = '[来源](field://node/old(one(two))?t=06.250)';
  const refs = parseDraftReferences(body);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].sourceNodeId, 'old(one(two))');
  assert.equal(refs[0].time, 6.25);
  assert.equal(body.slice(refs[0].from, refs[0].to), body);
  assert.equal(remapDraftSourceLinks(body, new Map([['old(one(two))', 'new-id']])), '[来源](field://node/new-id?t=06.250)');
  const bare = '(field://node/old(one(two))?t=06.250)';
  assert.equal(parseDraftReferences(bare)[0].sourceNodeId, 'old(one(two))');
  assert.equal(remapDraftSourceLinks(bare, new Map([['old(one(two))', 'new-id']])), '(field://node/new-id?t=06.250)');
});

test('bare links, angle destinations and optional titles work without inventing external or image references', () => {
  const body = '查看 field://node/one?t=.5，另见 <field://node/two>。\n[三](<field://node/three?t=0> "说明")\n![图](field://node/image) [网页](https://example.com/field://node/fake)';
  const refs = parseDraftReferences(body);
  assert.deepEqual(refs.map(reference => reference.sourceNodeId), ['one', 'two', 'three']);
  assert.equal(refs[0].time, .5);
  assert.equal(body.slice(refs[1].from, refs[1].to), '<field://node/two>');
});

test('inline code and fenced code examples are excluded and remain unchanged during remap', () => {
  const body = [
    '`field://node/source?t=1`', '``[来源](field://node/source?t=2)``',
    '```md', '[来源](field://node/source?t=3)', '```',
    '~~~', 'field://node/source?t=4', '~~~',
    '[真的引用](field://node/source?t=5)', 'field://node/source?t=6',
    '```', 'field://node/source?t=7',
  ].join('\n');
  assert.deepEqual(parseDraftReferences(body).map(reference => reference.time), [5, 6]);
  const remapped = remapDraftSourceLinks(body, new Map([['source', 'new-source']]));
  assert.equal(remapped, body.replace('source?t=5', 'new-source?t=5').replace('source?t=6', 'new-source?t=6'));
});

test('malformed links do not prevent later valid references or trigger partial timestamp acceptance', () => {
  const body = '[损坏](field://node/one?t=nope) [不完整 [有效](field://node/two?t=2)\nfield://node/%broken [最后](field://node/three?t=3)';
  assert.deepEqual(parseDraftReferences(body).map(reference => reference.sourceNodeId), ['two', 'three']);
  assert.deepEqual(parseDraftReferences('[损坏](field://node/one?t=-1) field://node/two?t=1xyz'), []);
});

test('single draft duplication keeps original source identity and version bodies', () => {
  const draft = createNode('draft'); draft.data.body = '[来源](field://node/source?t=4)';
  draft.data.draftVersions = [{ id: 'v1', title: '旧稿', body: draft.data.body, createdAt: new Date().toISOString() }];
  const copy = duplicateNode(draft);
  assert.notEqual(copy.id, draft.id);
  assert.equal(copy.data.body, draft.data.body);
  assert.equal(copy.data.draftVersions![0].body, draft.data.body);
  assert.equal(parseDraftReferences(copy.data.body)[0].sourceNodeId, 'source');
});

test('portable import remaps body and historical versions, retaining exact times and missing-source snapshots', async () => {
  const board = createBoard('blank'), video = createNode('video'), draft = createNode('draft'), quote = createNode('quote');
  video.id = 'legacy(one)';
  draft.data.body = '[来源](field://node/legacy(one)?t=06.250)\nfield://node/legacy(one)?t=3\n`field://node/legacy(one)?t=4`\n[缺失](field://node/deleted?t=5)';
  draft.data.draftVersions = [{ id: 'version-1', title: '第一稿', body: draft.data.body, createdAt: board.createdAt }];
  quote.data.citation = { nodeId: 'deleted', title: '已删除原片', start: 5, text: '摘录快照' };
  board.nodes = [video, draft, quote];
  const archive = await exportBoard(board);
  const imported = await importBoard(new File([archive], 'roundtrip.field.json', { type: 'application/json' }));
  const nextVideo = imported.nodes.find(node => node.data.kind === 'video')!;
  const nextDraft = imported.nodes.find(node => node.data.kind === 'draft')!;
  const expected = draft.data.body.replace('field://node/legacy(one)?t=06.250', `field://node/${nextVideo.id}?t=06.250`).replace('field://node/legacy(one)?t=3', `field://node/${nextVideo.id}?t=3`);
  assert.equal(nextDraft.data.body, expected);
  assert.equal(nextDraft.data.draftVersions![0].body, expected);
  assert.notEqual(nextDraft.data.draftVersions![0].id, 'version-1');
  assert.deepEqual(parseDraftReferences(expected).map(reference => [reference.sourceNodeId, reference.time]), [[nextVideo.id, 6.25], [nextVideo.id, 3], ['deleted', 5]]);
  assert.deepEqual(imported.nodes.find(node => node.data.kind === 'quote')!.data.citation, quote.data.citation);
});

test('a million characters of malformed bracket input terminate without regex backtracking', { timeout: 5000 }, () => {
  const body = '[broken'.repeat(142858);
  assert.ok(body.length > 1_000_000);
  assert.deepEqual(parseDraftReferences(body), []);
});
