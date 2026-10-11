import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../src/storage';
import { createExampleBoard } from '../src/templates';
import type { Board, BoardNode } from '../src/model';
import { boxesIntersect, chooseSide, cubicAt, threadCurve, dropCurve, type Box } from '../src/canvas/edges/geometry';
import { edgeGeometry, footnoteY, SPEC } from '../src/canvas/edges/anchors';
import { estimateTextWidth, labelSize, LABEL_HEIGHT, placeLabels } from '../src/canvas/edges/labels';
import { computeEdgeLayout, labelScaleForZoom, labelTether, lodForZoom, type LayoutNode } from '../src/canvas/edges/layout';
import { fieldEdgeRecords } from '../src/canvas/edges/model';

/** Card heights from the DESIGN_SYSTEM §6.9–6.14 type specs (same estimate as tests/example-templates.test.ts). */
function estimatedHeight(node: BoardNode): number {
  if (node.style?.height) return node.style.height;
  const lines = (text: string, perLine: number) => text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).length / perLine)), 0);
  const width = node.style?.width ?? 290;
  switch (node.data.kind) {
    case 'video': return Math.round(width * 9 / 16) + 90;
    case 'quote': return 40 + 25 * lines(node.data.citation?.text ?? node.data.body ?? '', 16) + (node.data.citation && node.data.body ? 23 + 25 * lines(node.data.body, 15) : 0) + 14;
    case 'draft': return 420;
    case 'link': return 120;
    case 'note': return node.data.tags?.includes('文字资料') ? 170 : 28 + 27 * lines(node.data.body, Math.floor((width - 32) / 16));
    case 'image': return Math.round(width * 0.66);
    default: return 200;
  }
}

function layoutNodes(board: Board, heights: (node: BoardNode) => number = estimatedHeight): LayoutNode[] {
  return board.nodes.map(node => ({
    id: node.id, kind: node.data.kind, frame: node.data.kind === 'frame', versions: node.data.draftVersions?.length ?? 0,
    box: { x: node.position.x, y: node.position.y, width: node.style?.width ?? 290, height: heights(node) },
  }));
}

function assertLabelsClear(board: Board, nodes: LayoutNode[], scale = 1) {
  const layout = computeEdgeLayout(nodes, fieldEdgeRecords(board), scale);
  const labels = [...layout.labels.values()];
  for (const label of labels) {
    assert.ok(label.clean, `${label.text} found a free spot`);
    for (const node of nodes) assert.ok(!boxesIntersect(label.box, node.box), `${label.text} overlaps ${board.nodes.find(item => item.id === node.id)?.data.title}`);
  }
  for (const [index, a] of labels.entries()) for (const b of labels.slice(index + 1)) assert.ok(!boxesIntersect(a.box, b.box), `${a.text} × ${b.text}`);
  return layout;
}

test('thread curves follow the §6.17 formula: horizontal ends, a sag in the middle, vertical when stacked', () => {
  const curve = threadCurve({ x: 0, y: 0 }, 'right', { x: 200, y: 40 }, 'left');
  const k = 200 * 0.42, sag = Math.min(26, Math.hypot(200, 40) * 0.14);
  assert.deepEqual(curve.c1, { x: k, y: sag });
  assert.deepEqual(curve.c2, { x: 200 - k, y: 40 + sag });
  const short = threadCurve({ x: 0, y: 0 }, 'right', { x: 20, y: 0 }, 'left');
  assert.equal(short.c1.x, 18, 'k never drops below 18');
  const vertical = threadCurve({ x: 0, y: 0 }, 'bottom', { x: 0, y: 300 }, 'top');
  assert.deepEqual([vertical.c1, vertical.c2], [{ x: 0, y: 126 }, { x: 0, y: 174 }]);
  assert.equal(chooseSide({ x: 0, y: 0, width: 100, height: 100 }, { x: 300, y: 40, width: 100, height: 100 }), 'right');
  assert.equal(chooseSide({ x: 0, y: 0, width: 100, height: 100 }, { x: 20, y: 400, width: 100, height: 100 }), 'bottom');
  assert.equal(chooseSide({ x: 300, y: 0, width: 100, height: 100 }, { x: 0, y: 20, width: 100, height: 100 }), 'left');
  const drop = dropCurve({ x: 0, y: 0 }, 'right', { x: 100, y: 300 }, 'left');
  assert.equal(drop.c1.y, 0); assert.equal(drop.c2.y, 300);
  assert.deepEqual(cubicAt(curve, 0), { x: 0, y: 0 });
  assert.deepEqual(cubicAt(curve, 1), { x: 200, y: 40 });
});

