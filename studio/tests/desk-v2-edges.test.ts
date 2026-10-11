import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorSignature, edgeGeometry } from '../src/canvas/edges/anchors';
import { cubicAt } from '../src/canvas/edges/geometry';
import { labelScaleForZoom, computeEdgeLayout } from '../src/canvas/edges/layout';
import { boxesIntersect } from '../src/canvas/edges/geometry';
import { labelSize } from '../src/canvas/edges/labels';
import { stampOpacity, reducedTraceSchedule } from '../src/canvas/trace';

test('v2 excerpt uses its marked row and paper edge; cite uses the stamp and paragraph circle', () => {
  const source = { id: 's', kind: 'video' as const, box: { x: 0, y: 0, width: 300, height: 260 }, anchors: { railY: 150, excerptRows: { q: { y: 205 } } } };
  const quote = { id: 'q', kind: 'quote' as const, box: { x: 400, y: 0, width: 280, height: 200 }, anchors: { stamp: { x: 18, y: 19 } } };
  const excerpt = edgeGeometry({ kind: 'excerpt' }, source, quote);
  assert.deepEqual(excerpt.start, { x: 300, y: 205 });
  assert.deepEqual(excerpt.end, { x: 400, y: 19 });
  assert.equal(excerpt.tie, false);
  assert.match(excerpt.d, /L.*Q/);
  assert.deepEqual(cubicAt(excerpt.curve, 0), excerpt.start);
  assert.deepEqual(cubicAt(excerpt.curve, 1), excerpt.end);
  const draft = { id: 'd', kind: 'draft' as const, box: { x: 800, y: 0, width: 400, height: 400 }, anchors: { paragraphRefs: { q: { x: 21, y: 143 } }, footnotes: { q: { y: 355 } } } };
  const cite = edgeGeometry({ kind: 'cite', citeKey: 'q' }, quote, draft);
  assert.deepEqual(cite.start, { x: 680, y: 19 });
  assert.deepEqual(cite.end, { x: 821, y: 143 });
  const folded = edgeGeometry({ kind: 'cite', citeKey: 'q' }, quote, { ...draft, anchors: { footnotes: draft.anchors.footnotes } });
  assert.equal(folded.end.y, 355);
});

test('v2 signature survives data remount and changes at width, text, font and tier changes', () => {
  const data = { kind: 'quote', body: '逐字保真' };
  const sig = anchorSignature(300, 200, data, 'simple', .7, 'font-a');
  assert.equal(sig, anchorSignature(300, 200, { ...data }, 'simple', .7, 'font-a'));
  assert.notEqual(sig, anchorSignature(300, 200, data, 'simple', .75, 'font-a'));
  assert.notEqual(sig, anchorSignature(300, 200, data, 'simple', .7, 'font-b'));
  assert.notEqual(sig, anchorSignature(301, 200, data, 'simple', .7, 'font-a'));
  assert.notEqual(sig, anchorSignature(300, 200, { ...data, body: '新正文' }, 'simple', .7, 'font-a'));
});

test('v2 label compensation maintains 12 screen px and placements clear cards and labels', () => {
  for (const zoom of [.5, .7, .86, 1, 1.5]) assert.ok(labelScaleForZoom(zoom) * 12 * zoom >= 12);
  assert.equal(labelSize('摘录').height, 18);
  const nodes = [0, 1, 2].map(i => ({ id: String(i), box: { x: i * 440, y: i * 60, width: 290, height: 250 } }));
  const edges = [0, 1].map(i => ({ id: `e${i}`, data: { kind: 'pencil' as const, derived: false, from: String(i), to: String(i + 1), label: '关系' } }));
  for (const zoom of [.5, .7, 1, 1.5]) {
    const layout = computeEdgeLayout(nodes, edges, labelScaleForZoom(zoom));
    const labels = [...layout.labels.values()];
    for (const label of labels) {
      assert.ok(label.clean);
      for (const node of nodes) assert.ok(!boxesIntersect(label.box, node.box));
    }
    assert.ok(!boxesIntersect(labels[0].box, labels[1].box));
  }
});

test('stamp is 120ms in, 240ms hold, 360ms out; reduced is a static 240ms hold', () => {
  assert.equal(stampOpacity(0), 0);
  assert.equal(stampOpacity(120), 1);
  assert.equal(stampOpacity(360), 1);
  assert.equal(stampOpacity(540), .5);
  assert.equal(stampOpacity(720), 0);
  assert.equal(stampOpacity(0, true), 1);
  assert.equal(stampOpacity(239, true), 1);
  assert.equal(stampOpacity(240, true), 0);
  assert.equal(reducedTraceSchedule().end, 240);
});
