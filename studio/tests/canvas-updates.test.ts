import assert from 'node:assert/strict';
import test from 'node:test';
import type { Node, NodeChange } from '@xyflow/react';
import { applyCanvasNodeChanges, isSubstantiveNodeChange } from '../src/App';
import { createNode } from '../src/board-utils';
import { frameContainsCard } from '../src/card-placement';
import { createBoard, validateBoard } from '../src/storage';
import type { BoardNode, CardData, CardKind } from '../src/model';

function node(id: string, x = 0, y = 0, kind: CardKind = 'note', style?: BoardNode['style']): BoardNode {
  const created = createNode(kind); return { ...created, id, position: { x, y }, ...(style ? { style } : {}) };
}
function position(id: string, x: number, y: number): NodeChange<Node<CardData>> { return { type: 'position', id, position: { x, y }, dragging: true }; }
function validate(nodes: BoardNode[]) { return validateBoard({ ...createBoard('blank'), nodes }); }
function freeze(nodes: BoardNode[]) {
  for (const item of nodes) { Object.freeze(item.position); Object.freeze(item.data); if (item.style) Object.freeze(item.style); Object.freeze(item); }
  Object.freeze(nodes);
}

test('explicit dimensions are limited to saveable bounds while natural measurements remain layout-only', () => {
  const original = node('sized', 9, 14, 'note', { width: 320, height: 480 });
  const oversized = applyCanvasNodeChanges([original], [{ type: 'dimensions', id: original.id, dimensions: { width: 18000, height: 19000 }, setAttributes: true }]);
  assert.deepEqual(oversized[0].style, { width: 10000, height: 10000 });
  assert.deepEqual(oversized[0].position, original.position);
  validate(oversized);
  const measured = applyCanvasNodeChanges([original], [{ type: 'dimensions', id: original.id, dimensions: { width: 320, height: 25000 } }]);
  assert.deepEqual(measured[0].style, original.style);
  const invalid = applyCanvasNodeChanges([original], [{ type: 'dimensions', id: original.id, dimensions: { width: NaN, height: Infinity }, setAttributes: true }]);
  assert.deepEqual(invalid[0].style, original.style);
});

test('a drag changes only its target and keeps other cards, nested data and style references shared', () => {
  const nodes = [node('moving', 5, 10), node('video', 300, 400, 'video'), node('note', 700, 500)];
  nodes[1].data.sourceUrl = ''; nodes[1].data.transcript = [{ id: 'corrected', start: 0, end: 2, text: '用户校对的字幕' }];
  const before = structuredClone(nodes); freeze(nodes);
  const moved = applyCanvasNodeChanges(nodes, [position('moving', 20.5, 40.25)]);
  assert.notEqual(moved[0], nodes[0]); assert.deepEqual(moved[0].position, { x: 20.5, y: 40.25 });
  assert.equal(moved[0].data, nodes[0].data); assert.equal(moved[0].style, nodes[0].style);
  assert.equal(moved[1], nodes[1]); assert.equal(moved[2], nodes[2]);
  assert.equal(moved[1].data.transcript, nodes[1].data.transcript); assert.equal(moved[1].data.sourceUrl, '');
  assert.deepEqual(nodes, before); assert.doesNotThrow(() => validate(moved));
});

test('resizing persists dimensions without changing position or other card references and does not invent empty styles', () => {
  const resized = node('resized', 10, 20, 'video', { width: 290, height: 320 }), untouched = node('unstyled', 400, 20);
  delete untouched.style; const nodes = [resized, untouched], before = structuredClone(nodes); freeze(nodes);
  const changes: NodeChange<Node<CardData>>[] = [{ type: 'dimensions', id: 'resized', dimensions: { width: 410.5, height: 520.25 }, resizing: true, setAttributes: true }];
  const result = applyCanvasNodeChanges(nodes, changes);
  assert.deepEqual(result[0].style, { width: 410.5, height: 520.25 }); assert.notEqual(result[0].style, resized.style);
  assert.equal(result[0].position, resized.position); assert.equal(result[0].data, resized.data); assert.equal(result[1], untouched); assert.equal(result[1].style, undefined);
  const movedUnstyled = applyCanvasNodeChanges(nodes, [position('unstyled', 410, 25)]);
  assert.equal(movedUnstyled[1].style, undefined); assert.deepEqual(nodes, before); assert.doesNotThrow(() => validate(result));
});

