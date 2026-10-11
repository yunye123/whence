import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceSearchIndex, searchWorkspace } from '../src/workspace-search';
import { searchHitPassage, searchHitRange } from '../src/app/search-reveal';
import { createExampleBoard } from '../src/templates';
import { resolveTextAnchor } from '../src/text-anchor';
import type { Workspace } from '../src/model';

test('CORE-05: a palette hit in a long text resolves to its absolute place and a sentence that occurs once', () => {
  const board = createExampleBoard('writing');
  const workspace: Workspace = { schema: 1, activeBoardId: board.id, boards: [board] };
  const index = createWorkspaceSearchIndex(workspace);
  for (const query of ['钳工', '营业时间']) {
    const { hits } = searchWorkspace(index, query, { scope: 'board', boardId: board.id });
    const hit = hits.find(item => item.field === 'body' && (item.kind === 'note' || item.kind === 'link'));
    assert.ok(hit, `a body hit for ${query}`);
    const node = board.nodes.find(item => item.id === hit.nodeId)!;
    const body = node.data.body.replace(/\r\n?/g, '\n');
    const range = searchHitRange(node.data.body, hit)!;
    assert.equal(body.slice(range.start, range.end), query, 'the absolute range is the match');
    const passage = searchHitPassage(node.data.body, hit)!;
    assert.ok(passage.includes(query));
    assert.equal(body.indexOf(passage), body.lastIndexOf(passage), 'the passage is unique, so the reading view marks it without asking');
    const located = resolveTextAnchor(body, { nodeId: node.id, title: node.data.title, text: passage });
    assert.equal(located.status, 'matched');
    assert.ok(located.matches[0].from <= range.start && located.matches[0].to >= range.end);
  }
});

test('CORE-05: titles and missing excerpts give no body place', () => {
  assert.equal(searchHitRange('正文', { field: 'title', excerpt: '正文', ranges: [{ start: 0, end: 2 }] }), undefined);
  assert.equal(searchHitRange('正文', { field: 'body', excerpt: '…别处的话…', ranges: [{ start: 1, end: 3 }] }), undefined);
  const body = '第一句话。第二句里有钳工。第三句。';
  assert.deepEqual(searchHitRange(body, { field: 'body', excerpt: body, ranges: [{ start: 10, end: 12 }] }), { start: 10, end: 12 });
  assert.equal(searchHitPassage(body, { field: 'body', excerpt: body, ranges: [{ start: 10, end: 12 }] }), '第二句里有钳工。');
});
