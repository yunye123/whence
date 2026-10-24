import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { captionRules, getVisibleCardBounds } from '../src/app/caption-rules';
import { avoidCaptionObstacles, captionPlacementBounds, frameContainsCard, getCardBounds, knownImageRatio,
  placeAtPointer, placeInView, placeCards, placeBatchInView, placeBatchAtPoint, rememberImageRatio,
  type CardBounds, type CardMeasurements } from '../src/card-placement';
import { createNode, duplicateNode } from '../src/board-utils';
import { createBoard } from '../src/templates';
import { useCardCommands } from '../src/app/useCardCommands';
import { useImportFlows } from '../src/app/useImportFlows';
import { useDraftWriting } from '../src/app/useDraftWriting';
import { formatDraftQuote } from '../src/draft-references';
import type { Board, BoardNode, CardKind, Workspace } from '../src/model';

const card = (id: string, kind: CardKind, x: number, y: number, width = 100, height = 100): BoardNode =>
  ({ id, type: 'card', position: { x, y }, style: { width, height }, data: { kind, title: id, body: '原文\r\n😀 空格  ' } });
const clear = (a: CardBounds, b: CardBounds, gap = 32) => a.x + a.width + gap <= b.x || b.x + b.width + gap <= a.x
  || a.y + a.height + gap <= b.y || b.y + b.height + gap <= a.y;
const contains = (a: CardBounds, b: CardBounds) => b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
function frozen<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }

test('all single-card entry points protect the stationary 24px caption; legacy calls stay raw', () => {
  const photo = card('photo', 'image', 0, 0), fresh = card('fresh', 'note', 0, 0);
  const existing = frozen([photo]), measurements = frozen({ photo: { width: 100, height: 100 } });
  const bounds = captionPlacementBounds(existing, measurements), point = { x: 0, y: 132 };
  const view = { x: 0, y: 132, width: 100, height: 100 };
  assert.deepEqual(placeAtPointer(fresh, existing, point, measurements).position, point);
  assert.deepEqual(placeCards([fresh], existing, { origin: point, measurements, preserveFirst: true })[0].position, point);
  const placed = [placeAtPointer(fresh, existing, point, measurements, bounds),
    placeInView(fresh, existing, view, measurements, 'straddle', bounds),
    placeCards([fresh], existing, { origin: point, measurements, preserveFirst: true, bounds })[0],
    placeBatchInView([fresh], existing, view, measurements, bounds)[0],
    placeBatchAtPoint([fresh], existing, { x: 50, y: 182 }, view, measurements, bounds)[0]];
  for (const node of placed) {
    assert.ok(clear({ ...node.position, width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 124 }));
    assert.equal(node.style, fresh.style); assert.equal(node.data, fresh.data);
  }
  assert.deepEqual(getCardBounds(photo, measurements), { x: 0, y: 0, width: 100, height: 100 });
});

test('hover-only free and tight tray captions reserve no extra height; old positions and membership stay intact', () => {
  const photo = card('tight', 'image', 0, 0), below = card('below', 'note', 0, 112);
  const tray = card('tray', 'frame', -16, -16, 300, 250);
  for (const existing of [[photo, below], [tray, photo, below]]) {
    const before = structuredClone(existing), rules = captionRules(existing);
    assert.equal(rules.captionIds.has(photo.id), false);
    assert.deepEqual(captionPlacementBounds(existing)([photo], {})[0], getCardBounds(photo));
    const node = card('new', 'note', 0, 0);
    assert.deepEqual(placeCards([node], existing, { origin: { x: 0, y: -132 }, bounds: captionPlacementBounds(existing) }).map(n => n.position),
      placeCards([node], existing, { origin: { x: 0, y: -132 } }).map(n => n.position));
    assert.deepEqual(existing, before);
  }
  const edgePhoto = card('edge-photo', 'image', 0, 0), rawFrame = card('raw-frame', 'frame', 0, 0, 100, 100);
  assert.equal(frameContainsCard(rawFrame, edgePhoto), true);
  assert.equal(contains(getCardBounds(rawFrame), getVisibleCardBounds(edgePhoto, {}, captionRules([rawFrame, edgePhoto]).captionIds)), false);
  assert.equal(frameContainsCard(rawFrame, edgePhoto), true);
});

