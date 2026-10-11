import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, exportBoard, importBoard, saveMedia, saveWorkspace, STORAGE_LIMITS, validateBoard } from '../src/storage';
import { createNode, duplicateNode, exportMarkdown, parseSubtitles, safeUrl } from '../src/board-utils';

async function packedFile(board = createBoard('demo'), mutate?: (value: any) => void) {
  const value = JSON.parse(await (await exportBoard(board)).text());
  mutate?.(value);
  return new File([JSON.stringify(value)], 'field.json', { type: 'application/json' });
}

test('safeUrl rejects active/local protocols, credentials and control characters', () => {
  assert.equal(safeUrl(' HTTPS://Example.com/story '), 'https://example.com/story');
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'media://project/id', '//example.com', 'https://user:password@example.com', 'https://example.com\n']) assert.equal(safeUrl(value), null, value);
});

test('SRT and VTT timestamps preserve milliseconds, ordering and plain subtitle text', () => {
  const srt = parseSubtitles('\uFEFF2\r\n00:00:03,100 --> 00:00:04,900\r\n第二句\r\n\r\n1\r\n00:00:00,050 --> 00:00:02,000\r\n<i>第一句</i>\r\n继续一句\r\n');
  assert.deepEqual(srt.map(({ start, end, text }) => ({ start, end, text })), [
    { start: .05, end: 2, text: '第一句\n继续一句' }, { start: 3.1, end: 4.9, text: '第二句' },
  ]);
  const vtt = parseSubtitles('WEBVTT\n\nNOTE do not parse\n00:00.000 --> 00:01.000\ncomment\n\ncue-one\n01:02.250 --> 01:04.000 align:start\n<v Narrator>光 &amp; 影</v>\n');
  assert.equal(vtt.length, 1);
  assert.deepEqual({ start: vtt[0].start, end: vtt[0].end, text: vtt[0].text }, { start: 62.25, end: 64, text: '光 & 影' });
});

test('subtitle parser rejects impossible, reversed or excessive input', () => {
  for (const input of ['00:61:00,000 --> 00:62:00,000\nx', '00:00:02,000 --> 00:00:01,000\nx', '00:00:01,000 --> rubbish\nx']) assert.throws(() => parseSubtitles(input), /时间/);
  assert.throws(() => parseSubtitles('x'.repeat(4 * 1024 * 1024 + 1)), /过大/);
  assert.deepEqual(parseSubtitles('这是一段没有时间码的正文。'), []);
});

test('all templates satisfy the same persisted data contract', () => {
  for (const template of ['demo', 'blank', 'video', 'writing', 'design'] as const) assert.deepEqual(validateBoard(createBoard(template)).category, template === 'writing' ? 'writing' : template === 'design' ? 'design' : 'video');
  const demo = createBoard('demo');
  assert.equal(demo.nodes.length, 7);
  assert.ok(demo.nodes.every(node => node.data.demo && node.position.x >= 0 && node.position.x <= 1400 && node.position.y <= 700));
  assert.ok(demo.nodes.filter(node => node.data.poster).every(node => node.data.poster?.startsWith('/assets/')));
});

test('portable round trip remaps IDs and keeps citation, edge and internal draft links synchronized', async () => {
  const source = createBoard('demo');
  const video = source.nodes.find(node => node.data.kind === 'video')!;
  const draft = source.nodes.find(node => node.data.kind === 'draft')!;
  draft.data.body = `一个想法 [来源](field://node/${video.id}?t=6) 与 [外部](https://example.com/${video.id})`;
  draft.data.draftVersions = [{ id: 'version-1', title: '第一稿', body: draft.data.body, createdAt: source.createdAt }];
  const restored = await importBoard(await packedFile(source));
  const restoredVideo = restored.nodes.find(node => node.data.kind === 'video')!;
  const restoredDraft = restored.nodes.find(node => node.data.kind === 'draft')!;
  const restoredQuote = restored.nodes.find(node => node.data.kind === 'quote')!;
  assert.notEqual(restored.id, source.id);
  assert.notEqual(restoredVideo.id, video.id);
  assert.equal(restoredQuote.data.citation?.nodeId, restoredVideo.id);
  assert.equal(restored.edges[0].source, restoredVideo.id);
  assert.equal(restored.edges[0].target, restoredQuote.id);
  assert.ok(restoredDraft.data.body.includes(`field://node/${restoredVideo.id}?t=6`));
  assert.ok(restoredDraft.data.body.includes(`https://example.com/${video.id}`));
  assert.equal(restoredDraft.data.draftVersions?.[0].body, restoredDraft.data.body);
  assert.notEqual(restoredDraft.data.draftVersions?.[0].id, 'version-1');
  assert.notEqual(restoredVideo.data.transcript?.[0].id, video.data.transcript?.[0].id);
});

