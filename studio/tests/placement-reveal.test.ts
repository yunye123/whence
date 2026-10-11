import assert from 'node:assert/strict';
import test from 'node:test';
import { getCardBounds, placeAtPointer, placeBatchAtPoint, placeBatchInView, placeInView, type CardBounds } from '../src/card-placement';
import { cameraDuration, cameraEase, computeRevealViewport, fitViewportToRect, fitsAtZoom, rectContains, startAreaZoom, unionRects } from '../src/canvas/reveal';
import { visibleFlowRect, type SafeInsets } from '../src/canvas/safe-area';
import { createNode } from '../src/board-utils';
import type { BoardNode, CardKind } from '../src/model';

type Size = { width: number; height: number };
function card(id: string, kind: CardKind, x = 0, y = 0, style?: Size): BoardNode {
  return { id, type: 'card', position: { x, y }, data: { kind, title: id, body: '' }, ...(style ? { style } : {}) };
}
function overlaps(a: CardBounds, b: CardBounds, gap = 0) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

// 1440×900 window: canvas 1186×822, toolbar + navigator on the bottom edge.
const size = { width: 1186, height: 822 };
const insets: SafeInsets = { top: 24, right: 24, bottom: 154, left: 24 };

test('a target already completely inside the safe area does not move the camera', () => {
  const viewport = { x: 0, y: 0, zoom: 1 };
  assert.equal(computeRevealViewport({ x: 100, y: 100, width: 290, height: 300 }, viewport, size, insets), null);
});

test('a card hidden behind the bottom toolbar is panned (not zoomed) to the centre, 10% above the middle', () => {
  const viewport = { x: 0, y: 0, zoom: 1 };
  const target = { x: 400, y: 600, width: 290, height: 200 }; // bottom edge at 800 is under the 154px bottom inset
  const next = computeRevealViewport(target, viewport, size, insets)!;
  assert.ok(next);
  assert.equal(next.zoom, 1, 'pan only');
  const visible = visibleFlowRect(next, size, insets);
  assert.ok(rectContains(visible, target), 'target completely visible afterwards');
  const centreX = next.x + (target.x + target.width / 2) * next.zoom;
  const centreY = next.y + (target.y + target.height / 2) * next.zoom;
  assert.ok(Math.abs(centreX - (24 + 1138 / 2)) < 1);
  assert.ok(Math.abs(centreY - (24 + 644 / 2 - 64.4)) < 1, 'centre sits 10% of the safe height above the middle');
});

test('zoom drops only as far as needed, never below 50%; a target too large even then shows its start', () => {
  const viewport = { x: 0, y: 0, zoom: 1 };
  const wide = { x: 0, y: 0, width: 1800, height: 300 };
  const fitted = computeRevealViewport(wide, viewport, size, insets)!;
  assert.ok(Math.abs(fitted.zoom - 1138 / 1800) < 1e-9);
  assert.ok(rectContains(visibleFlowRect(fitted, size, insets), wide));
  const huge = { x: 1000, y: 2000, width: 6000, height: 4000 };
  const capped = computeRevealViewport(huge, viewport, size, insets)!;
  assert.equal(capped.zoom, .5);
  assert.deepEqual({ x: capped.x + huge.x * capped.zoom, y: capped.y + huge.y * capped.zoom }, { x: 24, y: 24 }, 'top-left of the target at the safe-area corner');
});

test('revealing from the overview lifts the view to 50% instead of leaving the card unreadable', () => {
  const next = computeRevealViewport({ x: 0, y: 0, width: 290, height: 300 }, { x: 500, y: 300, zoom: .25 }, size, insets)!;
  assert.equal(next.zoom, .5);
});

