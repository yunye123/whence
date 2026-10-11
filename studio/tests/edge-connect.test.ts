import test from 'node:test';
import assert from 'node:assert/strict';
import { CONNECT_HINT, eventPoint, resolveConnectionDrop } from '../src/canvas/edges/connect';
import type { CardKind } from '../src/model';

const kinds: Record<string, CardKind> = { note: 'note', draft: 'draft', tray: 'frame', quote: 'quote' };
const kindOf = (id: string) => kinds[id];
const at = (ids: string[]) => () => ids;
const fromSource = { fromNode: { id: 'note' }, fromHandle: { type: 'source' }, isValid: null };

test('dropping a connection anywhere on a card connects to that card (EG-M2)', () => {
  assert.deepEqual(resolveConnectionDrop({ clientX: 10, clientY: 10 }, fromSource, kindOf, at(['draft'])), { source: 'note', target: 'draft' });
  // Dragged from the incoming handle: the dropped card becomes the source.
  assert.deepEqual(resolveConnectionDrop({ clientX: 10, clientY: 10 }, { ...fromSource, fromHandle: { type: 'target' } }, kindOf, at(['quote'])), { source: 'quote', target: 'note' });
  // A grouping tray is not a drop target; the card inside it is.
  assert.deepEqual(resolveConnectionDrop({ clientX: 1, clientY: 1 }, fromSource, kindOf, at(['tray', 'draft'])), { source: 'note', target: 'draft' });
  // An invalid snap (e.g. onto another outgoing handle) still connects to the card under the pointer.
  assert.deepEqual(resolveConnectionDrop({ clientX: 1, clientY: 1 }, { ...fromSource, isValid: false }, kindOf, at(['draft'])), { source: 'note', target: 'draft' });
});

test('empty canvas gives the hint; the source card itself and handled snaps do nothing', () => {
  assert.equal(resolveConnectionDrop({ clientX: 1, clientY: 1 }, fromSource, kindOf, at([])), 'hint');
  assert.equal(resolveConnectionDrop({ clientX: 1, clientY: 1 }, fromSource, kindOf, at(['tray'])), 'hint');
  assert.equal(resolveConnectionDrop({ clientX: 1, clientY: 1 }, fromSource, kindOf, at(['note', 'draft'])), null);
  assert.equal(resolveConnectionDrop({ clientX: 1, clientY: 1 }, { ...fromSource, isValid: true }, kindOf, at(['draft'])), null, 'React Flow already called onConnect');
  assert.equal(resolveConnectionDrop({ clientX: 1, clientY: 1 }, { fromNode: null }, kindOf, at(['draft'])), null);
  assert.equal(CONNECT_HINT, '拖到另一张卡片上即可连接');
});

test('touch end events use the changed touch point', () => {
  assert.deepEqual(eventPoint({ changedTouches: [{ clientX: 4, clientY: 5 }] }), { x: 4, y: 5 });
  assert.deepEqual(eventPoint({ clientX: 7, clientY: 8 }), { x: 7, y: 8 });
  assert.equal(eventPoint({ changedTouches: [] }), null);
});
