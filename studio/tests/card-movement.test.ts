import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoard, validateBoard } from '../src/storage';
import { createNode } from '../src/board-utils';
import { alignCards, canDistributeCards, movingCardIds, nudgeCards } from '../src/card-movement';
import type { BoardNode, CardKind } from '../src/model';

function node(id: string, x: number, y: number, width = 100, height = 100, kind: CardKind = 'note'): BoardNode {
  return { ...createNode(kind), id, position: { x, y }, style: { width, height } };
}
function board(nodes: BoardNode[]) { return { ...createBoard('blank'), nodes }; }

test('multi-select plus overlapping frames move every fully contained ordinary card only once', () => {
  const original = board([
    node('frame', 0, 0, 500, 500, 'frame'), node('overlapping-frame', 50, 50, 500, 500, 'frame'),
    node('child', 100, 100), node('partial', 475, 450), node('outside', 800, 800),
  ]);
  assert.deepEqual([...movingCardIds(original.nodes, ['frame', 'overlapping-frame', 'child', 'frame'])].sort(), ['child', 'frame', 'overlapping-frame']);
  const result = nudgeCards(original, ['frame', 'overlapping-frame', 'child'], 32, -10);
  assert.deepEqual(result.nodes.find(item => item.id === 'child')?.position, { x: 132, y: 90 });
  assert.deepEqual(result.nodes.find(item => item.id === 'partial')?.position, { x: 475, y: 450 });
  assert.deepEqual(result.nodes.find(item => item.id === 'outside')?.position, { x: 800, y: 800 });
  assert.deepEqual(original.nodes[2].position, { x: 100, y: 100 });
  assert.doesNotThrow(() => validateBoard(result));
});

test('rendered measurements decide containment when a naturally tall card extends beyond its frame', () => {
  const original = board([node('frame', 0, 0, 500, 500, 'frame'), node('short-looking', 100, 100)]);
  assert.equal(movingCardIds(original.nodes, ['frame']).has('short-looking'), true);
  const measurements = { 'short-looking': { width: 120, height: 600 } };
  assert.equal(movingCardIds(original.nodes, ['frame'], measurements).has('short-looking'), false);
  const moved = nudgeCards(original, ['frame'], 10, 10, measurements);
  assert.deepEqual(moved.nodes[1].position, original.nodes[1].position);
});

test('a group nudge clamps at both coordinate limits while preserving relative spacing', () => {
  const original = board([node('edge', 9_999_995, -9_999_992), node('near', 9_999_895, -9_999_800), node('static', 0, 0)]);
  const result = nudgeCards(original, ['edge', 'near'], 32, -32);
  assert.deepEqual(result.nodes[0].position, { x: 10_000_000, y: -10_000_000 });
  assert.deepEqual(result.nodes[1].position, { x: 9_999_900, y: -9_999_808 });
  assert.deepEqual(result.nodes[2].position, { x: 0, y: 0 });
  assert.equal(result.nodes[0].position.x - result.nodes[1].position.x, 100);
  assert.doesNotThrow(() => validateBoard(result));
  assert.equal(nudgeCards(result, ['edge', 'near'], 32, -32), result);
  assert.equal(nudgeCards(original, ['missing'], 10, 10), original);
  assert.equal(nudgeCards(original, ['near'], 0, 0), original);
});

test('horizontal arrangement uses measured mixed widths with a consistent gap and keeps unselected cards', () => {
  const original = board([node('wide', 200, 200, 350, 100), node('small', 0, 20, 100, 100), node('third', 600, 50, 200, 300), node('frame', -50, -50, 900, 700, 'frame'), node('static', 40, 900)]);
  const result = alignCards(original, ['wide', 'small', 'third', 'frame'], 'horizontal', { wide: { width: 420, height: 120 } });
  assert.deepEqual(result.nodes.find(item => item.id === 'small')?.position, { x: 0, y: 20 });
  assert.deepEqual(result.nodes.find(item => item.id === 'wide')?.position, { x: 132, y: 20 });
  assert.deepEqual(result.nodes.find(item => item.id === 'third')?.position, { x: 584, y: 20 });
  assert.deepEqual(result.nodes[3].position, original.nodes[3].position);
  assert.deepEqual(result.nodes[4].position, original.nodes[4].position);
  assert.doesNotThrow(() => validateBoard(result));
});

test('vertical arrangement uses measured mixed heights; left and top alignment retain the other coordinate', () => {
  const original = board([node('tall', 300, 100, 150, 500), node('short', 80, 0, 100, 100), node('last', 400, 900, 200, 200)]);
  const measurements = { tall: { width: 150, height: 650 } };
  const result = alignCards(original, ['tall', 'short', 'last'], 'vertical', measurements);
  assert.deepEqual(result.nodes.map(item => item.position), [{ x: 80, y: 132 }, { x: 80, y: 0 }, { x: 80, y: 814 }]);
  assert.deepEqual(alignCards(original, ['tall', 'short', 'last'], 'left').nodes.map(item => item.position), [{ x: 80, y: 100 }, { x: 80, y: 0 }, { x: 80, y: 900 }]);
  assert.deepEqual(alignCards(original, ['tall', 'short', 'last'], 'top').nodes.map(item => item.position), [{ x: 300, y: 0 }, { x: 80, y: 0 }, { x: 400, y: 0 }]);
  assert.equal(alignCards(original, ['tall'], 'horizontal'), original);
});