test('first open: a forced zoom aligns a start area larger than the view to the safe-area corner', () => {
  // Demo board footprint (fallback sizes): wider and taller than the 1138×644 safe area.
  const start = { x: 0, y: 0, width: 1355, height: 770 };
  const first = computeRevealViewport(start, { x: 70, y: 35, zoom: .85 }, size, insets, { zoom: 1 })!;
  assert.deepEqual(first, { x: 24, y: 24, zoom: 1 });
  // A small template is centred at 100%.
  const centred = computeRevealViewport({ x: 0, y: 0, width: 1030, height: 440 }, { x: 70, y: 35, zoom: .85 }, size, insets, { zoom: 1 })!;
  assert.equal(centred.zoom, 1);
  assert.ok(Math.abs(centred.x - (24 + (1138 - 1030) / 2)) < 1e-9);
});

test('first open (§5.5, W-M3, C16): 100% when the start area fits, down to 86% to show all of it, never a column cut at the right', () => {
  // New layout: 1280×800 minus sidebar 240, topbar 52 and rail 48 → viewport 1040×700; safe area 992×652.
  const writing = { x: 0, y: 0, width: 1036, height: 742 };
  const small = { width: 1040, height: 700 }, smallInsets: SafeInsets = { top: 24, right: 24, bottom: 24, left: 24 };
  const zoom = startAreaZoom(writing, small, smallInsets);
  assert.equal(zoom, Math.floor(652 / 742 * 100) / 100, 'shrinks just enough to show the whole example, in whole percents (CORE-37)');
  const view = computeRevealViewport(writing, { x: 24, y: 24, zoom: 1 }, small, smallInsets, { zoom, centerBias: .5 })!;
  assert.ok(rectContains(visibleFlowRect(view, small, smallInsets), writing), 'draft and note are no longer cut off at the right edge');
  // 1366×768 → viewport 1126×668, safe 1078×620: 86% uses 18.12px of the existing 24px bottom comfort gap.
  const mid = { width: 1126, height: 668 };
  assert.equal(startAreaZoom(writing, mid, smallInsets), .86);
  const midView = computeRevealViewport(writing, { x: 24, y: 24, zoom: 1 }, mid, smallInsets, { zoom: .86, centerBias: .5 })!;
  assert.ok(midView.y + (writing.y + writing.height) * .86 <= mid.height - (smallInsets.bottom - 24), 'the last card ends above the rail');
  // A start area that fits opens at exactly 100%.
  assert.equal(startAreaZoom({ x: 0, y: 0, width: 1030, height: 440 }, size, insets), 1);
  // Too tall to show whole even at 86% (the creative example's two trays at 1440×900): 100%, only the width decides.
  const tall = { x: 0, y: 0, width: 1052, height: 924 };
  assert.equal(startAreaZoom(tall, size, insets), 1);
  const top = computeRevealViewport(tall, { x: 70, y: 35, zoom: .85 }, size, insets, { zoom: 1, centerBias: .5 })!;
  assert.equal(top.y, 24, 'top of the start area at the top of the safe area');
  // Too wide at 100% and too tall even at 86%: the width fits, as far as 86%.
  assert.equal(startAreaZoom({ x: 0, y: 0, width: 1240, height: 1200 }, size, insets), Math.floor(1138 / 1240 * 100) / 100);
  // CORE-37: a hair under 100% (the creative example at 1920×1080 computed 0.9957) opens at exactly 100%.
  assert.equal(startAreaZoom({ x: 0, y: 0, width: 1030, height: 0 }, size, insets) , 1);
  assert.equal(startAreaZoom({ x: 0, y: 0, width: 1138 / .99, height: 400 }, size, insets), 1);
  assert.equal(startAreaZoom({ x: 0, y: 0, width: 4000, height: 3000 }, size, insets), .86, 'never below the full card tier');
});

test('"查看全部" fits the board inside the safe area and never zooms past 100%', () => {
  const board = { x: -200, y: -100, width: 2400, height: 1400 };
  const fit = fitViewportToRect(board, size, insets)!;
  assert.ok(rectContains(visibleFlowRect(fit, size, insets), board));
  const tiny = fitViewportToRect({ x: 0, y: 0, width: 200, height: 100 }, size, insets)!;
  assert.equal(tiny.zoom, 1);
  assert.equal(fitsAtZoom(board, .5, size, insets), false);
  assert.equal(fitsAtZoom({ x: 0, y: 0, width: 2000, height: 1000 }, .5, size, insets), true);
});