test('a one-axis resize retains the other persisted size; measurement-only changes cannot turn measurements into saved dimensions', () => {
  const nodes = [node('card', -100, 200, 'note', { width: 300, height: 280 })]; freeze(nodes);
  const width = applyCanvasNodeChanges(nodes, [{ type: 'dimensions', id: 'card', dimensions: { width: 800, height: 640 }, resizing: true, setAttributes: 'width' }]);
  assert.deepEqual(width[0].style, { width: 800, height: 280 }); assert.equal(width[0].position, nodes[0].position);
  const measured = applyCanvasNodeChanges(nodes, [{ type: 'dimensions', id: 'card', dimensions: { width: 700, height: 10_020 } }]);
  assert.equal(measured[0].style, nodes[0].style); assert.equal(measured[0].data, nodes[0].data); assert.equal(measured[0].position, nodes[0].position);
  assert.doesNotThrow(() => validate(measured), 'natural content measurements may exceed stored style limits without becoming persistent dimensions');
});

test('removing and inserting React Flow nodes preserves order and the references of surviving cards', () => {
  const nodes = [node('a'), node('b', 100, 0), node('c', 200, 0)], inserted = node('inserted', 50, 20), appended = node('appended', 300, 0);
  const before = structuredClone(nodes); freeze(nodes);
  const result = applyCanvasNodeChanges(nodes, [{ type: 'remove', id: 'b' }, { type: 'add', item: inserted, index: 1 }, { type: 'add', item: appended }]);
  assert.deepEqual(result.map(item => item.id), ['a', 'inserted', 'c', 'appended']);
  assert.equal(result[0], nodes[0]); assert.equal(result[2], nodes[2]); assert.equal(result[1].data, inserted.data); assert.equal(result[3].data, appended.data);
  assert.deepEqual(nodes, before); assert.doesNotThrow(() => validate(result));
});

test('a moving frame translates full children exactly once and leaves partly intersecting cards and undo snapshots unchanged', () => {
  const frame = node('frame', 0, 0, 'frame', { width: 800, height: 600 }), child = node('child', 100, 100, 'note', { width: 290, height: 240 }), partial = node('partial', 700, 100, 'note', { width: 290, height: 240 });
  const nodes = [frame, child, partial], before = structuredClone(nodes);
  const frameSnapshot = { frameId: frame.id, origin: { ...frame.position }, nodes: nodes.filter(item => frameContainsCard(frame, item)) };
  const snapshotBefore = structuredClone(frameSnapshot); freeze(nodes); Object.freeze(frameSnapshot.origin); Object.freeze(frameSnapshot.nodes);
  const result = applyCanvasNodeChanges(nodes, [position(frame.id, 32, -16)], [frameSnapshot]);
  assert.deepEqual(result[1].position, { x: 132, y: 84 }); assert.notEqual(result[1], child); assert.equal(result[1].data, child.data); assert.equal(result[1].style, child.style);
  assert.equal(result[2], partial); assert.deepEqual(nodes, before); assert.deepEqual(frameSnapshot, snapshotBefore);
  const again = applyCanvasNodeChanges(result, [position(frame.id, 64, -32)], [frameSnapshot]);
  assert.deepEqual(again[1].position, { x: 164, y: 68 }, 'later drag events apply their delta from the captured origin, not cumulatively from the previous event');
  assert.deepEqual(before[1].position, { x: 100, y: 100 }, 'the undo snapshot retains its original position'); assert.doesNotThrow(() => validate(again));
});

test('overlapping selected frames and a directly selected child cannot double-apply one drag delta', () => {
  const frame = node('frame', 0, 0, 'frame', { width: 800, height: 600 }), overlap = node('overlap', 50, 50, 'frame', { width: 800, height: 600 }), child = node('child', 100, 100), selected = node('selected-child', 400, 100);
  const nodes = [frame, overlap, child, selected]; freeze(nodes);
  const frames = [
    { frameId: frame.id, origin: { ...frame.position }, nodes: [child] },
    { frameId: overlap.id, origin: { ...overlap.position }, nodes: [child] },
  ];
  const result = applyCanvasNodeChanges(nodes, [position(frame.id, 32, 16), position(overlap.id, 82, 66), position(selected.id, 432, 116)], frames);
  assert.deepEqual(result[2].position, { x: 132, y: 116 }); assert.deepEqual(result[3].position, { x: 432, y: 116 });
  assert.deepEqual(nodes[2].position, { x: 100, y: 100 }); assert.equal(result[2].data, child.data); assert.equal(result[3].data, selected.data);
});

