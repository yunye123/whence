import assert from 'node:assert/strict';
import test from 'node:test';
import { computeSelectionToolsPlacement, selectionGeometry, HUD_CLEARANCE, HUD_WEIGHT, SELECTION_WEIGHT, TITLE_WEIGHT } from '../src/CanvasSelectionTools';
import { createNode } from '../src/board-utils';

// §6.6 / CV-B2: the bar is anchored to the selection's bounding box, never fixed to the canvas top.
const bar = { width: 200, height: 40 };
const canvas = { width: 1200, height: 800 };
const insets = { top: 0, bottom: 88 };
const card = (x: number, y: number, width = 280, height = 200) => ({ x, y, width, height, title: 56 });

test('sits 10px above the selection, centred, with the arrow at the box centre', () => {
  const placement = computeSelectionToolsPlacement({ selection: { x: 400, y: 300, width: 280, height: 200 }, obstacles: [], bar, canvas, insets });
  assert.equal(placement.side, 'above');
  assert.equal(placement.top, 300 - 10 - 40);
  assert.equal(placement.left, 440);
  assert.equal(placement.arrowX, 100);
});

test('flips below when there is less than 8px above the selection', () => {
  const placement = computeSelectionToolsPlacement({ selection: { x: 400, y: 30, width: 280, height: 200 }, obstacles: [], bar, canvas, insets });
  assert.equal(placement.side, 'below');
  assert.equal(placement.top, 30 + 200 + 10);
});

test('flips below when above would cover another card and below is free', () => {
  const selection = { x: 400, y: 300, width: 280, height: 200 };
  const above = card(400, 60, 280, 220); // bottom edge 20px above the selection
  const placement = computeSelectionToolsPlacement({ selection, obstacles: [above], bar, canvas, insets });
  assert.equal(placement.side, 'below');
});

test('slides aside rather than covering a neighbour’s title', () => {
  const selection = { x: 400, y: 300, width: 280, height: 200 };
  // A title band sits right above the centred position, and below has no room at all.
  const neighbour = card(560, 220, 280, 70);
  const placement = computeSelectionToolsPlacement({ selection, obstacles: [neighbour], bar, canvas: { width: 1200, height: 540 }, insets: { top: 0, bottom: 60 } });
  assert.equal(placement.side, 'above');
  assert.ok(placement.left + bar.width <= 560, `slid left of the neighbour (left ${placement.left})`);
  assert.ok(placement.arrowX >= 16 && placement.arrowX <= bar.width - 16, 'arrow still points into the selection');
});

test('a title that cannot be cleared with a centred arrow: the arrow moves off-centre (still inside the selection)', () => {
  const selection = { x: 400, y: 300, width: 280, height: 200 };
  const title = card(500, 220, 280, 70);
  const placement = computeSelectionToolsPlacement({ selection, obstacles: [title], bar, canvas: { width: 1200, height: 560 }, insets: { top: 0, bottom: 60 } });
  assert.equal(placement.side, 'above', 'stays out of the bottom safe area');
  assert.ok(placement.left + bar.width <= 500, 'the neighbour title stays visible');
  const arrow = placement.left + placement.arrowX;
  assert.ok(arrow >= selection.x + 16 && arrow <= selection.x + selection.width - 16, 'the arrow still points into the selection');
});

test('enters the empty bottom safe area only when that keeps a title uncovered', () => {
  const selection = { x: 400, y: 300, width: 120, height: 200 };
  // Title bands on both sides above: no position above clears them while the bar overlaps the selection.
  const titles = [card(200, 220, 360, 70), card(380, 200, 360, 90)];
  const body = { x: 380, y: 100, width: 160, height: 190 }; // a card body edge only (no title band in reach)
  const canvasShort = { width: 1200, height: 560 };
  assert.equal(computeSelectionToolsPlacement({ selection, obstacles: titles, bar, canvas: canvasShort, insets: { top: 0, bottom: 60 } }).side, 'below');
  assert.equal(computeSelectionToolsPlacement({ selection, obstacles: [body], bar, canvas: canvasShort, insets: { top: 0, bottom: 60 } }).side, 'above');
});