test('deleted source citations retain their snapshot through a portable round trip', async () => {
  const board = createBoard('demo');
  const quote = board.nodes.find(node => node.data.kind === 'quote')!;
  const oldSource = quote.data.citation!.nodeId;
  board.nodes = board.nodes.filter(node => node.id !== oldSource);
  board.edges = board.edges.filter(edge => edge.source !== oldSource && edge.target !== oldSource);
  const restored = await importBoard(await packedFile(board));
  assert.deepEqual(restored.nodes.find(node => node.data.kind === 'quote')!.data.citation, quote.data.citation);
});

test('literal HTML in plain-text fields survives validation and portable import without interpretation', async () => {
  const board = createBoard('blank'), node = createNode('note');
  const literal = '<script>alert("literal text")</script>\n<img src="&#106;avascript:alert(1)">';
  board.title = '示例标签 <div>';
  board.description = '<!-- 写作中的代码示例 -->';
  node.data.title = '<input> 标签的用途';
  node.data.body = literal;
  node.data.tags = ['<strong>'];
  board.nodes = [node];
  assert.equal(validateBoard(board).nodes[0].data.body, literal);
  const restored = await importBoard(await packedFile(board));
  assert.equal(restored.title, board.title);
  assert.equal(restored.description, board.description);
  assert.equal(restored.nodes[0].data.title, node.data.title);
  assert.equal(restored.nodes[0].data.body, literal);
  assert.deepEqual(restored.nodes[0].data.tags, ['<strong>']);
});

test('import rejects dangerous URL protocols, foreign fields and dangling edges', async () => {
  const cases = [
    (pkg: any) => { pkg.board.nodes[0].data.url = 'javascript:alert(1)'; },
    (pkg: any) => { pkg.board.nodes[0].data.url = 'data:text/html,<script>alert(1)</script>'; },
    (pkg: any) => { pkg.board.nodes[0].data.sourceUrl = 'javascript:alert(1)'; },
    (pkg: any) => { pkg.board.nodes[0].data.poster = 'data:image/svg+xml,<svg onload="alert(1)"/>'; },
    (pkg: any) => { pkg.board.nodes[0].data.untrustedRenderer = 'html'; },
    (pkg: any) => { pkg.board.edges[0].target = 'missing'; },
    (pkg: any) => { pkg.board.nodes[0].position.x = 'not-a-number'; },
    (pkg: any) => { pkg.board.nodes[1].id = pkg.board.nodes[0].id; },
    (pkg: any) => { pkg.board.nodes[0].data.nativeDirectory = 'C:\\private'; },
    (pkg: any) => { pkg.version = 300; },
  ];
  for (const mutate of cases) await assert.rejects(importBoard(await packedFile(createBoard('demo'), mutate)));
  const prototype = JSON.parse(await (await exportBoard(createBoard('blank'))).text());
  const poisoned = JSON.stringify(prototype).replace('"description":""', '"description":"","__proto__":{"polluted":true}');
  await assert.rejects(importBoard(new File([poisoned], 'bad.json')), /不安全/);
  assert.equal(({} as any).polluted, undefined);
});