test('camera moves use 320ms, 480ms beyond 1.5 canvas widths, and jump under reduced motion', () => {
  const from = { x: 0, y: 0, zoom: 1 };
  assert.equal(cameraDuration(from, { x: 300, y: 0, zoom: 1 }, size, false), 320);
  assert.equal(cameraDuration(from, { x: 2000, y: 0, zoom: 1 }, size, false), 480);
  assert.equal(cameraDuration(from, { x: 2000, y: 0, zoom: 1 }, size, true), 0);
  let previous = 0;
  for (let step = 1; step <= 20; step++) { const value = cameraEase(step / 20); assert.ok(value >= previous - 1e-9); previous = value; }
  assert.equal(cameraEase(0), 0); assert.equal(cameraEase(1), 1);
  assert.ok(Math.abs(cameraEase(.5) - .5) < 1e-3, 'symmetric ease-in-out');
});

test('union of card rects ignores non-finite input', () => {
  assert.deepEqual(unionRects([{ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: -5, width: 10, height: 10 }, { x: Number.NaN, y: 0, width: 1, height: 1 }]), { x: 0, y: -5, width: 30, height: 15 });
  assert.equal(unionRects([]), null);
});

// CV-B1 reproduction geometry: the viewport the video audit recorded (translate 593,411 at 100%).
const view = visibleFlowRect({ x: 593, y: 411, zoom: 1 }, size, insets);

test('a new note or draft is centred in the visible canvas, not under the toolbar or outside the view', () => {
  const note = placeInView(createNode('note'), [], view);
  const box = getCardBounds(note);
  assert.ok(rectContains(view, box));
  assert.ok(Math.abs(box.x + box.width / 2 - (view.x + view.width / 2)) <= 1);
});

test('the 32px spiral skips occupied space and still prefers a slot completely inside the view', () => {
  const blocker = card('blocker', 'note', view.x + view.width / 2 - 150, view.y + view.height / 2 - 200, { width: 300, height: 400 });
  const fresh = createNode('draft');
  const measurements = { [fresh.id]: { width: 340, height: 300 } };
  const draft = placeInView(fresh, [blocker], view, measurements);
  const box = getCardBounds(draft, measurements);
  assert.ok(!overlaps(box, getCardBounds(blocker), 32), 'keeps the 32px card gap');
  assert.ok(rectContains(view, box), 'still fully visible');
});

test('a crowded view still yields a non-overlapping slot, and placement never mutates its inputs', () => {
  const crowd = Array.from({ length: 12 }, (_, index) => card(`crowd-${index}`, 'note', view.x + (index % 4) * 300, view.y + Math.floor(index / 4) * 230, { width: 290, height: 220 }));
  const snapshot = structuredClone(crowd);
  const placed = placeInView(createNode('note'), crowd, view);
  for (const other of crowd) assert.ok(!overlaps(getCardBounds(placed), getCardBounds(other)));
  assert.deepEqual(crowd, snapshot);
});

test('double click places the top-left at the pointer, pushing right/down only when it would overlap', () => {
  const free = placeAtPointer(createNode('note'), [], { x: 120.5, y: 80 });
  assert.deepEqual(free.position, { x: 120.5, y: 80 });
  const existing = card('existing', 'note', 100, 60, { width: 290, height: 220 });
  const pushed = placeAtPointer(createNode('note'), [existing], { x: 150, y: 100 });
  assert.ok(pushed.position.x >= 150 && pushed.position.y >= 100);
  assert.ok(!overlaps(getCardBounds(pushed), getCardBounds(existing)));
});

