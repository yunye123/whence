import assert from 'node:assert/strict';
import test from 'node:test';
import { nodeFlowBox, nodeFullyInside, pointerDragged, POINTER_DRAG_THRESHOLD } from '../src/app/canvas-pointer';

test('a right-drag counts only after the same 4px threshold as a card drag', () => {
  assert.equal(POINTER_DRAG_THRESHOLD, 4);
  assert.equal(pointerDragged(3, 0), false);
  assert.equal(pointerDragged(0, 4), false);
  assert.equal(pointerDragged(5, 0), true);
});

test('a card counts only when the whole card is inside the box', () => {
  const card = { x: 10, y: 10, width: 20, height: 20 };
  assert.equal(nodeFullyInside(card, { x: 0, y: 0, width: 40, height: 40 }), true);
  assert.equal(nodeFullyInside(card, { x: 12, y: 12, width: 30, height: 30 }), false, 'a box inside a card does not select it');
  assert.equal(nodeFullyInside(card, { x: 0, y: 0, width: 25, height: 40 }), false, 'a card that sticks out does not count');
  assert.equal(nodeFullyInside({ x: 0, y: 0, width: 0, height: 10 }, card), false);
});

test('measured size wins, and a missing size is not a box', () => {
  assert.deepEqual(nodeFlowBox({ position: { x: 1, y: 2 }, measured: { width: 30, height: 40 }, width: 9, height: 9 }), { x: 1, y: 2, width: 30, height: 40 });
  assert.equal(nodeFlowBox({ position: { x: 0, y: 0 }, style: { width: '100%' } }), null);
});