test('never covers a HUD island while another place exists, and is clamped 8px inside the canvas', () => {
  const selection = { x: 1100, y: 600, width: 90, height: 60 };
  const navigator = { x: 900, y: 700, width: 284, height: 84, weight: HUD_WEIGHT };
  const placement = computeSelectionToolsPlacement({ selection, obstacles: [navigator], bar, canvas, insets });
  assert.equal(placement.side, 'above');
  assert.equal(placement.left, canvas.width - bar.width - 8);
});

test('hides when the selection is scrolled out of the canvas', () => {
  const placement = computeSelectionToolsPlacement({ selection: { x: 400, y: -500, width: 280, height: 200 }, obstacles: [], bar, canvas, insets });
  assert.equal(placement.side, 'hidden');
});

test('a selection taller than the canvas pins the bar instead of covering the top of the selection', () => {
  const placement = computeSelectionToolsPlacement({ selection: { x: 400, y: 20, width: 280, height: 900 }, obstacles: [], bar, canvas, insets });
  assert.equal(placement.side, 'pinned');
  assert.ok(placement.top > 20 + 56, 'pinned below the selection’s title band');
});

test('geometry: multi-selection uses the union box; trays are ground, their label band is an obstacle', () => {
  const a = { ...createNode('note'), position: { x: 0, y: 0 }, style: { width: 200, height: 100 } };
  const b = { ...createNode('note'), position: { x: 400, y: 200 }, style: { width: 200, height: 100 } };
  const frame = { ...createNode('frame'), position: { x: -50, y: -50 }, style: { width: 800, height: 500 } };
  const other = { ...createNode('image'), position: { x: 700, y: 0 }, style: { width: 100, height: 100 } };
  const { selection, obstacles } = selectionGeometry([frame, a, b, other], [a.id, b.id]);
  assert.deepEqual(selection, { x: 0, y: 0, width: 600, height: 300 });
  assert.equal(obstacles.length, 2);
  const label = obstacles.find(item => item.y < -50);
  assert.ok(label && label.height <= 64, 'only the frame label band, not the whole tray');
});

// CHROME-02: a selection that fills the safe area (after “查看全部”, a grouped import) never puts the bar on the HUD.
const hit = (bar: { left: number; top: number }, size: { width: number; height: number }, rect: { x: number; y: number; width: number; height: number }, gap = 0) =>
  Math.min(bar.left + size.width, rect.x + rect.width) - Math.max(bar.left, rect.x) > -gap && Math.min(bar.top + size.height, rect.y + rect.height) - Math.max(bar.top, rect.y) > -gap;

test('a selection as tall as the safe area pins the bar inside it, clear of the toolbar and the navigator', () => {
  const view = { width: 1126, height: 720 };
  const toolbar = { x: 413, y: 656, width: 300, height: 48, weight: HUD_WEIGHT };
  const navigator = { x: 830, y: 664, width: 280, height: 40, weight: HUD_WEIGHT };
  const wide = { width: 420, height: 40 };
  const selection = { x: 200, y: 24, width: 700, height: 720 - 24 - 88 };
  const placement = computeSelectionToolsPlacement({ selection, obstacles: [toolbar, navigator], bar: wide, canvas: view, insets: { top: 0, bottom: 88 } });
  assert.equal(placement.side, 'pinned');
  assert.ok(!hit(placement, wide, toolbar, HUD_CLEARANCE) && !hit(placement, wide, navigator, HUD_CLEARANCE), `clear of the HUD (top ${placement.top})`);
  assert.ok(placement.top + wide.height <= view.height - 88, 'above the bottom safe area');
  assert.ok(placement.top > selection.y + 56, 'the top of the selection (its titles) stays visible');
});

test('“below” never lands within the HUD clearance: 4px above the toolbar is not a place', () => {
  const view = { width: 1600, height: 1000 };
  const toolbar = { x: 650, y: 936, width: 300, height: 48, weight: HUD_WEIGHT };
  // Above is blocked by the top edge; directly below would end 4px above the toolbar.
  const selection = { x: 600, y: 20, width: 400, height: 935 - 4 - 40 - 10 - 20 };
  const placement = computeSelectionToolsPlacement({ selection, obstacles: [toolbar], bar, canvas: view, insets: { top: 0, bottom: 88 } });
  assert.ok(!hit(placement, bar, toolbar, HUD_CLEARANCE), `kept ${HUD_CLEARANCE}px from the toolbar (side ${placement.side}, top ${placement.top})`);
});