test('end points: excerpt threads tie into the tag hole, citations land on the draft footnote eyelet', () => {
  const source = { id: 's', kind: 'video' as const, box: { x: 0, y: 0, width: 320, height: 270 }, anchors: { railY: 191 } };
  const quote = { id: 'q', kind: 'quote' as const, box: { x: 376, y: 0, width: 284, height: 180 } };
  const excerpt = edgeGeometry({ kind: 'excerpt' }, source, quote);
  assert.deepEqual(excerpt.start, { x: 320, y: 191 });
  assert.deepEqual(excerpt.end, { x: 376 + SPEC.tagHoleX, y: SPEC.tagHoleY });
  assert.equal(excerpt.tie, false);
  const measured = edgeGeometry({ kind: 'excerpt' }, source, { ...quote, anchors: { tagHole: { x: 7.5, y: 23 } } });
  assert.deepEqual(measured.end, { x: 376, y: 23 });

  const draft = { id: 'd', kind: 'draft' as const, box: { x: 716, y: 0, width: 340, height: 460 }, versions: 1 };
  const cite = edgeGeometry({ kind: 'cite', citeKey: 'q', footnoteIndex: 0, footnoteCount: 2 }, quote, draft);
  assert.equal(cite.start.x, 660);
  assert.equal(cite.end.x, 716);
  // Bottom-anchored rows: 8 sheet + 14 pad + 10 notes pad + 11 half row, then 28 per row above.
  assert.equal(cite.end.y, 460 - (8 + 12 + 24));
  assert.equal(footnoteY(draft, 'q', 1, 2), 460 - (8 + 12));
  assert.equal(footnoteY({ ...draft, anchors: { footnotes: { q: { y: 333 } } } }, 'q', 0, 2), 333, 'a measured footnote row wins');
  // The card package's numbered eyelets (data-footnote-eyelet) give the exact end, x included.
  const eyelet = edgeGeometry({ kind: 'cite', citeKey: 'q', footnoteIndex: 1, footnoteCount: 2 }, quote, { ...draft, anchors: { footnoteRows: { 2: { x: 0.5, y: 401 } } } });
  assert.deepEqual(eyelet.end, { x: 716.5, y: 401 });

  // Stacked cards: the thread drops from the source's bottom edge just right of the hole and curls into it.
  const below = edgeGeometry({ kind: 'excerpt' }, source, { ...quote, box: { x: 0, y: 380, width: 320, height: 200 } });
  assert.equal(below.startSide, 'bottom');
  assert.deepEqual(below.start, { x: SPEC.tagHoleX + 36, y: 270 });
  assert.equal(below.endSide, 'left');
  // Quote further left than the source: leave the left edge at rail height.
  const left = edgeGeometry({ kind: 'excerpt' }, { ...source, box: { x: 600, y: 0, width: 320, height: 270 } }, quote);
  assert.equal(left.startSide, 'left');
  assert.deepEqual(left.start, { x: 600, y: 191 });

  const pencil = edgeGeometry({ kind: 'pencil' }, { id: 'n', box: { x: 0, y: 600, width: 300, height: 100 } }, draft);
  assert.equal(pencil.startSide, 'right');
  assert.deepEqual(pencil.end, { x: 716, y: 230 });
});

test('labels avoid every card and each other, preferring a spot above the midpoint', () => {
  const curve = threadCurve({ x: 0, y: 100 }, 'right', { x: 400, y: 100 }, 'left');
  const free = placeLabels([{ key: 'a', width: 60, height: LABEL_HEIGHT, paths: [{ curve }] }], []);
  const mid = cubicAt(curve, 0.5);
  assert.deepEqual(free.get('a')!.center, { x: mid.x, y: Math.round((mid.y - 13) * 2) / 2 });

  // A card right on top of the midpoint pushes the label along the thread or to the empty side.
  const blocker: Box = { x: 150, y: 40, width: 100, height: 140 };
  const pushed = placeLabels([{ key: 'a', width: 60, height: LABEL_HEIGHT, paths: [{ curve }] }], [{ id: 'card', box: blocker }]);
  assert.ok(pushed.get('a')!.clean);
  assert.ok(!boxesIntersect(pushed.get('a')!.box, blocker));

  // Two labels on the same thread do not stack on each other.
  const both = placeLabels([
    { key: 'a', width: 60, height: LABEL_HEIGHT, paths: [{ curve }] },
    { key: 'b', width: 60, height: LABEL_HEIGHT, paths: [{ curve }] },
  ], []);
  assert.ok(!boxesIntersect(both.get('a')!.box, both.get('b')!.box));
});