test('arranging cards near a coordinate limit must produce a saveable board', () => {
  const original = board([node('one', 9_999_900, 0, 300, 100), node('two', 9_999_950, 150, 300, 100)]);
  assert.doesNotThrow(() => validateBoard(alignCards(original, ['one', 'two'], 'horizontal')));
});

test('right, bottom and center alignment use mixed rendered widths and heights without moving the other axis', () => {
  const original = board([node('a', 100, 250, 120, 200, 'note'), node('b', 400, 50, 300, 100, 'video'), node('c', 800, 700, 100, 400, 'image'), node('static', -100, 0)]);
  const measurements = { b: { width: 360, height: 150 } }, ids = ['a', 'b', 'c'];
  assert.deepEqual(alignCards(original, ids, 'right', measurements).nodes.slice(0, 3).map(item => item.position), [{ x: 780, y: 250 }, { x: 540, y: 50 }, { x: 800, y: 700 }]);
  assert.deepEqual(alignCards(original, ids, 'center-x', measurements).nodes.slice(0, 3).map(item => item.position), [{ x: 440, y: 250 }, { x: 320, y: 50 }, { x: 450, y: 700 }]);
  assert.deepEqual(alignCards(original, ids, 'bottom', measurements).nodes.slice(0, 3).map(item => item.position), [{ x: 100, y: 900 }, { x: 400, y: 950 }, { x: 800, y: 700 }]);
  assert.deepEqual(alignCards(original, ids, 'center-y', measurements).nodes.slice(0, 3).map(item => item.position), [{ x: 100, y: 475 }, { x: 400, y: 500 }, { x: 800, y: 375 }]);
  assert.equal(alignCards(original, ids, 'right', measurements).nodes[3], original.nodes[3]);
  assert.deepEqual(original.nodes[0].position, { x: 100, y: 250 });
});

test('horizontal equal gaps keep both endpoints, mixed widths, unselected cards and all other-axis positions', () => {
  const original = board([node('first', 0, 50), node('middle', 250, 350, 200), node('last', 900, 150, 300), node('static', 20, 900)]);
  const ids = ['last', 'first', 'middle'], measurements = { middle: { width: 300, height: 100 } };
  assert.equal(canDistributeCards(original.nodes, ids, 'horizontal', measurements), true);
  const result = alignCards(original, ids, 'distribute-horizontal', measurements);
  assert.deepEqual(result.nodes.map(item => item.position), [{ x: 0, y: 50 }, { x: 350, y: 350 }, { x: 900, y: 150 }, { x: 20, y: 900 }]);
  assert.equal(result.nodes[0], original.nodes[0]); assert.equal(result.nodes[2], original.nodes[2]); assert.equal(result.nodes[3], original.nodes[3]);
  assert.doesNotThrow(() => validateBoard(result));
  assert.equal(alignCards(result, ids, 'distribute-horizontal', measurements), result);
});

test('vertical equal gaps use measured tall text and reject insufficient selections or endpoint space', () => {
  const original = board([node('first', 0, 0, 100, 100), node('middle', 400, 100, 100, 500), node('last', 300, 900, 100, 200)]);
  const ids = ['first', 'middle', 'last'], measurements = { middle: { width: 100, height: 600 } };
  const result = alignCards(original, ids, 'distribute-vertical', measurements);
  assert.deepEqual(result.nodes.map(item => item.position), [{ x: 0, y: 0 }, { x: 400, y: 200 }, { x: 300, y: 900 }]);
  assert.equal(canDistributeCards(original.nodes, ids.slice(0, 2), 'vertical'), false);
  assert.equal(alignCards(original, ids.slice(0, 2), 'distribute-vertical'), original);
  const tooTall = { middle: { width: 100, height: 900 } };
  assert.equal(canDistributeCards(original.nodes, ids, 'vertical', tooTall), false);
  assert.equal(alignCards(original, ids, 'distribute-vertical', tooTall), original);
});

test('already aligned commands return the same board and coordinate clamping preserves shared edges', () => {
  const original = board([node('first', 100, 0), node('second', 100, 500)]);
  assert.equal(alignCards(original, ['first', 'second'], 'left'), original);
  const limits = board([node('wide', 10_000_000, 0, 10_000), node('small', 9_999_900, 200)]);
  const right = alignCards(limits, ['wide', 'small'], 'right');
  assert.equal(right.nodes[0].position.x + 10_000, right.nodes[1].position.x + 100);
  assert.equal(right.nodes[1].position.x, 10_000_000);
  assert.doesNotThrow(() => validateBoard(right));
});
