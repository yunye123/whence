import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../src/storage';
import { createExampleBoard } from '../src/templates';
import { formatSourceLink } from '../src/draft-references';
import type { Board } from '../src/model';
import {
  COMET_OPACITY, TRACE_TIMING, activeWalk, arrivalSpot, cometDashes, drawnDash, fadeOpacity, planTrace, pulseScale, reducedTraceSchedule,
  traceSchedule, walkedDash,
} from '../src/canvas/trace';
import { createFieldTrace } from '../src/canvas/trace-player';

const byTitle = (board: Board, title: string) => board.nodes.find(node => node.data.title === title)!;
const ofKind = (board: Board, kind: string) => board.nodes.filter(node => node.data.kind === kind);

test('trigger A: from an excerpt the light walks its excerpt thread back to the source', () => {
  const board = createBoard('demo');
  const quote = ofKind(board, 'quote')[0];
  const source = board.nodes.find(node => node.id === quote.data.citation!.nodeId)!;
  const plan = planTrace(board, { sourceId: source.id, quoteId: quote.id });
  assert.ok(plan);
  assert.equal(plan.startId, quote.id);
  assert.deepEqual(plan.segments.map(segment => [segment.kind, segment.from, segment.to]), [['excerpt', quote.id, source.id]]);
  assert.equal(plan.segments[0].edgeId, board.edges.find(edge => edge.source === source.id && edge.target === quote.id)!.id);
  assert.equal(plan.draftId, undefined);
});

test('trigger B: from a draft citation the light walks the citation thread to the excerpt, then on to the source', () => {
  const board = createExampleBoard('writing');
  const draft = byTitle(board, '十五分钟的城市');
  const cited = ofKind(board, 'quote').filter(quote => draft.data.body.includes(quote.id));
  assert.equal(cited.length, 2);
  cited.forEach((quote, index) => {
    const source = quote.data.citation!.nodeId;
    const plan = planTrace(board, { sourceId: source, quoteId: quote.id, draftId: draft.id });
    assert.ok(plan);
    assert.equal(plan.startId, draft.id);
    assert.equal(plan.draftId, draft.id);
    assert.deepEqual(plan.segments.map(segment => segment.kind), ['cite', 'excerpt']);
    assert.equal(plan.segments[0].edgeId, `cite:${draft.id}:${quote.id}`, 'the derived citation thread');
    assert.deepEqual([plan.segments[0].from, plan.segments[0].to, plan.segments[1].from, plan.segments[1].to], [draft.id, quote.id, quote.id, source]);
    assert.equal(plan.footnote, index + 1, 'start highlight on the matching footnote row');
  });
});

test('a draft that cites the source directly walks one citation thread; an asked footnote must match the citation', () => {
  const board = createExampleBoard('writing');
  const draft = byTitle(board, '十五分钟的城市');
  const link = byTitle(board, '社区步行调查：一份方法笔记');
  const direct = `

> 一份方法笔记

[来源：${link.data.title}](${formatSourceLink(link.id)})

`;
  const body = `${draft.data.body}\n\n${direct}`;
  const edited: Board = { ...board, nodes: board.nodes.map(node => (node.id === draft.id ? { ...node, data: { ...node.data, body } } : node)) };
  const plan = planTrace(edited, { sourceId: link.id, draftId: draft.id, footnote: 1 });
  assert.ok(plan);
  assert.deepEqual(plan.segments.map(segment => [segment.kind, segment.from, segment.to]), [['cite', draft.id, link.id]]);
  assert.equal(plan.footnote, 3, 'footnote 1 cites a quote, so the first matching footnote (3) lights instead');
});