test('crowded threads still find a free spot nearby; a fully covered area reports it honestly', () => {
  const curve = threadCurve({ x: 0, y: 0 }, 'right', { x: 120, y: 0 }, 'left');
  const wall = [-1, 0, 1].flatMap(row => [-1, 0, 1].map(column => ({ id: `${row}${column}`, box: { x: column * 70 - 10, y: row * 70 - 40, width: 60, height: 60 } })));
  const placed = placeLabels([{ key: 'a', width: 44, height: LABEL_HEIGHT, paths: [{ curve }] }], wall).get('a')!;
  assert.ok(placed.clean);
  for (const item of wall) assert.ok(!boxesIntersect(placed.box, item.box));
  const covered = placeLabels([{ key: 'a', width: 44, height: LABEL_HEIGHT, paths: [{ curve }] }], [{ id: 'all', box: { x: -2000, y: -2000, width: 4000, height: 4000 } }]).get('a')!;
  assert.equal(covered.clean, false);
});

test('first-run demo and the writing example place every label off the cards at spec heights and at zoom-compensated sizes', () => {
  for (const board of [createBoard('demo'), createExampleBoard('writing'), createExampleBoard('video')]) {
    const nodes = layoutNodes(board);
    const layout = assertLabelsClear(board, nodes);
    assert.ok(layout.labels.size > 0);
    // Simple LOD at 50% doubles labels in canvas units (12px screen minimum); they must still clear the cards.
    assertLabelsClear(board, nodes, labelScaleForZoom(0.5));
  }
  const writing = createExampleBoard('writing');
  const texts = [...computeEdgeLayout(layoutNodes(writing), fieldEdgeRecords(writing)).labels.values()].map(label => label.text).sort();
  assert.deepEqual(texts, ['写进第 3 段', '写进第 7 段', '摘录', '摘录', '改开头'].sort(), 'the article fan-out says “摘录” once');
});

test('labels also clear the taller pre-redesign cards (legacy heights measured in the current UI)', () => {
  // Legacy cards are much taller (quote ≈ 400, draft ≈ 460); the example layout overlaps there, labels still must not.
  const legacy = (node: BoardNode) => ({ video: 360, quote: 400, draft: 460, note: 300, link: 240, image: 320, frame: 360 }[node.data.kind]);
  for (const board of [createBoard('demo'), createExampleBoard('writing')]) assertLabelsClear(board, layoutNodes(board, legacy));
});

test('label metrics and LOD thresholds', () => {
  assert.equal(estimateTextWidth('摘录自'), 36);
  assert.equal(estimateTextWidth('写进第 12 段'), 70);
  assert.deepEqual(labelSize('摘录自'), { width: 50, height: 18 });
  assert.ok(labelSize('一个非常非常长的用户自己写的连线标签文字会被省略').width <= 182);
  assert.equal(lodForZoom(1), 'full');
  assert.equal(lodForZoom(0.85), 'simple');
  assert.equal(lodForZoom(0.86), 'full');
  assert.equal(lodForZoom(0.8599), 'simple');
  assert.equal(lodForZoom(0.6), 'simple');
  assert.equal(lodForZoom(0.49), 'far');
  assert.equal(labelScaleForZoom(1), 1);
  assert.equal(labelScaleForZoom(0.85), 1.18, '12px label never renders under 12px on screen');
  assert.ok(labelScaleForZoom(0.86) * 12 * 0.86 >= 12);
  assert.equal(labelScaleForZoom(0.3), 1, 'far: labels hidden, no relayout while zooming');
});

test('a label parked away from a short thread is tied back to it by a leader (CANVAS-12)', () => {
  const curve = threadCurve({ x: 0, y: 100 }, 'right', { x: 60, y: 60 }, 'left');
  const away: Box = { x: -40, y: 20, width: 80, height: 22 };
  const tied = labelTether(away, [curve], 1, true);
  assert.ok(tied.leader, 'a detached label 30px off its thread gets a leader');
  assert.ok(Math.hypot(tied.leader!.to.x - tied.anchor.x, tied.leader!.to.y - tied.anchor.y) <= 2.1, 'the leader ends at the thread (2px short)');
  assert.ok(tied.leader!.from.y >= away.y + away.height, 'and starts at the label box edge facing the thread');
  assert.ok(labelTether(away, [curve], 1, false).leader, 'a short thread (72px) ties its label even when it was placed nearby');
  const long = threadCurve({ x: 0, y: 100 }, 'right', { x: 300, y: 60 }, 'left');
  assert.equal(labelTether({ x: 110, y: 30, width: 80, height: 22 }, [long], 1, false).leader, undefined, 'a label placed beside a long thread draws none');
  assert.equal(labelTether({ x: 20, y: 66, width: 40, height: 22 }, [curve], 1, true).leader, undefined, 'nor does one touching the thread');
});