test('incoming captions clear an obstacle below the new photo, and duplicate never persists the extra 24', () => {
  const source = card('source', 'image', -300, -300, 100, 100), copy = duplicateNode(source);
  const obstacle = card('obstacle', 'note', 0, 132, 100, 100), origin = { x: 0, y: 0 };
  const existing = frozen([source, obstacle]);
  assert.deepEqual(placeCards([copy], existing, { origin })[0].position, origin);
  const [placed] = placeCards([copy], existing, { origin, bounds: captionPlacementBounds(existing) });
  assert.ok(clear({ ...placed.position, width: 100, height: 124 }, getCardBounds(obstacle)));
  assert.deepEqual(placed.style, copy.style); assert.deepEqual(placed.data, copy.data);
  assert.equal(placed.style?.height, 100);
});

test('picture batches protect static and final-row captions in view/pointer searches without changing ratio or 12px gaps', () => {
  const existing = frozen([card('static', 'image', 0, 0, 1200, 100)]);
  const photos = frozen(Array.from({ length: 8 }, (_, i) => card(`incoming-${i}`, 'image', 0, 0, i % 2 ? 200 : 100, 100)));
  const measurements = frozen(Object.fromEntries(photos.map(n => [n.id, { width: n.style!.width!, height: n.style!.height! }])));
  const view = { x: 0, y: 0, width: 1200, height: 1400 }, point = { x: 600, y: 300 };
  const bounds = captionPlacementBounds(existing);
  for (const kind of ['view', 'pointer'] as const) {
    const raw = kind === 'view' ? placeBatchInView(photos, [], view, measurements) : placeBatchAtPoint(photos, [], point, view, measurements);
    const placed = kind === 'view' ? placeBatchInView(photos, existing, view, measurements, bounds) : placeBatchAtPoint(photos, existing, point, view, measurements, bounds);
    assert.deepEqual(placed.map(n => n.style), raw.map(n => n.style), 'caption cannot enter ratio or layout writeback');
    const rules = captionRules(placed), visible = placed.map(n => getVisibleCardBounds(n, {}, rules.captionIds));
    for (const box of visible) {
      assert.ok(clear(box, { x: 0, y: 0, width: 1200, height: 124 }));
      assert.ok(contains(view, box), 'incoming caption also fits the view');
    }
    const rows = [...new Set(placed.map(n => n.position.y))].sort((a, b) => a - b);
    assert.ok(rows.length > 1);
    for (let i = 1; i < rows.length; i++) {
      const above = placed.filter(n => n.position.y === rows[i - 1]);
      assert.equal(rows[i] - Math.max(...above.map(n => n.position.y + n.style!.height!)), 12);
      assert.ok(above.every(n => !rules.captionIds.has(n.id)), 'tight rows become hover-only');
    }
    assert.ok(placed.filter(n => n.position.y === rows.at(-1)).every(n => rules.captionIds.has(n.id)));
    for (const n of placed) assert.equal(n.data, photos.find(p => p.id === n.id)!.data);
  }
});

test('raw learned ratio, dimensions, measurements and frame membership survive active placement', () => {
  const photo = card('ratio', 'image', 0, 0, 240, 100); delete photo.style!.height;
  photo.data.url = 'w3-o-ratio'; rememberImageRatio(photo.data.url, 1600, 800);
  const measurements = frozen({ ratio: { width: 240, height: 480 } });
  const tray = card('ratio-tray', 'frame', 0, 0, 240, 120), existing = frozen([photo, tray]);
  const before = structuredClone(existing), bounds = captionPlacementBounds(existing, measurements);
  assert.equal(bounds([photo], measurements)[0].height, 144);
  placeAtPointer(card('note', 'note', 0, 0), existing, { x: 0, y: 152 }, measurements, bounds);
  assert.equal(knownImageRatio(photo), 2); assert.equal(getCardBounds(photo, measurements).height, 120);
  assert.equal(photo.style?.height, undefined); assert.equal(frameContainsCard(tray, photo, measurements), true);
  assert.deepEqual(existing, before); assert.deepEqual(measurements, { ratio: { width: 240, height: 480 } });
});

