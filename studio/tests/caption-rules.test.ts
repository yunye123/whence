import test from 'node:test';
import assert from 'node:assert/strict';
import type { BoardNode } from '../src/model';
import { frameContainsCard, getCardBounds, rememberImageRatio } from '../src/card-placement';
import { captionRules, getVisibleCardBounds, captionReadingRows } from '../src/app/caption-rules';
import { visibleCardRects, unionVisibleCardBounds, fitViewportToRect, computeRevealViewport } from '../src/canvas/reveal';

const card = (id: string, kind: BoardNode['data']['kind'], x: number, y: number, width = 100, height = 100): BoardNode =>
  ({ id, type: 'card', position: { x, y }, style: { width, height }, data: { kind, title: id, body: '' } });
const frame = () => card('f', 'frame', -20, -20, 500, 500);

test('caption flags are display-only: preserve board geometry, strings and raw membership', () => {
  const nodes = [frame(), card('a', 'image', 0, 0), card('b', 'note', 200, 0)];
  const before = JSON.stringify(nodes), measures = { a: { width: 100, height: 100 } };
  const result = captionRules(nodes, measures);
  assert.equal(result.flags.get('a')?.inTray, true);
  assert.ok(result.captionIds.has('a'));
  assert.deepEqual(result.frameMembers.get('f'), ['a', 'b']);
  assert.equal(JSON.stringify(nodes), before);
  assert.deepEqual(measures, { a: { width: 100, height: 100 } });
  assert.equal(result.flags.get('f')?.inTray, false);
});

test('free photos show captions unless a neighbouring card crosses the 20px proximity or actual 24px band', () => {
  const photo = card('a', 'image', 0, 0);
  for (const y of [100, 110, 119.99, 120, 123.99]) {
    const r = captionRules([photo, card('b', 'note', 20, y)]);
    assert.equal(r.flags.get('a')?.tightCaption, true, `y=${y}`);
    assert.equal(r.captionIds.has('a'), false);
  }
  for (const other of [card('b', 'note', 0, 124), card('b', 'note', 100, 110), card('b', 'note', -100, 110)])
    assert.ok(captionRules([photo, other]).captionIds.has('a'), 'touching an edge does not overlap');
});

test('200px spatial grid handles negative positions and cards spanning many cells', () => {
  const a = card('a', 'image', -201, -210, 800, 200);
  assert.equal(captionRules([a, card('b', 'note', 580, 0)]).captionIds.has('a'), false);
  assert.equal(captionRules([a, card('b', 'note', 599, 0)]).captionIds.has('a'), true);
});

test('look-table rows with 22px air show all captions; old 12px rows remain hover-only without moving', () => {
  for (const gap of [12, 21.999, 22, 30]) {
    const nodes = [frame(), card('a', 'image', 0, 0), card('b', 'image', 106, 0), card('c', 'image', 0, 100 + gap)];
    const before = JSON.stringify(nodes), r = captionRules(nodes);
    for (const id of ['a', 'b', 'c']) assert.equal(r.captionIds.has(id), gap >= 22, `${id} gap=${gap}`);
    assert.equal(JSON.stringify(nodes), before);
  }
});

test('row clearance counts the tallest card, including non-image members', () => {
  const nodes = [frame(), card('a', 'image', 0, 0, 100, 100), card('b', 'note', 150, 0, 100, 150), card('c', 'image', 0, 160)];
  assert.equal(captionRules(nodes).captionIds.size, 0);
});

test('a regular tray does not exempt its captions from a crossing outsider or an overlapping member', () => {
  const f = card('f', 'frame', 0, 0, 250, 200), a = card('a', 'image', 16, 50);
  assert.ok(captionRules([f, a]).captionIds.has('a'));
  for (const b of [card('b', 'note', -10, 155, 80, 100), card('b', 'note', 30, 60, 30, 105)])
    assert.equal(captionRules([f, a, b]).captionIds.has('a'), false);
});

test('background frames do not obstruct free-photo captions or count as members of other frames', () => {
  const a = card('a', 'image', 0, 0), f = card('f', 'frame', 0, 110, 400, 300);
  const r = captionRules([a, f, card('outer', 'frame', -100, -100, 900, 900)]);
  assert.ok(r.captionIds.has('a'));
  assert.deepEqual(r.frameMembers.get('outer'), ['a']);
});