test('a selection whose top is scrolled out of view pins the bar at the top edge, not on the toolbar', () => {
  const toolbar = { x: 500, y: 736, width: 300, height: 48, weight: HUD_WEIGHT };
  const placement = computeSelectionToolsPlacement({ selection: { x: 300, y: -300, width: 700, height: 1200 }, obstacles: [toolbar], bar, canvas, insets: { top: 0, bottom: 88 } });
  assert.equal(placement.side, 'pinned');
  assert.equal(placement.top, 8);
});

// CHROME-06: thread labels and tray labels are text; the bar slides or flips instead of covering them.
test('a thread label right above the selection makes the bar slide aside or flip, never cover it', () => {
  const selection = { x: 400, y: 300, width: 280, height: 200 };
  const label = { x: 470, y: 236, width: 120, height: 40, title: 40 }; // already inflated by the clearance
  const placement = computeSelectionToolsPlacement({ selection, obstacles: [label], bar, canvas, insets });
  const box = placement.side === 'below' ? { left: placement.left, top: placement.top - 7 } : placement;
  assert.ok(!hit(box, { width: bar.width, height: bar.height + 7 }, label), `label uncovered (side ${placement.side}, left ${placement.left})`);
  assert.ok(TITLE_WEIGHT > 1);
});

// polish1 remainder (dark 1366×768, 12 pictures imported): the batch fills the view above a tray whose label hangs on the
// toolbar line. Above has no room, every place below covers that label: the bar moves inside the selection instead.
test('a large selection whose only outside places cover a label holds the bar inside, clear of the HUD', () => {
  const view = { width: 1126, height: 712 };
  const toolbar = { x: 436, y: 648, width: 254, height: 48, weight: HUD_WEIGHT };
  const navigator = { x: 875, y: 656, width: 235, height: 40, weight: HUD_WEIGHT };
  const trayLabel = { x: 167, y: 647, width: 146, height: 44, title: 44 }; // measured label, clearance included
  const wide = { width: 390, height: 40 };
  const selection = { x: 72, y: 8, width: 983, height: 623 };
  const placement = computeSelectionToolsPlacement({ selection, obstacles: [toolbar, navigator, trayLabel], bar: wide, canvas: view, insets: { top: 0, bottom: 88 } });
  assert.equal(placement.side, 'pinned');
  assert.ok(!hit(placement, wide, trayLabel), 'the tray label stays readable');
  assert.ok(!hit(placement, wide, toolbar, HUD_CLEARANCE) && !hit(placement, wide, navigator, HUD_CLEARANCE), 'clear of the HUD');
  assert.ok(placement.left >= selection.x && placement.left + wide.width <= selection.x + selection.width, 'inside the selection');
  assert.ok(placement.top + wide.height <= view.height - 88, 'above the bottom safe area');
});

test('the same selection with nothing under it keeps the bar outside (pinning costs more than the empty safe area)', () => {
  const view = { width: 1126, height: 712 };
  const toolbar = { x: 436, y: 648, width: 254, height: 48, weight: HUD_WEIGHT };
  const wide = { width: 390, height: 40 };
  const selection = { x: 72, y: 8, width: 983, height: 623 };
  const placement = computeSelectionToolsPlacement({ selection, obstacles: [toolbar], bar: wide, canvas: view, insets: { top: 0, bottom: 88 } });
  assert.equal(placement.side, 'below');
  assert.ok(SELECTION_WEIGHT > 2 && SELECTION_WEIGHT < TITLE_WEIGHT);
});

test('a small selection is never covered by its own bar, even when every outside place costs something', () => {
  const selection = { x: 400, y: 300, width: 220, height: 200 };
  const titles = [card(200, 220, 360, 70), card(380, 200, 360, 90)];
  const placement = computeSelectionToolsPlacement({ selection, obstacles: titles, bar, canvas: { width: 1200, height: 560 }, insets: { top: 0, bottom: 60 } });
  assert.notEqual(placement.side, 'pinned');
});

