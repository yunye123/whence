import assert from 'node:assert/strict';
import test from 'node:test';
import { arrangeFrame, groupCards, moveIntoFrame, GROUP_WRAP, TRAY_GAP, TRAY_ROW_GAP, TRAY_PADDING, type FrameArrangementMode } from '../src/app/frame-layout';
import { frameContainsCard, rememberImageRatio } from '../src/card-placement';
import type { Board, BoardNode, CardKind } from '../src/model';

function card(id: string, kind: CardKind, x: number, y: number, width: number, height: number): BoardNode {
  return { id, type: 'card', position: { x, y }, data: { kind, title: id, body: '' }, style: { width, height } };
}
function board(nodes: BoardNode[]): Board {
  return { id: 'b', title: '测试', description: '', category: 'design', createdAt: '', updatedAt: '', nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
}
const overlaps = (a: BoardNode, b: BoardNode) => a.position.x < b.position.x + b.style!.width! && b.position.x < a.position.x + a.style!.width!
  && a.position.y < b.position.y + b.style!.height! && b.position.y < a.position.y + a.style!.height!;

test('Ctrl G wraps the selection with 16 on every side and puts the tray under every card', () => {
  const source = board([card('a', 'image', 100, 100, 200, 150), card('b', 'note', 340, 120, 180, 120), card('c', 'note', 900, 900, 180, 120)]);
  const { board: next, frameId } = groupCards(source, ['a', 'b']);
  assert.ok(frameId);
  const frame = next.nodes[0];
  assert.equal(frame.id, frameId);
  assert.equal(frame.data.kind, 'frame');
  assert.deepEqual(frame.position, { x: 100 - GROUP_WRAP, y: 100 - GROUP_WRAP });
  assert.deepEqual(frame.style, { width: 420 + GROUP_WRAP * 2, height: 150 + GROUP_WRAP * 2 });
  assert.ok(frameContainsCard(frame, next.nodes.find(node => node.id === 'a')!));
  assert.ok(frameContainsCard(frame, next.nodes.find(node => node.id === 'b')!));
  assert.ok(!frameContainsCard(frame, next.nodes.find(node => node.id === 'c')!));
  assert.equal(groupCards(source, []).board, source, 'nothing selected: unchanged');
});

for (const mode of ['rows', 'grid', 'masonry'] as FrameArrangementMode[]) {
  test(`arranging a tray (${mode}) keeps ratios, never overlaps, and the tray wraps every card`, () => {
    const frame = card('f', 'frame', 0, 0, 752, 700);
    const images = [
      card('i1', 'image', 30, 30, 210, 90), card('i2', 'image', 260, 30, 160, 90), card('i3', 'image', 450, 30, 90, 120),
      card('i4', 'image', 30, 200, 120, 120), card('i5', 'image', 200, 200, 213, 120), card('i6', 'image', 450, 200, 96, 120),
    ];
    const outside = card('o', 'note', 900, 0, 200, 100);
    const source = board([frame, ...images, outside]);
    const next = arrangeFrame(source, 'f', mode);
    assert.notEqual(next, source);
    const tray = next.nodes.find(node => node.id === 'f')!;
    assert.equal(tray.style!.width, 752, 'the tray keeps its width');
    const placed = next.nodes.filter(node => node.id.startsWith('i'));
    for (const node of placed) {
      assert.ok(frameContainsCard(tray, node), `${node.id} stays inside the tray`);
      assert.ok(node.position.x >= TRAY_PADDING && node.position.y >= TRAY_PADDING);
      assert.ok(Number.isInteger(node.position.x) && Number.isInteger(node.position.y) && Number.isInteger(node.style!.width) && Number.isInteger(node.style!.height));
      const before = images.find(image => image.id === node.id)!;
      const ratio = before.style!.width! / before.style!.height!;
      assert.ok(Math.abs(node.style!.width! / node.style!.height! - ratio) / ratio < .06, `${node.id} keeps its ratio`);
    }
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.ok(!overlaps(placed[i], placed[j]), `${placed[i].id} / ${placed[j].id}`);
    const bottom = Math.max(...placed.map(node => node.position.y + node.style!.height!));
    assert.equal(tray.style!.height, bottom + TRAY_PADDING, 'the tray ends 16 below its lowest card');
    assert.deepEqual(next.nodes.find(node => node.id === 'o'), outside, 'cards outside the tray do not move');
    assert.equal(arrangeFrame(next, 'f', mode), next, 'arranging twice changes nothing');
  });
}

test('rows fill the tray width except the last row, with a 6px column gap and 22px row gap', () => {
  const frame = card('f', 'frame', 0, 0, 752, 400);
  const images = Array.from({ length: 5 }, (_, index) => card(`i${index}`, 'image', 20 + index * 140, 20, 160, 90));
  const next = arrangeFrame(board([frame, ...images]), 'f', 'rows');
  const placed = next.nodes.filter(node => node.id.startsWith('i'));
  const firstRow = placed.filter(node => node.position.y === TRAY_PADDING);
  assert.ok(firstRow.length >= 2);
  const right = Math.max(...firstRow.map(node => node.position.x + node.style!.width!));
  assert.equal(right, 752 - TRAY_PADDING);
  const sorted = [...firstRow].sort((a, b) => a.position.x - b.position.x);
  for (let i = 1; i < sorted.length; i++) assert.equal(sorted[i].position.x - (sorted[i - 1].position.x + sorted[i - 1].style!.width!), TRAY_GAP);
  assert.equal(TRAY_GAP, 6);
  assert.equal(TRAY_ROW_GAP, 22);
  const tops = [...new Set(placed.map(n => n.position.y))].sort((a, b) => a - b);
  assert.ok(tops.length >= 2);
  for (let i = 1; i < tops.length; i++) {
    const bottom = Math.max(...placed.filter(n => n.position.y === tops[i - 1]).map(n => n.position.y + n.style!.height!));
    assert.equal(tops[i] - bottom, 22);
  }
});

for (const mode of ['rows', 'grid', 'masonry'] as FrameArrangementMode[]) test(`v2 ${mode}: preserve source and identity outside the action, integer rows with ≥22px vertical air`, () => {
  const photos = Array.from({ length: 8 }, (_, i) => card(`v2-${i}`, 'image', 16 + (i % 3) * 210, 16 + Math.floor(i / 3) * 140, 200, 120));
  const source = board([card('v2-frame', 'frame', 0, 0, 752, 750), ...photos, card('outside', 'note', 1000, 0, 180, 120)]);
  const before = JSON.stringify(source), result = arrangeFrame(source, 'v2-frame', mode);
  assert.equal(JSON.stringify(source), before, 'a single history checkpoint can restore the exact source');
  assert.equal(result.edges, source.edges);
  assert.equal(result.nodes.find(n => n.id === 'outside'), source.nodes.find(n => n.id === 'outside'));
  assert.deepEqual(result.nodes.map(n => n.data), source.nodes.map(n => n.data), 'no display numbers or flags written to data');
  const placed = result.nodes.filter(n => n.id.startsWith('v2-') && n.data.kind === 'image');
  for (const a of placed) for (const b of placed) {
    if (a.id === b.id || a.position.y + a.style!.height! > b.position.y) continue;
    if (a.position.x < b.position.x + b.style!.width! && a.position.x + a.style!.width! > b.position.x)
      assert.ok(b.position.y - (a.position.y + a.style!.height!) >= 22);
  }
  assert.equal(arrangeFrame(result, 'v2-frame', mode), result, 'idempotent action does not consume another undo');
});

test('an empty or missing tray is left alone', () => {
  const source = board([card('f', 'frame', 0, 0, 400, 300), card('o', 'image', 900, 0, 100, 100)]);
  assert.equal(arrangeFrame(source, 'f', 'rows'), source);
  assert.equal(arrangeFrame(source, 'missing', 'grid'), source);
});

test('adding a picture to a tray puts it inside and grows the tray', () => {
  const frame = card('f', 'frame', 0, 0, 500, 160);
  const inside = card('a', 'image', 16, 16, 200, 128);
  const picture = card('p', 'image', 900, 900, 400, 300);
  const next = moveIntoFrame(board([frame, inside, picture]), 'p', 'f');
  const tray = next.nodes.find(node => node.id === 'f')!;
  const moved = next.nodes.find(node => node.id === 'p')!;
  assert.ok(frameContainsCard(tray, moved));
  assert.ok(!overlaps(moved, next.nodes.find(node => node.id === 'a')!));
  assert.ok(Math.abs(moved.style!.width! / moved.style!.height! - 4 / 3) < .03);
  assert.equal(moveIntoFrame(next, 'p', 'f'), next, 'already inside: unchanged');
});

// ── polish round 1 (CORE-02, CORE-03, CORE-27) ─────────────────────────────

const picture = (id: string, x: number, y: number, width: number, height: number, natural?: [number, number]): BoardNode => {
  const node = card(id, 'image', x, y, width, height);
  node.data.mediaId = `m-${id}`;
  if (natural) rememberImageRatio(`media:m-${id}`, natural[0], natural[1]);
  return node;
};
const LABEL_BAND = 30;

test('CORE-02: a tray that grows when a picture joins it pushes the tray below down, label and pictures together', () => {
  const upper = card('up', 'frame', 0, 0, 760, 410);
  const lower = card('low', 'frame', 0, 474, 760, 300);
  const upperPictures = [picture('u1', 16, 16, 300, 200), picture('u2', 328, 16, 300, 200), picture('u3', 16, 228, 300, 166)];
  const lowerPictures = [picture('l1', 16, 490, 260, 180), picture('l2', 288, 490, 260, 180)];
  const side = card('side', 'note', 900, 520, 200, 120);
  const tall = picture('tall', 1200, 0, 120, 360, [300, 900]);
  const source = board([upper, lower, ...upperPictures, ...lowerPictures, side, tall]);
  const next = moveIntoFrame(source, 'tall', 'up');
  const get = (id: string) => next.nodes.find(node => node.id === id)!;
  const grownUpper = get('up'), pushedLower = get('low');
  assert.ok(frameContainsCard(grownUpper, get('tall')));
  assert.ok(grownUpper.style!.height! > 410, 'the tray grew');
  const shift = pushedLower.position.y - 474;
  assert.ok(shift > 0, 'the tray below moved down');
  assert.ok(grownUpper.position.y + grownUpper.style!.height! + 32 + LABEL_BAND <= pushedLower.position.y, 'the lower label band stays clear, 32 below the grown tray');
  for (const id of ['l1', 'l2']) {
    assert.equal(get(id).position.y, source.nodes.find(node => node.id === id)!.position.y + shift, `${id} moved with its tray`);
    assert.ok(frameContainsCard(pushedLower, get(id)));
  }
  assert.deepEqual(get('side'), side, 'a card beside the tray (no horizontal overlap) stays');
  for (const id of ['u1', 'u2', 'u3']) assert.deepEqual(get(id), source.nodes.find(node => node.id === id), 'pictures already in the tray stay');
});

test('CORE-03: rows keep every picture at its own ratio, never squeeze one under 80 wide, and switching modes never crops', () => {
  const naturals: [number, number][] = [[540, 960], [300, 900], [1280, 720], [900, 600], [1600, 400], [3200, 900], [800, 800], [600, 800], [1200, 900], [720, 1280], [1000, 1500], [1920, 1080]];
  const frame = card('f', 'frame', 0, 0, 966, 900);
  // Stored boxes: the 290-wide import cards, some already cropped by an earlier layout.
  const pictures = naturals.map((size, index) => picture(`p${index}`, 16 + (index % 3) * 310, 16 + Math.floor(index / 3) * 220, 290, 200, size));
  let current = board([frame, ...pictures]);
  for (const mode of ['rows', 'grid', 'masonry', 'rows'] as FrameArrangementMode[]) {
    current = arrangeFrame(current, 'f', mode);
    const placed = current.nodes.filter(node => node.id.startsWith('p'));
    const tray = current.nodes.find(node => node.id === 'f')!;
    placed.forEach(node => {
      const [w, h] = naturals[Number(node.id.slice(1))];
      const ratio = Math.min(4, Math.max(.25, w / h));
      assert.ok(Math.abs(node.style!.width! / node.style!.height! - ratio) / ratio < .03, `${mode}: ${node.id} keeps its picture's ratio`);
      assert.ok(node.style!.width! >= 80 && node.style!.height! >= 60, `${mode}: ${node.id} not under the image minimum`);
      assert.ok(frameContainsCard(tray, node), `${mode}: ${node.id} inside`);
    });
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.ok(!overlaps(placed[i], placed[j]), `${mode}: ${placed[i].id} / ${placed[j].id}`);
    if (mode === 'rows') {
      const rows = [...new Set(placed.map(node => node.position.y))].map(y => placed.find(node => node.position.y === y)!.style!.height!);
      assert.ok(rows.slice(0, -1).every(height => height >= 150 && height <= 340), `${mode}: row heights ${rows.join('/')}`);
    }
  }
});

test('CORE-27: the grid gives every picture an equal 4:3 cell, contained and centred; a wide picture spans two cells', () => {
  const frame = card('f', 'frame', 0, 0, 966, 900);
  const naturals: [number, number][] = [[1600, 400], [900, 1200], [1200, 900], [800, 800], [1920, 1080], [600, 800]];
  const pictures = naturals.map((size, index) => picture(`g${index}`, 16 + index * 150, 16, 140, 100, size));
  const next = arrangeFrame(board([frame, ...pictures]), 'f', 'grid');
  const placed = next.nodes.filter(node => node.id.startsWith('g'));
  const rowTops = new Map<number, number[]>();
  for (const node of placed) {
    const centre = node.position.y + node.style!.height! / 2;
    const key = [...rowTops.keys()].find(y => Math.abs(y - centre) < 2) ?? centre;
    rowTops.set(key, [...(rowTops.get(key) ?? []), node.id.length]);
  }
  assert.ok(rowTops.size < placed.length, 'cards in a row share one centre line');
  const single = placed.filter(node => node.id !== 'g0');
  const widths = single.map(node => node.style!.width!), heights = single.map(node => node.style!.height!);
  const cellWidth = Math.max(...widths), cellHeight = Math.max(...heights);
  assert.ok(Math.abs(cellHeight / cellWidth - .75) < .02, 'cells are 4:3');
  for (const node of single) assert.ok(node.style!.width! === cellWidth || node.style!.height! === cellHeight, `${node.id} touches its cell on one axis (contain)`);
  // polish1 gate: the 4:1 banner is no longer a thin strip in a box of air.
  const banner = placed.find(node => node.id === 'g0')!;
  assert.ok(banner.style!.width! > cellWidth * 1.5 && banner.style!.width! <= cellWidth * 2 + TRAY_GAP, `the 4:1 picture spans two cells (${banner.style!.width} vs cell ${cellWidth})`);
  assert.ok(banner.style!.height! <= cellHeight);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.ok(!overlaps(placed[i], placed[j]), `${placed[i].id} / ${placed[j].id}`);
  const tray = next.nodes.find(node => node.id === 'f')!;
  for (const node of placed) assert.ok(frameContainsCard(tray, node), `${node.id} inside`);
  for (const node of placed) assert.ok(Number.isInteger(node.position.x) && Number.isInteger(node.position.y) && Number.isInteger(node.style!.width) && Number.isInteger(node.style!.height));
});

test('polish1 gate: a narrow picture joining a tray of justified rows is justified in with them, not left alone in a last row', () => {
  const naturals: [number, number][] = [[1200, 900], [1200, 900], [1200, 900], [1600, 900], [1200, 900], [900, 900], [1200, 900], [1600, 900], [1200, 900]];
  const frame = card('f', 'frame', 0, 0, 1000, 900);
  let current = board([frame, ...naturals.map((size, index) => picture(`s${index}`, 16 + (index % 3) * 320, 16 + Math.floor(index / 3) * 250, 300, 225, size)), picture('narrow', 1400, 0, 100, 300, [300, 900]), card('below', 'frame', 0, 1100, 1000, 300)]);
  current = arrangeFrame(current, 'f', 'rows');
  const before = current.nodes.find(node => node.id === 'f')!;
  const next = moveIntoFrame(current, 'narrow', 'f');
  const tray = next.nodes.find(node => node.id === 'f')!;
  const members = next.nodes.filter(node => node.id.startsWith('s') || node.id === 'narrow');
  for (const node of members) assert.ok(frameContainsCard(tray, node), `${node.id} inside`);
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) assert.ok(!overlaps(members[i], members[j]), `${members[i].id} / ${members[j].id}`);
  const narrow = next.nodes.find(node => node.id === 'narrow')!;
  const sameRow = members.filter(node => node.id !== 'narrow' && node.position.y === narrow.position.y);
  assert.ok(sameRow.length >= 1, 'the narrow picture shares its row with other pictures');
  const rowRight = Math.max(...[narrow, ...sameRow].map(node => node.position.x + node.style!.width!));
  assert.equal(rowRight, 1000 - TRAY_PADDING, 'its row is justified to the tray width (no field of air beside it)');
  assert.ok(Math.abs(narrow.style!.width! / narrow.style!.height! - 1 / 3) < .03 && narrow.style!.width! >= 80, 'it keeps its ratio and its minimum width');
  const bottom = Math.max(...members.map(node => node.position.y + node.style!.height!));
  assert.equal(tray.style!.height, bottom + TRAY_PADDING, 'the tray wraps the rows exactly');
  assert.equal(tray.style!.width, before.style!.width, 'the tray keeps its width');
  const below = next.nodes.find(node => node.id === 'below')!;
  assert.ok(tray.position.y + tray.style!.height! + LABEL_BAND <= below.position.y, 'the tray below and its label stay clear');
  for (const node of members) assert.ok(Number.isInteger(node.position.x) && Number.isInteger(node.position.y) && Number.isInteger(node.style!.width) && Number.isInteger(node.style!.height));
});