test('a batch takes the top-left-most free area of the view that holds its whole row', () => {
  const region = { x: 0, y: 0, width: 1200, height: 700 };
  const left = card('left', 'note', 0, 0, { width: 400, height: 700 });
  const images = [1, 2].map(index => ({ ...createNode('image'), id: `pair-${index}`, style: { width: 290, height: 300 } }));
  const placed = placeBatchInView(images, [left], region);
  const boxes = placed.map(node => getCardBounds(node));
  assert.ok(boxes[0].x >= 400 + 32, 'starts right of the card and its gap');
  assert.equal(boxes[0].x % 32, 0); assert.equal(boxes[0].y, 0);
  assert.equal(boxes[1].y, boxes[0].y, 'one row');
  // CORE-04 (§5.4): pictures go in rows of 184 at their own ratio, 12 apart.
  assert.equal(boxes[0].height, 184);
  assert.ok(Math.abs(boxes[0].width / boxes[0].height - 290 / 300) < .02);
  assert.equal(boxes[1].x, boxes[0].x + boxes[0].width + 12);
});

test('a crowded view sends the batch to the nearest free space, and the reveal can then show all of it (1280×800)', () => {
  const smallSize = { width: 1026, height: 722 };
  const viewport = { x: 0, y: 0, zoom: .85 };
  const narrow = visibleFlowRect(viewport, smallSize, insets);
  const existing = [
    card('note', 'note', narrow.x + 420, narrow.y + 120, { width: 290, height: 230 }),
    card('draft', 'draft', narrow.x + 60, narrow.y + 140, { width: 340, height: 300 }),
    card('text', 'note', narrow.x + 760, narrow.y + 60, { width: 290, height: 420 }),
  ];
  const images = [1, 2, 3].map(index => ({ ...createNode('image'), id: `crowded-${index}` }));
  const boxes = placeBatchInView(images, existing, narrow).map(node => getCardBounds(node));
  for (const [index, box] of boxes.entries()) {
    for (const other of existing) assert.ok(!overlaps(box, getCardBounds(other)), `${index} clears ${other.id}`);
    for (const other of boxes.slice(0, index)) assert.ok(!overlaps(box, other));
  }
  assert.equal(new Set(boxes.map(box => box.y)).size, 1, 'the batch stays one row');
  const next = computeRevealViewport(unionRects(boxes)!, viewport, smallSize, insets);
  const after = next ?? viewport;
  assert.ok(after.zoom >= .5);
  assert.ok(rectContains(visibleFlowRect(after, smallSize, insets), unionRects(boxes)!), 'the whole batch is visible after the reveal');
});

test('importing three images lands every card inside the visible canvas, in a row, without overlaps (CV-B1)', () => {
  const existing = [card('demo-video', 'video', view.x + 40, view.y + 40, { width: 320, height: 368 })];
  const images = [1, 2, 3].map(index => ({ ...createNode('image'), id: `image-${index}`, style: { width: 290, height: 260 } }));
  const placed = placeBatchInView(images, existing, view);
  const boxes = placed.map(node => getCardBounds(node));
  for (const box of boxes) assert.ok(rectContains(view, box), `inside the visible canvas: ${JSON.stringify(box)}`);
  for (const [index, box] of boxes.entries()) {
    assert.ok(!overlaps(box, getCardBounds(existing[0]), 32));
    for (const other of boxes.slice(0, index)) assert.ok(!overlaps(box, other, 12 - 1e-9));
  }
  assert.ok(boxes[1].x > boxes[0].x && boxes[1].y === boxes[0].y, 'rows fill left to right');
  assert.ok(boxes.every(box => box.height === 184 && Math.abs(box.width / box.height - 290 / 260) < .02), 'a 184 row at the picture ratio');
  assert.equal(computeRevealViewport(unionRects(boxes)!, { x: 593, y: 411, zoom: 1 }, size, insets), null, 'no camera move is needed');
});

test('a batch larger than the view wraps into rows and the reveal can bring the whole batch into view', () => {
  const tasks = Array.from({ length: 8 }, (_, index) => ({ ...createNode('video'), id: `task-${index}`, style: { width: 320 } }));
  const placed = placeBatchInView(tasks, [], view);
  const boxes = placed.map(node => getCardBounds(node));
  for (const [index, box] of boxes.entries()) for (const other of boxes.slice(0, index)) assert.ok(!overlaps(box, other));
  const next = computeRevealViewport(unionRects(boxes)!, { x: 593, y: 411, zoom: 1 }, size, insets);
  assert.ok(next && next.zoom >= .5);
});