test('mixed frame movements, deletion and resize do not move the wrong group or revive a removed child', () => {
  const first = node('one', 0, 0, 'frame', { width: 600, height: 500 }), second = node('two', 800, 0, 'frame', { width: 600, height: 500 }), oneChild = node('one-child', 50, 60), twoChild = node('two-child', 850, 70), deleted = node('deleted-child', 1000, 100), staticCard = node('static', 1600, 900);
  const nodes = [first, second, oneChild, twoChild, deleted, staticCard], snapshot = structuredClone(nodes); freeze(nodes);
  const frames = [{ frameId: first.id, origin: { ...first.position }, nodes: [oneChild] }, { frameId: second.id, origin: { ...second.position }, nodes: [twoChild, deleted] }];
  const result = applyCanvasNodeChanges(nodes, [position(first.id, 32, -16), position(second.id, 780, 50), { type: 'remove', id: deleted.id }, { type: 'dimensions', id: staticCard.id, dimensions: { width: 420, height: 300 }, resizing: true, setAttributes: true }], frames);
  assert.deepEqual(result.map(item => item.id), ['one', 'two', 'one-child', 'two-child', 'static']);
  assert.deepEqual(result[2].position, { x: 82, y: 44 }); assert.deepEqual(result[3].position, { x: 830, y: 120 });
  assert.equal(result[4].position, staticCard.position); assert.deepEqual(result[4].style, { width: 420, height: 300 });
  assert.deepEqual(nodes, snapshot); assert.doesNotThrow(() => validate(result));
});

test('empty and unknown-node updates preserve each card identity without requiring an array identity convention', () => {
  const nodes = [node('a'), node('b', 400, 200)]; freeze(nodes);
  for (const changes of [[], [position('absent', 10, 20)], [{ type: 'remove' as const, id: 'absent' }]]) {
    const result = applyCanvasNodeChanges(nodes, changes); assert.equal(result.length, nodes.length); assert.ok(result.every((item, index) => item === nodes[index]));
  }
  const samePosition = applyCanvasNodeChanges(nodes, [position('a', 0, 0)]);
  assert.deepEqual(samePosition, nodes); assert.equal(samePosition[0].data, nodes[0].data); assert.equal(samePosition[0].style, nodes[0].style);
});

test('resize start and end without setAttributes survive the actual filter, preserving the end signal for its undo snapshot', () => {
  const start: NodeChange<Node<CardData>> = { type: 'dimensions', id: 'card', dimensions: { width: 420, height: 300 }, resizing: true };
  const end: NodeChange<Node<CardData>> = { type: 'dimensions', id: 'card', dimensions: { width: 420, height: 300 }, resizing: false };
  Object.freeze(start); Object.freeze(end);
  const retained = [start, end].filter(isSubstantiveNodeChange);
  assert.equal(retained.length, 2); assert.equal(retained[0], start); assert.equal(retained[1], end);

  const card = node('card', 30, 50, 'video', { width: 420, height: 300 });
  card.data.body = '在缩放之前已编辑的正文'; card.data.sourceUrl = '';
  card.data.transcript = [{ id: 'edited', start: 0, end: 2, text: '已校对字幕' }];
  const nodes = [card], before = structuredClone(nodes); freeze(nodes);
  const result = applyCanvasNodeChanges(nodes, retained);
  assert.equal(result[0].data, card.data); assert.equal(result[0].style, card.style); assert.equal(result[0].position, card.position);
  assert.equal(result[0].data.body, '在缩放之前已编辑的正文'); assert.equal(result[0].data.sourceUrl, '');
  assert.equal(result[0].data.transcript, card.data.transcript); assert.deepEqual(nodes, before);
});

test('ordinary measurements and selection stay outside history while explicit dimension attributes and resize ends are retained', () => {
  const measured: NodeChange<Node<CardData>> = { type: 'dimensions', id: 'measured', dimensions: { width: 300, height: 10_020 } };
  const measuredWithoutAttrs: NodeChange<Node<CardData>> = { type: 'dimensions', id: 'measured-no-attrs', dimensions: { width: 300, height: 280 }, setAttributes: false };
  const selection: NodeChange<Node<CardData>>[] = [{ type: 'select', id: 'selected', selected: true }, { type: 'select', id: 'unselected', selected: false }];
  const persisted: NodeChange<Node<CardData>>[] = [
    { type: 'dimensions', id: 'both', dimensions: { width: 420, height: 300 }, setAttributes: true },
    { type: 'dimensions', id: 'width', dimensions: { width: 420, height: 300 }, setAttributes: 'width' },
    { type: 'dimensions', id: 'height', dimensions: { width: 420, height: 300 }, setAttributes: 'height' },
    { type: 'dimensions', id: 'end-no-attrs', dimensions: { width: 420, height: 300 }, resizing: false, setAttributes: false },
  ];
  const retained = [measured, persisted[0], selection[0], measuredWithoutAttrs, persisted[1], selection[1], ...persisted.slice(2)].filter(isSubstantiveNodeChange);
  assert.deepEqual(retained.map(change => 'id' in change ? change.id : undefined), ['both', 'width', 'height', 'end-no-attrs']);
  assert.ok(retained.every((change, index) => change === persisted[index]), 'the original attribute/end events reach the existing canvas update and history path unchanged');
});