test('external-producer sidecar keeps payloads, links and relative layout; no-caption input returns unchanged', () => {
  const photo = frozen(card('side-photo', 'image', 0, 0)), first = card('quote-a', 'quote', 0, 132), second = card('quote-b', 'quote', 180, 132);
  first.data.citation = { nodeId: photo.id, title: '原题', text: '原话 😀\r\n  ', start: 1, end: 2 };
  const batch = frozen([first, second]);
  assert.equal(avoidCaptionObstacles(batch, []), batch);
  const placed = avoidCaptionObstacles(batch, [photo]);
  assert.equal(placed[1].position.x - placed[0].position.x, 180);
  assert.equal(placed[1].position.y, placed[0].position.y);
  for (const [i, node] of placed.entries()) {
    assert.ok(clear(getCardBounds(node), { x: 0, y: 0, width: 100, height: 124 }));
    assert.equal(node.data, batch[i].data); assert.equal(node.style, batch[i].style);
  }
});

// Invoke real hook callbacks; browser lifecycle and media decoding are checked separately in the opt-in browser run.
const previous = new Map(['window', 'document', 'requestAnimationFrame', 'CSS', 'HTMLElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.defineProperties(globalThis, {
  window: { configurable: true, value: { setTimeout: () => 0 } },
  document: { configurable: true, value: { querySelector: () => null } },
  requestAnimationFrame: { configurable: true, value: () => 0 },
  CSS: { configurable: true, value: { escape: (value: string) => value } },
  HTMLElement: { configurable: true, value: class {} },
});
after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
function capture<T>(hook: () => T): T { let result: T; function Probe() { result = hook(); return null; } renderToString(createElement(Probe)); return result!; }
function harness(nodes: BoardNode[], measurements: CardMeasurements = {}) {
  const boardRef = { current: { ...createBoard('blank'), nodes } as Board | null };
  const workspaceRef = { current: { schema: 1, activeBoardId: boardRef.current!.id, boards: [boardRef.current!] } as Workspace | null };
  let changes = 0;
  const noop = () => {}, measurementsRef = { current: measurements };
  const common = { board: boardRef.current, inspected: undefined, boardRef, workspaceRef, readOnlyRef: { current: false }, readOnly: false,
    measurements, measurementsRef, changeBoard: (fn: (b: Board) => Board) => { const next = fn(boardRef.current!); changes++; boardRef.current = next; workspaceRef.current!.boards = [next]; return true; },
    visibleView: () => ({ x: 0, y: 132, width: 290, height: 440 }), center: () => ({ x: 0, y: 132 }), notify: noop,
    undoChange: () => noop, markFresh: noop, fieldTrace: { land: noop, tie: noop }, playbackRequest: { current: 0 },
    draftNavigation: { current: { insertPoint: () => null } }, clearDraftNavigation: noop, showCard: noop,
    busyRef: { current: '' }, setBusy: noop, persist: async () => {}, saveVersion: { current: 0 }, pushHistory: noop,
    setNext: (next: Workspace) => { workspaceRef.current = next; boardRef.current = next.boards[0]; },
    setSelectedIds: noop, setSelectedEdgeIds: noop, setContextMenu: noop, setCanvasReveal: noop, setModal: noop, setLinkValue: noop, setView: noop };
  return { common, boardRef, changes: () => changes };
}

test('real creation/duplicate callbacks avoid free captions using current raw measurements', () => {
  for (const via of ['pointer', 'view'] as const) {
    const h = harness([card('cmd-photo', 'image', 0, 0, 290, 100)]);
    const commands = capture(() => useCardCommands(h.common as unknown as Parameters<typeof useCardCommands>[0]));
    const node = commands.addCard('note', via === 'pointer' ? { x: 0, y: 132 } : undefined)!;
    assert.ok(clear(getCardBounds(node), { x: 0, y: 0, width: 290, height: 124 })); assert.equal(h.changes(), 1);
  }
  const source = card('duplicate-source', 'note', -36, 96);
  const h = harness([card('duplicate-photo', 'image', 0, 0), source]);
  const commands = capture(() => useCardCommands(h.common as unknown as Parameters<typeof useCardCommands>[0]));
  h.common.measurementsRef.current = { 'duplicate-photo': { width: 100, height: 140 } };
  commands.duplicateCardAction(source.id);
  const copy = h.boardRef.current!.nodes.at(-1)!;
  assert.ok(clear(getCardBounds(copy), { x: 0, y: 0, width: 100, height: 164 }));
  assert.equal(copy.data.body, source.data.body); assert.deepEqual(copy.style, source.style); assert.equal(h.changes(), 1);
});