test('no plan when nothing can be walked: missing threads, an inconsistent excerpt, a missing source', () => {
  const board = createBoard('demo');
  const quote = ofKind(board, 'quote')[0];
  const source = quote.data.citation!.nodeId;
  const withoutThread: Board = { ...board, edges: board.edges.filter(edge => edge.target !== quote.id) };
  assert.equal(planTrace(withoutThread, { sourceId: source, quoteId: quote.id }), null);
  const other = ofKind(board, 'image')[0];
  assert.equal(planTrace(board, { sourceId: other.id, quoteId: quote.id }), null, 'excerpt does not belong to that source');
  assert.equal(planTrace(board, { sourceId: 'gone', quoteId: quote.id }), null);
  assert.equal(planTrace(null, { sourceId: source }), null);
  assert.equal(planTrace(board, { sourceId: source }), null, 'search navigation (no excerpt, no draft) just opens');
});

test('trigger B with a deleted excerpt thread still walks the citation thread to the excerpt', () => {
  const board = createExampleBoard('writing');
  const draft = byTitle(board, '十五分钟的城市');
  const quote = ofKind(board, 'quote').find(item => draft.data.body.includes(item.id))!;
  const edited: Board = { ...board, edges: board.edges.filter(edge => edge.target !== quote.id) };
  const plan = planTrace(edited, { sourceId: quote.data.citation!.nodeId, quoteId: quote.id, draftId: draft.id });
  assert.deepEqual(plan?.segments.map(segment => segment.kind), ['cite']);
});

test('arrival lights the excerpt’s own place on the source rail: its sentence cells, or its span of the article', () => {
  const demo = createBoard('demo');
  const quote = ofKind(demo, 'quote')[0];
  const video = demo.nodes.find(node => node.id === quote.data.citation!.nodeId)!;
  const spotA = arrivalSpot(demo, planTrace(demo, { sourceId: video.id, quoteId: quote.id })!);
  const lines = video.data.transcript!;
  const covered = lines.map((line, index) => (line.start < (quote.data.citation!.end ?? line.end) && line.end > quote.data.citation!.start! ? index : -1)).filter(index => index >= 0);
  assert.deepEqual(spotA, { rail: 'video', first: covered[0], last: covered.at(-1), count: lines.length });

  const writing = createExampleBoard('writing');
  const draft = byTitle(writing, '十五分钟的城市');
  const cited = ofKind(writing, 'quote').find(item => draft.data.body.includes(item.id))!;
  const source = writing.nodes.find(node => node.id === cited.data.citation!.nodeId)!;
  const anchor = cited.data.citation!.textAnchor!;
  const spotB = arrivalSpot(writing, planTrace(writing, { sourceId: source.id, quoteId: cited.id, draftId: draft.id })!);
  assert.equal(spotB?.rail, 'length');
  if (spotB?.rail !== 'length') return;
  const length = source.data.body.replace(/\r\n?/g, '\n').length;
  assert.ok(Math.abs(spotB.left - anchor.from / length) < 1e-9);
  assert.ok(spotB.width >= .012 && spotB.left + spotB.width <= 1);

  assert.equal(arrivalSpot(writing, { sourceId: source.id }), null, 'no excerpt and no footnote time: the player rings the card instead');
  assert.equal(arrivalSpot(null, { sourceId: source.id, quoteId: cited.id }), null);
});