// polish round 4 (P8): 12 pictures imported at dark 1366×768 — the camera fits the batch to the safe area, so there is no
// room above or below and the bar goes inside. It hides what matters least of the selection: for pictures (no title
// band) a strip of the first row at the top of the canvas, not a band of the last row; for notes the bottom, under the
// titles.
const importView = { width: 1126, height: 720 };
const importToolbar = { x: 436, y: 656, width: 254, height: 48, weight: HUD_WEIGHT };
const importNavigator = { x: 875, y: 664, width: 235, height: 40, weight: HUD_WEIGHT };
const importTrayLabel = { x: 170, y: 652, width: 144, height: 42, title: 42 }; // “清晨的街 9 张” under the batch, clearance included
const importBar = { width: 390, height: 40 };
const importSelection = { x: 76, y: 22, width: 974, height: 610 };
const rowsOf = (title?: number) => [0, 1, 2, 3].flatMap(row => [0, 1, 2].map(column => ({ x: 76 + column * 330, y: 22 + row * 155, width: 314, height: 145, ...(title ? { title } : {}) })));

test('a batch of pictures that fills the view holds the bar at the top of the canvas, over the least of its first row', () => {
  const placement = computeSelectionToolsPlacement({ selection: importSelection, members: rowsOf(), obstacles: [importToolbar, importNavigator, importTrayLabel], bar: importBar, canvas: importView, insets: { top: 0, bottom: 88 } });
  assert.equal(placement.side, 'pinned');
  assert.equal(placement.top, 8, 'hugs the top of the canvas');
  assert.ok(placement.top + importBar.height - importSelection.y <= 26, `covers at most 26px of the first row (top ${placement.top})`);
  assert.ok(!hit(placement, importBar, importToolbar, HUD_CLEARANCE) && !hit(placement, importBar, importNavigator, HUD_CLEARANCE));
});

test('the same batch of notes keeps their titles: the bar goes to the bottom row, above the safe area', () => {
  const placement = computeSelectionToolsPlacement({ selection: importSelection, members: rowsOf(56), obstacles: [importToolbar, importNavigator, importTrayLabel], bar: importBar, canvas: importView, insets: { top: 0, bottom: 88 } });
  assert.equal(placement.side, 'pinned');
  assert.ok(placement.top > importSelection.y + 56 && placement.top + importBar.height <= importView.height - 88, `bottom row (top ${placement.top})`);
});

test('geometry: pictures carry no title band, other cards do, a selected tray only its label', () => {
  const picture = { ...createNode('image'), position: { x: 0, y: 0 }, style: { width: 200, height: 120 } };
  const note = { ...createNode('note'), position: { x: 300, y: 0 }, style: { width: 200, height: 120 } };
  const tray = { ...createNode('frame'), position: { x: 0, y: 400 }, style: { width: 600, height: 300 } };
  const { members } = selectionGeometry([picture, note, tray], [picture.id, note.id, tray.id]);
  assert.equal(members[0].title, undefined);
  assert.equal(members[1].title, 56);
  assert.deepEqual({ y: members[2].y, height: members[2].height, title: members[2].title }, { y: 374, height: 26, title: 26 });
});

test('a short first row leaves an empty stretch of the box: the bar sits there, hiding nothing, before it goes to the HUD row', () => {
  const view = { width: 1200, height: 852 };
  const toolbar = { x: 471, y: 788, width: 256, height: 48, weight: HUD_WEIGHT };
  const navigator = { x: 949, y: 796, width: 235, height: 40, weight: HUD_WEIGHT };
  const selection = { x: 60, y: 22, width: 1084, height: 748 };
  const members = [
    { x: 60, y: 22, width: 620, height: 180 },          // first row: three pictures, 620 wide
    { x: 60, y: 210, width: 1084, height: 560 },        // the rest, full width
  ];
  const placement = computeSelectionToolsPlacement({ selection, members, obstacles: [toolbar, navigator], bar: importBar, canvas: view, insets: { top: 0, bottom: 88 } });
  assert.equal(placement.side, 'pinned');
  assert.ok(placement.left >= 680 && placement.top + importBar.height <= 210, `beside the first row (left ${placement.left}, top ${placement.top})`);
  const nothingThere = computeSelectionToolsPlacement({ selection, members: [{ ...selection }], obstacles: [toolbar, navigator], bar: importBar, canvas: view, insets: { top: 0, bottom: 88 } });
  assert.equal(nothingThere.side, 'below', 'with no empty stretch the empty safe area still costs less than hiding pictures');
});
