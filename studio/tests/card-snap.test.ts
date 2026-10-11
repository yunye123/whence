import assert from 'node:assert/strict';
import test from 'node:test';
import { snapCards } from '../src/card-snap';
import { createNode } from '../src/board-utils';
import type { BoardNode, CardKind } from '../src/model';

function node(id: string, x: number, y: number, width = 100, height = 100, kind: CardKind = 'note'): BoardNode {
  return { ...createNode(kind), id, position: { x, y }, style: { width, height } };
}

test('nearby cards align their left edges with canvas-coordinate guides without mutating either card', () => {
  const nodes = [node('moving', 206, 200), node('reference', 200, 0)];
  const before = structuredClone(nodes);
  const result = snapCards(nodes, ['moving']);
  assert.equal(result.dx, -6); assert.equal(result.dy, 0);
  assert.deepEqual(result.guides, [{ axis: 'x', position: 200, from: -12, to: 312, referenceId: 'reference', feature: 'start' }]);
  assert.deepEqual(nodes, before);
});

test('center and trailing-edge guides use real mixed card dimensions', () => {
  const center = snapCards([node('moving', 151, 200, 100), node('reference', 0, 0, 200)], ['moving'], { reference: { width: 400, height: 100 } });
  assert.equal(center.dx, -1); assert.equal(center.guides[0].feature, 'center'); assert.equal(center.guides[0].position, 200);
  const right = snapCards([node('moving', 204, 200, 100), node('reference', 0, 0, 300)], ['moving']);
  assert.equal(right.dx, -4); assert.equal(right.guides[0].feature, 'end'); assert.equal(right.guides[0].position, 300);
  const bottom = snapCards([node('moving', 200, 497, 100, 100, 'image'), node('reference', 0, 100, 100, 500, 'video')], ['moving']);
  assert.equal(bottom.dy, 3); assert.equal(bottom.guides[0].axis, 'y'); assert.equal(bottom.guides[0].feature, 'end');
});

test('six screen pixels feel the same at 20%, 100% and 200% zoom', () => {
  for (const zoom of [.2, 1, 2]) {
    const offset = 5.8 / zoom;
    const inside = snapCards([node('moving', 200 + offset, 100 + 100 / zoom), node('reference', 200, 0)], ['moving'], {}, { zoom });
    assert.ok(Math.abs(inside.dx + offset) < .000_001);
    const outside = snapCards([node('moving', 200 + 6.01 / zoom, 100 + 100 / zoom), node('reference', 200, 0)], ['moving'], {}, { zoom });
    assert.equal(outside.dx, 0);
    assert.equal(outside.guides.some(guide => guide.axis === 'x'), false);
  }
});

test('Alt bypass, distant and excluded references do not attract a drag', () => {
  const nodes = [node('moving', 204, 200), node('near', 200, 0), node('far', 204, -20_000), node('frame', 204, 150, 600, 600, 'frame')];
  assert.deepEqual(snapCards(nodes, ['moving'], {}, { bypass: true }), { dx: 0, dy: 0, guides: [] });
  assert.deepEqual(snapCards(nodes, ['moving'], {}, { referenceIds: ['far', 'frame'] }), { dx: 0, dy: 0, guides: [] });
  const far = snapCards([node('moving', 204, 300), node('near', 200, 0)], ['moving']);
  assert.deepEqual(far, { dx: 0, dy: 0, guides: [] });
});

test('a multi-selection and frame contents move as one external box without self-attraction', () => {
  const nodes = [node('a', 204, 200), node('b', 350, 500, 200, 150), node('reference', 200, 0, 346, 100)];
  const result = snapCards(nodes, ['a', 'b']);
  assert.equal(result.dx, -4); assert.equal(result.dy, 0);
  const applied = nodes.map(item => ['a', 'b'].includes(item.id) ? { ...item, position: { x: item.position.x + result.dx, y: item.position.y + result.dy } } : item);
  assert.equal(applied[1].position.x - applied[0].position.x, nodes[1].position.x - nodes[0].position.x);
  assert.equal(applied[1].position.y - applied[0].position.y, nodes[1].position.y - nodes[0].position.y);
  assert.equal(applied[2], nodes[2]);
  assert.deepEqual(snapCards(nodes.slice(0, 2), ['a', 'b']), { dx: 0, dy: 0, guides: [] });
  const frame = snapCards([node('frame', 204, 200, 400, 500, 'frame'), node('child', 250, 250), node('reference', 200, 0, 400)], ['frame', 'child']);
  assert.equal(frame.dx, -4); assert.equal(frame.dy, 0);
});

test('equally close references use stable IDs even if board order changes', () => {
  const moving = node('moving', 200, 200), a = node('a', 196, 0), b = node('b', 204, 0);
  const first = snapCards([moving, a, b], ['moving']), second = snapCards([b, a, moving], ['moving']);
  assert.deepEqual(first, second); assert.equal(first.dx, -4); assert.equal(first.guides[0].referenceId, 'a');
});

test('invalid or absent groups and coordinate-limit offsets remain saveable', () => {
  assert.deepEqual(snapCards([node('a', 0, 0)], []), { dx: 0, dy: 0, guides: [] });
  assert.deepEqual(snapCards([node('a', 0, 0)], ['missing']), { dx: 0, dy: 0, guides: [] });
  assert.deepEqual(snapCards([node('a', NaN, 0), node('b', 0, 0)], ['a']), { dx: 0, dy: 0, guides: [] });
  const result = snapCards([node('moving', 9_999_999, 200, 100), node('reference', 10_000_000, 0, 102)], ['moving']);
  assert.equal(result.dx, 1); assert.equal(result.guides[0].feature, 'start');
  const blocked = snapCards([node('moving', 10_000_000, 200, 100), node('reference', 10_000_000, 0, 102)], ['moving']);
  assert.equal(blocked.dx, 0); assert.equal(blocked.guides[0].feature, 'start');
});
