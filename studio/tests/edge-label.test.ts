import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdgeChanges } from '@xyflow/react';
import { buildFlowEdges } from '../src/canvas/edges/flow-edges';
import { EDGE_LABEL_MAX, createConnectionTracker, labelledEdge } from '../src/canvas/edges/label-edit';
import { createNode } from '../src/board-utils';
import { createBoard, validateBoard } from '../src/storage';

function boardWithThread(label?: string) {
  const a = createNode('note'), b = createNode('image');
  const edge = { id: 'thread-1', source: a.id, target: b.id, type: 'smoothstep', ...(label === undefined ? {} : { label }) };
  return { ...createBoard('blank'), nodes: [a, b], edges: [edge] };
}

test('a label written on a thread replaces it with stored fields only, so the board still validates (FC-08)', () => {
  const board = boardWithThread();
  const [flowEdge] = buildFlowEdges(board);
  const item = labelledEdge(flowEdge, '  参考这张的配色  ');
  assert.deepEqual(item, { id: 'thread-1', source: board.nodes[0].id, target: board.nodes[1].id, type: 'smoothstep', label: '参考这张的配色' });
  // What App's onEdgesChange does with the change: applyEdgeChanges, then changeBoard validates the board.
  const edges = applyEdgeChanges([{ type: 'replace', id: 'thread-1', item: item! }], board.edges);
  assert.doesNotThrow(() => validateBoard({ ...board, edges }));
  assert.equal(edges[0].label, '参考这张的配色');
});

test('clearing removes the label, an unchanged label is no change, and the text is capped at the storage limit', () => {
  const [labelled] = buildFlowEdges(boardWithThread('配色参考'));
  assert.deepEqual(labelledEdge(labelled, '   '), { id: 'thread-1', source: labelled.source, target: labelled.target, type: 'smoothstep' });
  assert.equal(labelledEdge(labelled, '配色参考'), null);
  assert.equal(labelledEdge(labelled, ' 配色参考 '), null);
  const long = labelledEdge(labelled, '字'.repeat(EDGE_LABEL_MAX + 40));
  assert.equal(long?.label?.length, EDGE_LABEL_MAX);
  // A thread saved without a type keeps none.
  assert.equal('type' in labelledEdge({ id: 'x', source: 'a', target: 'b' }, '关系')!, false);
});

test('only the thread a drag created opens its label box, once, shortly after the drop', () => {
  let now = 0;
  const tracker = createConnectionTracker(() => now);
  tracker.start('card-a', ['old']);
  assert.equal(tracker.claim('old', 'card-a', 'card-b'), false, 'a thread that already existed');
  assert.equal(tracker.claim('other', 'card-c', 'card-d'), false, 'a new thread between other cards');
  tracker.end();
  now = 400;
  assert.equal(tracker.claim('new', 'card-b', 'card-a'), true, 'dragged from the incoming side');
  assert.equal(tracker.claim('new', 'card-b', 'card-a'), false, 'claimed once');
  tracker.start('card-a', []);
  tracker.end();
  now = 400 + 1600;
  assert.equal(tracker.claim('late', 'card-a', 'card-b'), false, 'too long after the drop');
});