// polish1 gate: a new card never straddles a tray's edge (it read as neither in the group nor out of it).
const crossesTray = (box: { x: number; y: number; width: number; height: number }, tray: { x: number; y: number; width: number; height: number }) => {
  const outside = box.x >= tray.x + tray.width || box.x + box.width <= tray.x || box.y >= tray.y + tray.height || box.y + box.height <= tray.y - 30;
  const inside = box.x >= tray.x && box.y >= tray.y && box.x + box.width <= tray.x + tray.width && box.y + box.height <= tray.y + tray.height;
  return !outside && !inside;
};

test('imports keep off trays and their labels: a batch never lands across a group or inside it by accident', () => {
  const region = { x: 0, y: 0, width: 1400, height: 800 };
  const tray = card('tray', 'frame', 300, 120, { width: 520, height: 420 });
  const trayBox = getCardBounds(tray);
  const images = [1, 2, 3].map(index => ({ ...createNode('image'), id: `t-${index}`, style: { width: 290, height: 220 } }));
  for (const box of placeBatchInView(images, [tray], region).map(node => getCardBounds(node))) {
    assert.ok(!crossesTray(box, trayBox), `not across the tray: ${JSON.stringify(box)}`);
    assert.ok(!overlaps(box, { ...trayBox, y: trayBox.y - 30, height: trayBox.height + 30 }), 'not inside the tray or its label band either');
  }
  const single = placeBatchInView([{ ...createNode('image'), id: 'one', style: { width: 290, height: 220 } }], [tray], { x: 300, y: 100, width: 700, height: 500 })[0];
  assert.ok(!overlaps(getCardBounds(single), { ...trayBox, y: trayBox.y - 30, height: trayBox.height + 30 }), 'a single import keeps off the tray too');
});

test('a new note lands wholly inside a tray the view looks into, or wholly outside, never across its edge', () => {
  const big = card('big', 'frame', -400, -300, { width: 2000, height: 1400 });
  const inside = placeInView(createNode('note'), [big], { x: 0, y: 0, width: 1000, height: 700 });
  assert.ok(!crossesTray(getCardBounds(inside), getCardBounds(big)), 'inside the tray that fills the view');
  const half = card('half', 'frame', 450, 100, { width: 700, height: 500 });
  const note = placeInView(createNode('note'), [half], { x: 0, y: 0, width: 1200, height: 700 });
  assert.ok(!crossesTray(getCardBounds(note), getCardBounds(half)), `the tray across the centre is not straddled: ${JSON.stringify(getCardBounds(note))}`);
  const pointer = placeAtPointer(createNode('note'), [half], { x: 1000, y: 300 });
  assert.ok(!crossesTray(getCardBounds(pointer), getCardBounds(half)), 'a double click near the edge is pushed clear of it');
});

test('files dropped onto a tray land wholly inside it; dropped beside one, they keep off it', () => {
  const tray = card('tray', 'frame', 0, 0, { width: 1200, height: 700 });
  const region = { x: -200, y: -200, width: 1800, height: 1200 };
  const images = [1, 2].map(index => ({ ...createNode('image'), id: `d-${index}`, style: { width: 290, height: 220 } }));
  const into = placeBatchAtPoint(images, [tray], { x: 600, y: 350 }, region).map(node => getCardBounds(node));
  for (const box of into) assert.ok(rectContains(getCardBounds(tray), box), 'inside the tray aimed at');
  const beside = placeBatchAtPoint(images, [tray], { x: 1230, y: 350 }, region).map(node => getCardBounds(node));
  for (const box of beside) assert.ok(!crossesTray(box, getCardBounds(tray)), 'never across its edge');
});

test('new cards store no prompt copy (CD-M3): empty bodies, untitled draft', () => {
  for (const kind of ['video', 'image', 'note', 'quote', 'draft', 'link', 'frame'] as CardKind[]) {
    assert.equal(createNode(kind).data.body, '', `${kind} body`);
  }
  assert.equal(createNode('draft').data.title, '');
  assert.equal(createNode('image').data.tags, undefined);
});
