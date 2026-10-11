import assert from 'node:assert/strict';
import test from 'node:test';
import { frameContainsCard, getCardBounds, imageRatioKey, placeCards, rememberImageRatio, type CardMeasurements } from '../src/card-placement';
import type { BoardNode, CardKind } from '../src/model';

type Size = { width: number; height: number };

function card(id: string, kind: CardKind, x = 0, y = 0, style?: Size): BoardNode {
  return { id, type: 'card', position: { x, y }, data: { kind, title: `参考 ${id}`, body: '保留的内容' }, ...(style ? { style } : {}) };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

// Use fixture dimensions here, independently of getCardBounds, so an incorrect
// bounds result cannot also make the placement assertions pass.
function assertSeparated(a: BoardNode, b: BoardNode, sizes: Record<string, Size>, gap = 32) {
  const aSize = sizes[a.id];
  const bSize = sizes[b.id];
  assert.ok(aSize && bSize, 'the fixture must describe both rendered card sizes');
  const separated = a.position.x + aSize.width + gap <= b.position.x
    || b.position.x + bSize.width + gap <= a.position.x
    || a.position.y + aSize.height + gap <= b.position.y
    || b.position.y + bSize.height + gap <= a.position.y;
  assert.ok(separated, `${a.id} and ${b.id} must have at least ${gap}px clearance`);
}

test('rendered measurements override stored dimensions without changing the card position', () => {
  const portrait = card('portrait', 'image', -12.5, 45.25, { width: 290, height: 480 });
  assert.deepEqual(getCardBounds(portrait, { portrait: { width: 354, height: 925 } }), {
    x: -12.5, y: 45.25, width: 354, height: 925,
  });
  assert.deepEqual(getCardBounds(portrait), { x: -12.5, y: 45.25, width: 290, height: 480 });
});

test('missing and invalid dimensions fall back per axis instead of producing empty or infinite bounds', () => {
  const defaults: Array<[CardKind, number, number]> = [
    ['frame', 660, 450], ['draft', 340, 440], ['video', 290, 520],
    ['image', 290, 480], ['quote', 290, 500], ['note', 290, 440], ['link', 290, 440],
  ];
  for (const [kind, width, height] of defaults) {
    assert.deepEqual(getCardBounds(card(kind, kind)), { x: 0, y: 0, width, height });
  }
  const node = card('invalid', 'image', 3, 7, { width: 410, height: 630 });
  assert.deepEqual(getCardBounds(node, { invalid: { width: 0, height: 850 } }), { x: 3, y: 7, width: 410, height: 850 });
  for (const invalid of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(getCardBounds(node, { invalid: { width: invalid, height: invalid } }), { x: 3, y: 7, width: 410, height: 630 });
    assert.deepEqual(getCardBounds({ ...node, style: { width: invalid, height: invalid } }), { x: 3, y: 7, width: 290, height: 480 });
  }
});

test('a mixed batch clears measured natural heights, fixed-size cards, and earlier cards in the batch', () => {
  const existing = [
    card('existing-portrait', 'image', 100, 80, { width: 290, height: 480 }),
    card('existing-note', 'note', 500, 80, { width: 360, height: 710 }),
  ];
  const batch = [
    card('new-portrait', 'image'),
    card('new-draft', 'draft', 0, 0, { width: 420, height: 650 }),
    card('new-quote', 'quote'),
    card('new-note', 'note'),
  ];
  const measurements: CardMeasurements = {
    'existing-portrait': { width: 350, height: 1060 },
    'new-portrait': { width: 330, height: 880 },
    'new-quote': { width: 290, height: 720 },
  };
  const sizes = {
    ...measurements,
    'existing-note': { width: 360, height: 710 },
    'new-draft': { width: 420, height: 650 },
    'new-note': { width: 290, height: 440 },
  };
  const placed = placeCards(batch, existing, { origin: { x: 100, y: 80 }, measurements });
  assert.deepEqual(placed.map(node => node.id), batch.map(node => node.id));
  for (const [index, node] of placed.entries()) {
    for (const obstacle of [...existing, ...placed.slice(0, index)]) assertSeparated(node, obstacle, sizes);
  }
});

test('500 cards are placed deterministically with finite coordinates and no overlapping pairs', { timeout: 10_000 }, () => {
  const batch = Array.from({ length: 500 }, (_, index) => card(`large-${index}`, index % 2 ? 'image' : 'note', 0, 0, {
    width: 250 + (index % 5) * 35, height: 320 + (index % 7) * 65,
  }));
  const sizes = Object.fromEntries(batch.map(node => [node.id, node.style as Size]));
  const options = { origin: { x: -500, y: -250 } };
  const placed = placeCards(batch, [], options);
  assert.equal(placed.length, 500);
  assert.deepEqual(placeCards(batch, [], options), placed, 'repeating an insertion plan must not change its positions');
  for (const [index, node] of placed.entries()) {
    assert.ok(Number.isFinite(node.position.x) && Number.isFinite(node.position.y));
    for (let other = 0; other < index; other++) assertSeparated(node, placed[other], sizes);
  }
});

test('an explicit first drop stays exact even on an obstacle, while following cards avoid both', () => {
  const origin = { x: -71.25, y: 93.75 };
  const obstacle = card('obstacle', 'video', -100, 50, { width: 600, height: 920 });
  const first = card('first', 'image', origin.x, origin.y, { width: 380, height: 750 });
  const second = card('second', 'note', origin.x, origin.y, { width: 300, height: 440 });
  const third = card('third', 'draft', origin.x, origin.y, { width: 340, height: 650 });
  const sizes = Object.fromEntries([obstacle, first, second, third].map(node => [node.id, node.style as Size]));
  const placed = placeCards([first, second, third], [obstacle], { origin, preserveFirst: true });
  assert.deepEqual(placed[0].position, origin);
  for (let index = 1; index < placed.length; index++) {
    assertSeparated(placed[index], obstacle, sizes);
    for (let previous = 0; previous < index; previous++) assertSeparated(placed[index], placed[previous], sizes);
  }
});

test('a grouping frame does not block placing an ordinary card inside the region', () => {
  const frame = card('region', 'frame', -100, -100, { width: 1800, height: 1600 });
  const origin = { x: 100, y: 120 };
  const placed = placeCards([card('inside', 'image')], [frame], { origin });
  assert.deepEqual(placed[0].position, origin);
  assert.equal(frameContainsCard(frame, placed[0]), true);
});

test('frame membership requires the entire rendered portrait, not only its origin or stored height', () => {
  const frame = card('frame', 'frame', 100, 100, { width: 660, height: 450 });
  const portrait = card('portrait', 'image', 120, 160, { width: 290, height: 300 });
  assert.equal(frameContainsCard(frame, portrait), true);
  assert.equal(frameContainsCard(frame, portrait, { portrait: { width: 290, height: 850 } }), false);
  const measuredFrame = { frame: { width: 660, height: 1000 }, portrait: { width: 290, height: 850 } };
  assert.equal(frameContainsCard(frame, portrait, measuredFrame), true);
});

test('frame membership accepts exact boundaries and rejects crossing any edge, frames, or self', () => {
  const frame = card('frame', 'frame', 100, 100, { width: 660, height: 450 });
  const exact = card('exact', 'note', 100, 100, { width: 660, height: 450 });
  assert.equal(frameContainsCard(frame, exact), true);
  for (const [x, y] of [[99.5, 100], [100.5, 100], [100, 99.5], [100, 100.5]]) {
    assert.equal(frameContainsCard(frame, { ...exact, position: { x, y } }), false);
  }
  assert.equal(frameContainsCard(frame, frame), false);
  assert.equal(frameContainsCard(frame, { ...exact, id: frame.id }), false);
  assert.equal(frameContainsCard(frame, card('nested-frame', 'frame', 120, 120, { width: 300, height: 200 })), false);
  assert.equal(frameContainsCard(exact, card('small-note', 'note', 120, 120, { width: 100, height: 100 })), false);
});

test('placement preserves caller inputs and returns independent position objects, including a preserved drop', () => {
  const batch = freezeDeep([card('first', 'image', 25.5, -41.5), card('second', 'note', 25.5, -41.5)]);
  const existing = freezeDeep([card('existing', 'video', 25.5, -41.5)]);
  const options = freezeDeep({ origin: { x: 25.5, y: -41.5 }, preserveFirst: true, measurements: { first: { width: 310, height: 840 } } });
  const snapshot = structuredClone({ batch, existing, options });
  const placed = placeCards(batch, existing, options);
  assert.deepEqual({ batch, existing, options }, snapshot);
  for (const [index, node] of placed.entries()) {
    assert.notEqual(node.position, batch[index].position);
    assert.deepEqual(node.data, batch[index].data);
  }
  placed[0].position.x += 100;
  assert.deepEqual({ batch, existing, options }, snapshot, 'moving a result must not move the caller-owned drop point');
  assert.deepEqual(placeCards([], existing, options), []);
});

test('FC-01: an image saved without a height counts at its picture ratio once known, over a placeholder measurement', () => {
  const tray = card('tray', 'frame', 0, 0, { width: 322, height: 220 });
  const picture: BoardNode = { ...card('wide', 'image', 16, 16, { width: 290 } as Size), data: { kind: 'image', title: '横图', body: '', mediaId: 'fc01-test-wide' } };
  // Never on screen: default 480; rendered while loading: the 4:3 placeholder (218). Both leave the tray.
  assert.equal(getCardBounds(picture).height, 480);
  const placeholder: CardMeasurements = { wide: { width: 290, height: 218 } };
  assert.equal(frameContainsCard(tray, picture, placeholder), false);
  // The picture is 16:9: 290 × 163 fits the tray. Nothing about the node changes.
  const before = JSON.stringify(picture);
  assert.equal(rememberImageRatio(imageRatioKey(picture)!, 1920, 1080), true);
  assert.equal(rememberImageRatio(imageRatioKey(picture)!, 1920, 1080), false, 'the same ratio is not news');
  assert.equal(getCardBounds(picture).height, 163);
  assert.equal(getCardBounds(picture, placeholder).height, 163);
  assert.equal(frameContainsCard(tray, picture, placeholder), true);
  assert.equal(JSON.stringify(picture), before);
  // A stored height (a resized or newly imported card) still decides; ratios clamp like the card (1:4–4:1).
  const resized: BoardNode = { ...picture, id: 'resized', style: { width: 290, height: 300 } };
  assert.equal(getCardBounds(resized).height, 300);
  const strip: BoardNode = { ...picture, id: 'strip', data: { ...picture.data, mediaId: 'fc01-test-strip' } };
  rememberImageRatio(imageRatioKey(strip)!, 9000, 1000);
  assert.equal(getCardBounds(strip).height, Math.round(290 / 4));
  assert.equal(imageRatioKey(card('note', 'note')), undefined);
});