test('import rejects missing media, bad base64, unsupported MIME and excessive node count before opening storage', async () => {
  await assert.rejects(importBoard(await packedFile(createBoard('demo'), pkg => { pkg.board.nodes[0].data.mediaId = 'missing'; })), /缺少/);
  const mutateMedia = (mime: string, data: string) => (pkg: any) => {
    pkg.board.nodes[0].data.mediaId = 'media-1';
    pkg.media = [{ id: 'media-1', name: 'asset', mime, createdAt: pkg.exportedAt, data }];
  };
  await assert.rejects(importBoard(await packedFile(createBoard('demo'), mutateMedia('image/png', 'not base64'))), /编码/);
  await assert.rejects(importBoard(await packedFile(createBoard('demo'), mutateMedia('text/html', 'eA=='))), /媒体格式/);
  await assert.rejects(importBoard(await packedFile(createBoard('demo'), pkg => { pkg.board.nodes = Array.from({ length: STORAGE_LIMITS.nodes + 1 }, (_, index) => ({ ...pkg.board.nodes[0], id: `node-${index}` })); })), /数量/);
});

test('native-only media cannot masquerade as a portable export and paths are stripped', async () => {
  const board = createBoard('blank'), node = createNode('video');
  node.data.url = 'media://project/assets/test.mp4';
  node.data.nativeDirectory = 'D:\\private-project';
  board.nodes = [node];
  await assert.rejects(exportBoard(board), /另存完整画布目录/);
  delete node.data.url;
  node.data.nativeNodeId = 'source-node';
  node.data.sourceTitle = '可保留的公开来源标题';
  const exported = JSON.parse(await (await exportBoard(board)).text());
  assert.equal(exported.board.nodes[0].data.nativeDirectory, undefined);
  assert.equal(exported.board.nodes[0].data.nativeNodeId, undefined);
  assert.equal(exported.board.nodes[0].data.sourceTitle, '可保留的公开来源标题');
  assert.equal(node.data.nativeDirectory, 'D:\\private-project', 'export must not mutate workspace');
});

test('media rejects invalid uploads and save failures remain explicit', async () => {
  await assert.rejects(saveMedia(new Blob([], { type: 'image/png' }), 'empty.png'), /为空/);
  await assert.rejects(saveMedia(new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'unsafe.svg'), /不支持/);
  const board = createBoard('blank');
  await assert.rejects(saveWorkspace({ schema: 1, activeBoardId: board.id, boards: [board] }), /IndexedDB/);
});

test('native provenance and safe raster posters validate, and private metadata is not exported', async () => {
  const board = createBoard('blank'), node = createNode('image');
  node.data.poster = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
  Object.assign(node.data, { nativeGroup: '', nativeHasAudio: false, nativeCapture: { assetId: 'asset-1', timeMs: 2300 }, nativeWordIds: ['word-1'], nativeSegmentIds: ['segment-1'], nativeRanges: [{ startMs: 1000, endMs: 2000 }], sourceUrl: 'https://example.com/source', sourceAuthor: '作者' });
  board.nodes = [node];
  assert.equal(validateBoard(board).nodes[0].data.poster, node.data.poster);
  const restored = await importBoard(await packedFile(board));
  assert.equal(restored.nodes[0].data.poster, node.data.poster);
  assert.equal(restored.nodes[0].data.sourceAuthor, '作者');
  assert.ok(Object.keys(restored.nodes[0].data).every(key => !key.startsWith('native')));
  node.data.poster = 'data:image/png;base64,PGh0bWw+eDwvaHRtbD4=';
  assert.throws(() => validateBoard(board), /协议/);
});

test('duplication isolates mutable data and Markdown preserves quote vs interpretation', () => {
  const board = createBoard('demo');
  const video = board.nodes.find(node => node.data.kind === 'video')!;
  const copy = duplicateNode(video);
  copy.data.transcript![0].text = '改动';
  assert.notEqual(video.data.transcript![0].text, '改动');
  assert.notEqual(copy.id, video.id);
  assert.notEqual(copy.data.transcript![0].id, video.data.transcript![0].id);
  const quote = board.nodes.find(node => node.data.kind === 'quote')!;
  quote.data.body = '我要用环境声承接这一句。';
  const markdown = exportMarkdown(board);
  assert.ok(markdown.includes(`> ${quote.data.citation!.text}`));
  assert.ok(markdown.includes('我的理解：我要用环境声承接这一句。'));
  assert.ok(!markdown.includes('> 我要用环境声承接这一句。'));
  assert.ok(markdown.includes('00:06–00:13'));
});