test('print numbering uses half the shorter height for row membership, x order, then id ties', () => {
  const nodes = [frame(), card('z', 'image', 200, 0, 100, 100), card('b', 'image', 0, 40, 100, 100), card('a', 'image', 0, 40, 100, 100), card('c', 'image', 0, 90, 100, 100)];
  const r = captionRules(nodes);
  assert.deepEqual([...r.printNumbers], [['a', '01'], ['b', '02'], ['z', '03'], ['c', '04']]);
  assert.deepEqual([...captionRules([...nodes].reverse()).printNumbers], [...r.printNumbers]);
  const rows = captionReadingRows([card('a', 'image', 100, 0), card('b', 'image', 0, 49), card('c', 'image', 0, 50)].map(node => ({ id: node.id, box: getCardBounds(node) })));
  assert.deepEqual(rows.map(row => row.map(e => e.id)), [['b', 'a'], ['c']]);
});

test('overlapping trays preserve every raw membership; smallest tray owns numbering and any tight tray hides', () => {
  const nodes = [frame(), card('inner', 'frame', -10, -10, 230, 240), card('a', 'image', 0, 0), card('b', 'image', 0, 112)];
  const r = captionRules(nodes);
  assert.deepEqual(r.frameMembers.get('f'), ['a', 'b']);
  assert.deepEqual(r.frameMembers.get('inner'), ['a', 'b']);
  assert.equal(r.flags.get('a')?.frameId, 'inner');
  assert.equal(r.captionIds.size, 0);
});

test('known natural image ratio beats stale placeholder measurements before adding a caption', () => {
  const a = card('ratio-a', 'image', 10, 20, 200, 100); delete a.style!.height;
  a.data.mediaId = 'caption-ratio'; rememberImageRatio('media:caption-ratio', 400, 100);
  const measures = { 'ratio-a': { width: 200, height: 480 } };
  const r = captionRules([a], measures), raw = getCardBounds(a, measures);
  assert.equal(raw.height, 50);
  assert.deepEqual(getVisibleCardBounds(a, measures, r.captionIds), { ...raw, height: 74 });
  assert.equal(getCardBounds(a, measures).height, 50);
});

test('visible caption bounds never change membership, fixed height or hidden/low-zoom captions', () => {
  const f = card('f', 'frame', 0, 0, 120, 120), a = card('a', 'image', 10, 10);
  const r = captionRules([f, a]);
  assert.ok(frameContainsCard(f, a));
  assert.equal(getVisibleCardBounds(a, {}, r.captionIds).height, 124);
  assert.ok(frameContainsCard(f, a));
  for (const lod of ['simple', 'far'] as const) assert.equal(getVisibleCardBounds(a, {}, r.captionIds, lod).height, 100);
  assert.equal(getVisibleCardBounds(a, {}, new Set()).height, 100);
  assert.equal(getVisibleCardBounds(f, {}, new Set(['f'])).height, 120);
});

test('visible rectangles feed fit, first-open and reveal without fabricated measurements', () => {
  const nodes = [card('a', 'image', 0, 0)], r = captionRules(nodes);
  assert.deepEqual(visibleCardRects(nodes, {}, r.captionIds), [{ x: 0, y: 0, width: 100, height: 124 }]);
  const visible = unionVisibleCardBounds(nodes, {}, r.captionIds)!;
  const size = { width: 300, height: 120 }, insets = { top: 0, right: 0, bottom: 0, left: 0 };
  assert.ok(fitViewportToRect(visible, size, insets)!.zoom < 1);
  assert.notEqual(computeRevealViewport(visible, { x: 0, y: 0, zoom: 1 }, size, insets), null);
  assert.equal(unionVisibleCardBounds([], {}, new Set()), null);
});

test('spatial result agrees with a brute-force caption collision oracle across 600 dispersed cards', () => {
  const nodes = Array.from({ length: 600 }, (_, i) => card(String(i), i % 3 ? 'note' : 'image', (i % 30) * 131 - 1800, Math.floor(i / 30) * 113 - 900, 110, 100));
  const r = captionRules(nodes);
  for (const a of nodes.filter(n => n.data.kind === 'image')) {
    const box = getCardBounds(a), bottom = box.y + box.height;
    const blocked = nodes.some(b => b.id !== a.id && b.position.x < box.x + box.width && b.position.x + 110 > box.x && b.position.y < bottom + 24 && b.position.y + 100 > bottom);
    assert.equal(r.captionIds.has(a.id), !blocked, a.id);
  }
});