test('a tray arranged by hand keeps its cards where they are when a picture joins it', () => {
  const frame = card('f', 'frame', 0, 0, 760, 300);
  const loose = [picture('h1', 40, 40, 200, 150), picture('h2', 300, 60, 180, 120)];
  const next = moveIntoFrame(board([frame, ...loose, picture('new', 1200, 0, 200, 150)]), 'new', 'f');
  for (const node of loose) assert.deepEqual(next.nodes.find(item => item.id === node.id), node);
  assert.ok(frameContainsCard(next.nodes.find(node => node.id === 'f')!, next.nodes.find(node => node.id === 'new')!));
});

test('CORE-02: arranging the same tray again does not keep pushing the trays below further away', () => {
  const upper = card('up', 'frame', 0, 0, 760, 300);
  const lower = card('low', 'frame', 0, 400, 760, 300);
  const pictures = [picture('a', 16, 16, 300, 200, [300, 900]), picture('b', 330, 16, 300, 200, [1600, 900]), picture('c', 16, 420, 300, 200)];
  let current = board([upper, lower, ...pictures]);
  const positions: number[] = [];
  for (const mode of ['rows', 'grid', 'rows', 'grid', 'rows'] as FrameArrangementMode[]) {
    current = arrangeFrame(current, 'up', mode);
    const up = current.nodes.find(node => node.id === 'up')!, low = current.nodes.find(node => node.id === 'low')!;
    assert.ok(up.position.y + up.style!.height! + LABEL_BAND <= low.position.y, `${mode}: no overlap with the label below`);
    positions.push(low.position.y);
  }
  assert.equal(positions[4], positions[2], 'the third and fifth arrangement leave the tray below where it was');
});
