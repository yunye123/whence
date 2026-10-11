import assert from 'node:assert/strict';
import test from 'node:test';
import type { Board, BoardNode, CardData, Workspace } from '../src/model';
import { createWorkspaceSearchIndex, searchWorkspace, type WorkspaceSearchHit } from '../src/workspace-search';

function node(id: string, data: Partial<CardData> = {}): BoardNode {
  return { id, type: 'card', position: { x: 0, y: 0 }, data: { kind: 'note', title: id, body: '', ...data } };
}
function board(id: string, nodes: BoardNode[], title = id): Board {
  return { id, title, description: '', category: 'writing', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z', nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
}
function workspace(boards: Board[], trash?: Board[]): Workspace {
  return { schema: 1, activeBoardId: boards[0]?.id ?? '', boards, ...(trash ? { trash: trash.map(value => ({ board: value, deletedAt: '2026-10-03T00:00:00Z' })) } : {}) };
}
function search(value: Workspace, query: string, boardId = value.activeBoardId, scope: 'workspace' | 'board' = 'workspace', limit?: number) {
  return searchWorkspace(createWorkspaceSearchIndex(value), query, { scope, boardId, limit });
}
function highlighted(hit: WorkspaceSearchHit): string[] {
  return hit.ranges.map(range => {
    assert.ok(range.start >= 0 && range.end > range.start && range.end <= hit.excerpt.length);
    return hit.excerpt.slice(range.start, range.end);
  });
}

test('workspace search includes other live boards, while board scope and trash remain separate', () => {
  const value = workspace([
    board('writing', [node('w', { body: '田野与风声' })], '文字草稿'),
    board('video', [node('v', { title: '田野影像', kind: 'video' })], '视频素材'),
  ], [board('deleted', [node('d', { title: '田野旧稿' })])]);
  const all = search(value, '田野');
  assert.equal(all.total, 2);
  assert.deepEqual(all.hits.map(hit => [hit.boardId, hit.boardTitle, hit.nodeId, hit.kind]), [['video', '视频素材', 'v', 'video'], ['writing', '文字草稿', 'w', 'note']]);
  assert.deepEqual(search(value, '田野', 'writing', 'board').hits.map(hit => hit.nodeId), ['w']);
  assert.deepEqual(search(value, '田野', 'unknown', 'board').hits, []);
});

test('title matches rank first; equal scores prefer the current board then stable original order', () => {
  const value = workspace([
    board('a', [node('body', { body: '好故事' }), node('a-first', { title: '好故事' }), node('a-second', { title: '好故事' })]),
    board('b', [node('same-id', { title: '好故事' }), node('b-second', { title: '好故事' })]),
  ]);
  const result = search(value, '好故事', 'b');
  assert.deepEqual(result.hits.map(hit => hit.nodeId), ['same-id', 'b-second', 'a-first', 'a-second', 'body']);
  assert.equal(result.hits[0].field, 'title');
  assert.deepEqual(highlighted(result.hits[0]), ['好故事']);
});

test('whitespace words use AND across fields and produce only one best result per card', () => {
  const value = workspace([board('a', [
    node('both', { title: '星空记录', body: '独自走过田野', tags: ['夜晚'] }),
    node('one', { title: '星空', body: '没有另一个词' }),
  ])]);
  const result = search(value, '  星空\n\t田野  夜晚   星空 ');
  assert.equal(result.query, '星空 田野 夜晚 星空');
  assert.equal(result.total, 1);
  assert.equal(result.hits[0].field, 'title');
  assert.deepEqual(highlighted(result.hits[0]), ['星空']);
  assert.equal(search(value, '星空 未出现').total, 0);
});

test('case and full-width compatibility normalization highlights original UTF16 text', () => {
  const value = workspace([board('a', [node('n', { body: '前奏 Ｃａｆé 与 ABC 和 ﬃ，Cafe\u0301、İstanbul、ΟΣ。' })])]);
  assert.deepEqual(highlighted(search(value, 'café').hits[0]), ['Ｃａｆé', 'Cafe\u0301']);
  assert.deepEqual(highlighted(search(value, 'ａｂｃ').hits[0]), ['ABC']);
  assert.deepEqual(highlighted(search(value, 'FFI').hits[0]), ['ﬃ']);
  assert.deepEqual(highlighted(search(value, 'i̇stanbul').hits[0]), ['İstanbul']);
  assert.deepEqual(highlighted(search(value, 'ος').hits[0]), ['ΟΣ']);
});

test('transcript matches return the matching line time, including original recognition text', () => {
  const value = workspace([board('a', [node('v', { kind: 'video', transcript: [
    { id: 'one', start: 3.2, end: 5.4, text: '第一行无关' },
    { id: 'two', start: 44.75, end: 48, text: '让风穿过田野', originalText: '让丰穿过田冶' },
  ] })])]);
  const current = search(value, '田野').hits[0];
  assert.equal(current.field, 'transcript');
  assert.equal(current.time, 44.75);
  assert.deepEqual(highlighted(current), ['田野']);
  const original = search(value, '田冶').hits[0];
  assert.equal(original.field, 'originalTranscript');
  assert.equal(original.time, 44.75);
  assert.deepEqual(highlighted(original), ['田冶']);
});

test('AND can span different subtitle lines without returning duplicate video results', () => {
  const value = workspace([board('a', [node('v', { kind: 'video', transcript: [
    { id: 'one', start: 10, end: 12, text: '清晨开始' },
    { id: 'two', start: 20, end: 22, text: '夜晚结束' },
  ] })])]);
  const result = search(value, '清晨 夜晚');
  assert.equal(result.total, 1);
  assert.equal(result.hits[0].time, 10);
  assert.deepEqual(highlighted(result.hits[0]), ['清晨']);
});

test('citation text and tags are searchable as plain text with safe highlight ranges', () => {
  const dangerous = '<img src=x onerror=alert(1)>田野';
  const value = workspace([board('a', [
    node('quote', { kind: 'quote', citation: { nodeId: 'source', title: '来源书目', text: dangerous } }),
    node('tagged', { tags: ['田野', '镜头语言'] }),
  ])]);
  const result = search(value, '田野');
  assert.deepEqual(result.hits.map(hit => hit.field), ['citation', 'tags']);
  assert.equal(result.hits[0].excerpt, dangerous);
  assert.deepEqual(highlighted(result.hits[0]), ['田野']);
  assert.equal(search(value, '来源书目').hits[0].field, 'citation');
  assert.equal(search(value, '镜头语言').hits[0].field, 'tags');
});

test('only actual external source addresses are indexed; explicit clear never revives legacy URLs', () => {
  const value = workspace([board('a', [
    node('source', { kind: 'video', mediaId: 'blob', url: 'field-media://video/local', sourceUrl: 'https://example.com/ActualSource' }),
    node('legacy', { kind: 'image', mediaId: 'blob2', url: 'https://example.com/LegacySource' }),
    node('cleared', { kind: 'video', mediaId: 'blob3', url: 'https://example.com/RemovedSource', sourceUrl: '' }),
    node('plain-cleared', { kind: 'link', url: 'https://example.com/RemovedSource', sourceUrl: '' }),
    node('internal', { kind: 'video', url: 'media://secret/internalasset' }),
    node('native', { kind: 'video', nativeAssetId: 'asset', url: 'field-media://secret/internalasset' }),
  ])]);
  assert.equal(search(value, 'actualsource').hits[0].field, 'source');
  assert.equal(search(value, 'legacysource').hits[0].nodeId, 'legacy');
  assert.equal(search(value, 'removedsource').total, 0);
  assert.equal(search(value, 'internalasset').total, 0);
  assert.equal(search(value, 'field-media').total, 0);
});

test('indexes snapshot nested text and identity, preserving inputs and ignoring later edits', () => {
  const value = workspace([board('a', [node('n', { title: '旧田野', body: '旧风声', tags: ['旧标签'], transcript: [{ id: 'line', start: 2, end: 5, text: '旧逐字稿' }] })])], [board('trash', [node('hidden')])]);
  const before = structuredClone(value);
  const index = createWorkspaceSearchIndex(value);
  assert.deepEqual(value, before);
  value.boards[0].title = '新画布';
  value.boards[0].nodes[0].data.title = '新标题';
  value.boards[0].nodes[0].data.body = '新正文';
  value.boards[0].nodes[0].data.tags![0] = '新标签';
  value.boards[0].nodes[0].data.transcript![0].text = '新逐字稿';
  const options = { scope: 'workspace' as const, boardId: 'a' };
  assert.equal(searchWorkspace(index, '新', options).total, 0);
  for (const old of ['旧田野', '旧风声', '旧标签', '旧逐字稿']) {
    const result = searchWorkspace(index, old, options);
    assert.equal(result.total, 1);
    assert.equal(result.hits[0].title, '旧田野');
    assert.equal(result.hits[0].boardTitle, 'a');
  }
});

test('limited hits retain accurate totals, with an 80-card default and empty-query behavior', () => {
  const value = workspace([board('a', Array.from({ length: 85 }, (_, i) => node(`n-${i}`, { body: '共同词' })))]);
  const index = createWorkspaceSearchIndex(value);
  const options = { scope: 'workspace' as const, boardId: 'a' };
  const result = searchWorkspace(index, '共同词', options);
  assert.equal(result.total, 85);
  assert.equal(result.hits.length, 80);
  assert.equal(searchWorkspace(index, '共同词', { ...options, limit: 2 }).hits.length, 2);
  assert.equal(searchWorkspace(index, '共同词', { ...options, limit: 0 }).total, 85);
  assert.deepEqual(searchWorkspace(index, ' \t\n　 ', options), { hits: [], total: 0, query: '' });
  assert.equal(searchWorkspace(index, '没有匹配', options).total, 0);
});

test('long excerpts surround matches without splitting UTF16 emoji or grapheme clusters', () => {
  const family = '👨‍👩‍👧‍👦', accented = 'e\u0301';
  const body = `${family.repeat(30)}${accented.repeat(40)}目标关键词${family.repeat(30)}${accented.repeat(40)}`;
  const hit = search(workspace([board('a', [node('n', { body })])]), '关键词').hits[0];
  assert.ok(hit.excerpt.startsWith('…') && hit.excerpt.endsWith('…'));
  assert.deepEqual(highlighted(hit), ['关键词']);
  const content = hit.excerpt.slice(1, -1);
  const start = body.indexOf(content), end = start + content.length;
  const boundaries = new Set([0, ...Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(body), item => item.index + item.segment.length)]);
  assert.ok(start >= 0 && boundaries.has(start) && boundaries.has(end));
  assert.equal(content.includes('\uFFFD'), false);
});