test('schedule follows §7 v1.2: one segment arrives at 560ms and opens right there; never longer than 2s', () => {
  const one = traceSchedule(1);
  assert.deepEqual(one.walks, [{ start: 80, end: 560 }]);
  assert.deepEqual([one.arrive, one.open, one.fadeStart, one.end], [560, 560, 560, 1460]);
  assert.ok(one.open <= 800 - 200, 'CORE-11: opening starts at arrival, leaving room for the workbench to show within 800ms');
  const two = traceSchedule(2);
  assert.deepEqual(two.walks, [{ start: 80, end: 269 }, { start: 349, end: 700 }]);
  assert.deepEqual(two.passes, [{ start: 269, end: 349 }]);
  assert.deepEqual([two.arrive, two.open, two.fadeStart, two.end], [700, 700, 700, 1600]);
  assert.ok(two.open <= 900 - 200, 'P2: a draft reference opens its source with room for the first panel mount within 900ms');
  for (const count of [1, 2, 3]) {
    const schedule = traceSchedule(count);
    assert.ok(schedule.end <= TRACE_TIMING.total);
    assert.equal(schedule.open, schedule.arrive, 'the workbench never waits for the pulse or the afterglow');
    for (const walk of schedule.walks) assert.ok(walk.end - walk.start >= 160, 'every segment is walked long enough to be seen');
  }
  const slow = traceSchedule(2, { ...TRACE_TIMING, afterglow: 5000 });
  assert.equal(slow.end, 2000, 'afterglow is cut to fit the 2s budget');
  const capped = traceSchedule(1, { ...TRACE_TIMING, walk: 2000 });
  assert.equal(capped.arrive, TRACE_TIMING.arrivalBy, 'a long --dur-trace is still held to the arrival budget');
  const reduced = reducedTraceSchedule(240);
  assert.deepEqual([reduced.open, reduced.fadeStart, reduced.end, reduced.walks.length], [0, 240, 240, 0]);
  assert.deepEqual(activeWalk(400, two), { index: 1, linear: (400 - 349) / 351 });
  assert.equal(activeWalk(300, two), null, 'passing through the excerpt card');
});

test('frame drawing: the walked part grows from the end, six comet dashes fade behind the front at 9 screen px each', () => {
  const half = walkedDash(400, .5);
  assert.equal(half.dasharray, '200 410');
  assert.equal(half.dashoffset, -200);
  assert.deepEqual(cometDashes(400, 0, 1), []);
  assert.deepEqual(cometDashes(400, 1, 1), []);
  const comets = cometDashes(400, .5, 1);
  assert.deepEqual(comets.map(dash => dash.opacity), [...COMET_OPACITY]);
  assert.deepEqual(comets.map(dash => dash.dashoffset), [-200, -209, -218, -227, -236, -245]);
  assert.ok(comets.every(dash => dash.dasharray.startsWith('9 ')));
  const zoomed = cometDashes(400, .5, .5);
  assert.ok(zoomed.every(dash => dash.dasharray.startsWith('18 ')), 'canvas units = screen px / zoom');
  const nearEnd = cometDashes(100, .02, 1);
  assert.ok(nearEnd.length < COMET_OPACITY.length, 'dashes past the path end are dropped');
  assert.equal(drawnDash(300, 0).dashoffset, 300);
  assert.equal(drawnDash(300, 1).dashoffset, 0);
  assert.equal(fadeOpacity(1000, { fadeStart: 1440, end: 2000 }), 1);
  assert.equal(fadeOpacity(2000, { fadeStart: 1440, end: 2000 }), 0);
  assert.ok(fadeOpacity(1500, { fadeStart: 1440, end: 2000 }) < 1);
  assert.equal(pulseScale(1320, 1200, 240), 1.5);
  assert.equal(pulseScale(1100, 1200, 240), 1);
});

test('the player always opens the source exactly once, even when there is nothing it can draw', () => {
  const board = createBoard('demo');
  const quote = ofKind(board, 'quote')[0];
  const trace = createFieldTrace({
    root: () => null, zoom: () => 1, nodeRect: () => null, getViewport: () => ({ x: 0, y: 0, zoom: 1 }), setViewport: () => {},
    board: () => board, excerptEdgeOf: () => null, reduced: () => false,
  });
  let opened = 0;
  assert.equal(trace.toSource({ sourceId: quote.data.citation!.nodeId, quoteId: quote.id }, () => { opened++; }), false);
  assert.equal(opened, 1);
  assert.equal(trace.isTracing(), false);
  trace.finish();
  trace.tie([quote.id]);
  trace.land([quote.id]);
  assert.equal(opened, 1);
});