test('real transcript/text excerpt callbacks keep citation strings and edges while translating only new cards', () => {
  for (const kind of ['video', 'note'] as const) {
    const source = card(`excerpt-${kind}`, kind, 0, 0);
    source.data.body = '原文 😀\r\n保留  空格';
    const line = { id: 'canonical-line', start: 1, end: 2, text: '原话 😀  空格' };
    if (kind === 'video') source.data.transcript = [line];
    const photo = card('excerpt-photo', 'image', 170, -97);
    const h = harness([source, photo]), before = structuredClone(h.boardRef.current);
    const commands = capture(() => useCardCommands(h.common as unknown as Parameters<typeof useCardCommands>[0]));
    const result = kind === 'video' ? commands.addQuote(source.id, [{ ...line, text: '过期的调用者文本' }])
      : commands.addTextQuote(source.id, { from: 0, to: 5 });
    assert.equal(result, true);
    const quote = h.boardRef.current!.nodes.at(-1)!;
    assert.ok(clear(getCardBounds(quote), { x: 170, y: -97, width: 100, height: 124 }));
    assert.equal(quote.style?.height, undefined);
    assert.equal(quote.data.citation?.text, kind === 'video' ? line.text : '原文 😀');
    assert.equal(quote.data.citation?.nodeId, source.id);
    assert.equal(h.boardRef.current!.edges.at(-1)!.target, quote.id);
    assert.equal(h.boardRef.current!.edges.at(-1)!.source, source.id);
    assert.deepEqual(h.boardRef.current!.nodes.slice(0, 2), before!.nodes); assert.equal(h.changes(), 1);
  }
});

test('real link imports and paste preserve source text while avoiding caption obstacles in point/view paths', () => {
  const text = '  原始 😀 文本\r\nhttps://example.org/a  ';
  for (const via of ['pointer', 'view', 'paste'] as const) {
    const h = harness([card('import-photo', 'image', 0, 0, 290, 100)]);
    const imports = capture(() => useImportFlows(h.common as unknown as Parameters<typeof useImportFlows>[0]));
    if (via === 'paste') imports.pasteText('原始 😀 文本\r\n保留  空格');
    else imports.importUrl(text, via === 'pointer' ? { x: 0, y: 132 } : undefined);
    if (via === 'paste') {
      const node = h.boardRef.current!.nodes.at(-1)!;
      assert.equal(node.data.kind, 'note');
      assert.ok(clear(getCardBounds(node), { x: 0, y: 0, width: 290, height: 124 }));
      assert.equal(node.data.body, '原始 😀 文本\r\n保留  空格');
    } else {
      const created = h.boardRef.current!.nodes.slice(1);
      const link = created.find(node => node.data.kind === 'link');
      const note = created.find(node => node.data.kind === 'note');
      assert.ok(link && note);
      assert.equal(link.data.body, '');
      assert.equal(link.data.url, 'https://example.org/a');
      assert.equal(link.data.title, 'example.org');
      assert.equal(note.data.body, '原始 😀 文本');
      for (const node of created) assert.ok(clear(getCardBounds(node), { x: 0, y: 0, width: 290, height: 124 }));
    }
    assert.equal(h.changes(), 1);
  }
});

test('real write-to-draft creates one safe draft and preserves raw quote/citation strings', () => {
  const photo = card('write-photo', 'image', 164, 0, 340, 100), quote = card('write-quote', 'quote', 0, 132, 100, 90);
  quote.data.citation = { nodeId: photo.id, title: '来源 😀', text: '原话\r\n  空格', start: 1, end: 2 };
  const h = harness([photo, quote]), before = structuredClone(h.boardRef.current);
  const writing = capture(() => useDraftWriting(h.common as unknown as Parameters<typeof useDraftWriting>[0]));
  writing.writeToDraft(quote.id);
  const draft = h.boardRef.current!.nodes.at(-1)!;
  assert.equal(draft.data.kind, 'draft'); assert.ok(clear(getCardBounds(draft), { x: 164, y: 0, width: 340, height: 124 }));
  assert.equal(draft.data.body, formatDraftQuote(quote).replace(/\n+$/, '\n').replace(/^\n+/, ''));
  assert.deepEqual(h.boardRef.current!.nodes.slice(0, 2), before!.nodes); assert.equal(h.changes(), 1);
  writing.writeToDraft(quote.id);
  assert.equal(h.boardRef.current!.nodes.filter(n => n.data.kind === 'draft').length, 1);
});