test('overlapping and compatibility-expanded matches merge into valid original text ranges', () => {
  const hit = search(workspace([board('a', [node('n', { body: 'ﬃ ABC ABC' })])]), 'ffi fi abc bc').hits[0];
  assert.deepEqual(highlighted(hit), ['ﬃ', 'ABC', 'ABC']);
  for (let i = 1; i < hit.ranges.length; i++) assert.ok(hit.ranges[i].start > hit.ranges[i - 1].end);
});

test('compatibility letters composing across original graphemes still match and highlight together', () => {
  const value = workspace([board('a', [node('n', { body: '开始 ㄱㅏ 结束' })])]);
  assert.deepEqual(highlighted(search(value, '가').hits[0]), ['ㄱㅏ']);
  assert.deepEqual(highlighted(search(value, 'ㄱㅏ').hits[0]), ['ㄱㅏ']);
});

test('overlapping occurrences of the same term are all included in the merged highlight', () => {
  const value = workspace([board('a', [node('n', { body: '哈哈哈，哈哈' })])]);
  assert.deepEqual(highlighted(search(value, '哈哈').hits[0]), ['哈哈哈', '哈哈']);
});

test('matches inside composed emoji highlight the complete original grapheme', () => {
  const value = workspace([board('a', [node('n', { body: '画面中的 👩‍💻 与 🇨🇳' })])]);
  assert.deepEqual(highlighted(search(value, '💻').hits[0]), ['👩‍💻']);
  assert.deepEqual(highlighted(search(value, '🇨').hits[0]), ['🇨🇳']);
});

test('a document lists each matching line as its own spot, cut inside that line, with absolute body offsets (DLG-02)', () => {
  const body = '# 标题\n\n第一段停下来。\n\n第二段没有。\n\n第三段也停下来，再停下来。\n\n第四段停下来\r\n第五段停下来';
  const result = search(workspace([board('a', [node('doc', { body }), node('other', { body: '别的卡片也停下来' })])]), '停下来');
  assert.equal(result.total, 2, 'total still counts cards');
  const spots = result.hits.filter(hit => hit.nodeId === 'doc');
  assert.equal(spots.length, 3, 'at most three spots per card');
  assert.deepEqual(spots.map(hit => [hit.spot, hit.spots]), [[0, 4], [1, 4], [2, 4]]);
  assert.deepEqual(spots.map(hit => hit.excerpt), ['第一段停下来。', '第三段也停下来，再停下来。', '第四段停下来'], 'each excerpt stays inside its own line');
  assert.deepEqual(highlighted(spots[1]), ['停下来', '停下来']);
  const normalized = body.replace(/\r\n?/g, '\n');
  for (const hit of spots) assert.equal(normalized.slice(hit.bodyStart, hit.bodyEnd), '停下来');
  assert.ok(spots[2].bodyStart! > spots[1].bodyStart!);
  const single = result.hits.find(hit => hit.nodeId === 'other')!;
  assert.equal(single.spot, undefined, 'a single spot carries no spot numbering');
  const draft = search(workspace([board('a', [node('d', { kind: 'draft', body: '写到步行。\n\n[来源：步行十五分钟](field://node/q?quote=q)\n\n步行时间要按最慢的人算。' })])]), '步行').hits;
  assert.deepEqual(draft.map(hit => hit.excerpt), ['写到步行。', '步行时间要按最慢的人算。'], 'a line holding only a source pointer is not a spot');
});

test('subtitle lines that hold the matched words are separate spots in time order', () => {
  const value = workspace([board('a', [node('v', { kind: 'video', transcript: [
    { id: 'a', start: 0, end: 6, text: '只有一盏灯' },
    { id: 'b', start: 6, end: 13, text: '没有关系' },
    { id: 'c', start: 13, end: 19, text: '灯下是早餐摊' },
  ] })])]);
  const hits = search(value, '灯').hits;
  assert.deepEqual(hits.map(hit => [hit.time, hit.spot, hit.spots]), [[0, 0, 2], [13, 1, 2]]);
});
