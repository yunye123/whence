import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../src/storage';
import { createExampleBoard } from '../src/templates';
import { formatDraftQuote, parseDraftReferences } from '../src/draft-references';
import type { Board, BoardNode } from '../src/model';
import {
  CITE_EDGE_PREFIX, citeLabel, classifyStoredEdge, draftCitations, edgeAriaLabel, edgeEmphasis, fieldEdgeRecords,
  isDerivedEdgeId, referenceParagraphs,
} from '../src/canvas/edges/model';
import { buildFlowEdges, storedEdgeChanges } from '../src/canvas/edges/flow-edges';

const byTitle = (board: Board, title: string) => board.nodes.find(node => node.data.title === title)!;
const quotes = (board: Board) => board.nodes.filter(node => node.data.kind === 'quote');

test('the writing example derives one read-only citation thread per quote the draft cites, labelled by paragraph', () => {
  const board = createExampleBoard('writing');
  const draft = byTitle(board, '十五分钟的城市');
  const before = structuredClone(board);
  const records = fieldEdgeRecords(board);
  const derived = records.filter(record => record.data.derived);
  const cited = new Set(parseDraftReferences(draft.data.body).map(reference => reference.quoteNodeId));
  assert.equal(derived.length, 2);
  for (const record of derived) {
    assert.ok(isDerivedEdgeId(record.id) && record.id.startsWith(CITE_EDGE_PREFIX));
    assert.equal(record.data.kind, 'cite');
    assert.equal(record.target, draft.id);
    assert.ok(cited.has(record.source), 'starts at a quote that the draft actually cites');
  }
  assert.deepEqual(derived.map(record => record.data.label), ['写进第 3 段', '写进第 7 段']);
  assert.deepEqual(derived.map(record => record.data.footnoteIndex), [0, 1]);
  assert.ok(derived.every(record => record.data.footnoteCount === 2));
  // The uncited excerpt (“先收着、以后再用”) has no citation thread.
  const uncited = quotes(board).find(quote => !cited.has(quote.id))!;
  assert.ok(!derived.some(record => record.source === uncited.id));
  // Derived threads never touch the stored board (not saved, not in undo history).
  assert.deepEqual(board, before);
  assert.ok(!board.edges.some(edge => isDerivedEdgeId(edge.id)));
});

test('stored edges keep their contract and are drawn by provenance kind', () => {
  const board = createExampleBoard('writing');
  const records = fieldEdgeRecords(board).filter(record => !record.data.derived);
  assert.equal(records.length, board.edges.length);
  for (const [index, edge] of board.edges.entries()) {
    assert.equal(records[index].id, edge.id);
    assert.equal(records[index].type, edge.type);
    assert.equal(records[index].label, edge.label);
  }
  assert.deepEqual(records.map(record => record.data.kind), ['excerpt', 'excerpt', 'excerpt', 'pencil']);
  // Two excerpt threads fanning out of the same article share one “摘录” label.
  const [first, second, third] = records;
  assert.equal(first.data.labelGroup, second.data.labelGroup);
  assert.notEqual(first.data.labelGroup, third.data.labelGroup);

  const demo = createBoard('demo');
  assert.deepEqual(fieldEdgeRecords(demo).map(record => record.data.kind), ['excerpt', 'pencil', 'pencil']);
});

test('a citation thread disappears when its reference is deleted or its quote leaves the board', () => {
  const board = createExampleBoard('writing');
  const draft = byTitle(board, '十五分钟的城市');
  const [firstReference] = parseDraftReferences(draft.data.body);
  const withoutFirst = structuredClone(board);
  const target = withoutFirst.nodes.find(node => node.id === draft.id)!;
  target.data.body = target.data.body.slice(0, firstReference.from) + target.data.body.slice(firstReference.to);
  const remaining = fieldEdgeRecords(withoutFirst).filter(record => record.data.derived);
  assert.equal(remaining.length, 1);
  assert.notEqual(remaining[0].source, firstReference.quoteNodeId);

  const quoteGone = structuredClone(board);
  quoteGone.nodes = quoteGone.nodes.filter(node => node.id !== firstReference.quoteNodeId);
  quoteGone.edges = quoteGone.edges.filter(edge => edge.source !== firstReference.quoteNodeId && edge.target !== firstReference.quoteNodeId);
  const derived = fieldEdgeRecords(quoteGone).filter(record => record.data.derived);
  assert.equal(derived.length, 1, 'a link that names a missing quote draws nothing, it does not fall back to the source');
});

test('a stored quote → draft edge replaces the derived thread and is drawn as a citation', () => {
  const board = createExampleBoard('writing');
  const draft = byTitle(board, '十五分钟的城市');
  const quote = parseDraftReferences(draft.data.body)[0].quoteNodeId!;
  board.edges.push({ id: 'manual', source: quote, target: draft.id, type: 'smoothstep' });
  const records = fieldEdgeRecords(board);
  assert.equal(records.filter(record => record.data.derived).length, 1);
  const manual = records.find(record => record.id === 'manual')!;
  assert.equal(manual.data.kind, 'cite');
  assert.equal(manual.data.label, '写进第 3 段');
  assert.equal(manual.label, undefined, 'the stored label stays empty');
});

test('direct source references (no quote id) still draw from the source card', () => {
  const board = createBoard('blank');
  const video: BoardNode = { id: 'v', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'video', title: '原片', body: '' } };
  const draft: BoardNode = { id: 'd', type: 'card', position: { x: 500, y: 0 }, data: { kind: 'draft', title: '稿', body: `开头。\n\n[来源：原片 00:12](field://node/v?t=12)` } };
  board.nodes = [video, draft];
  const [record] = fieldEdgeRecords(board);
  assert.equal(record.source, 'v');
  assert.equal(record.data.citeKey, 'v');
  assert.equal(record.data.label, '写进第 1 段');
});

test('paragraph numbers follow the writing page: a reference line folds into the quotation above it (CORE-01)', () => {
  const quote: BoardNode = { id: 'q', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '摘录', body: '', citation: { nodeId: 's', title: '来源', text: '原句' } } };
  const body = `# 标题\n\n第一段。\n\n第二段：${formatDraftQuote(quote)}第三段。${formatDraftQuote(quote)}`;
  const references = parseDraftReferences(body);
  assert.deepEqual(referenceParagraphs(body, references), [3, 5]);
  assert.deepEqual(draftCitations(body).cites.map(cite => cite.paragraph), [3]);
  assert.equal(draftCitations(body).rows, 2);
  assert.equal(citeLabel(4), '写进第 4 段', 'Arabic numerals, as on every tag (§6.7)');
  assert.equal(citeLabel(120), '写进第 120 段');
  assert.equal(citeLabel(undefined), '写进文稿');
});

test('selecting a quote lights its provenance chain only and dims everything else', () => {
  const board = createExampleBoard('writing');
  const draft = byTitle(board, '十五分钟的城市');
  const opening = parseDraftReferences(draft.data.body)[0].quoteNodeId!;
  const records = fieldEdgeRecords(board);
  const emphasis = edgeEmphasis(records, [opening]);
  const lit = records.filter(record => emphasis.get(record.id) === 'lit');
  // article → opening (up) and opening → draft (down); not the sibling excerpt or the note's pencil line.
  assert.equal(lit.length, 2);
  assert.ok(lit.some(record => record.data.kind === 'excerpt' && record.data.to === opening));
  assert.ok(lit.some(record => record.data.kind === 'cite' && record.data.from === opening));
  assert.ok(records.filter(record => !lit.includes(record)).every(record => emphasis.get(record.id) === 'dim'));
  assert.equal(edgeEmphasis(records, []).size, 0, 'nothing selected → no emphasis');

  // Selecting the draft lights every citation into it, their excerpts upstream, and the note's pencil line.
  const fromDraft = edgeEmphasis(records, [draft.id]);
  assert.equal(records.filter(record => fromDraft.get(record.id) === 'lit').length, 5);
});

test('flow edges carry Chinese aria labels, selection and read-only flags; derived changes are ignored', () => {
  const board = createExampleBoard('writing');
  const edges = buildFlowEdges(board, [], [board.edges[0].id]);
  assert.ok(edges.every(edge => !/Edge from|[0-9a-f]{8}-[0-9a-f]{4}/.test(edge.ariaLabel ?? '')));
  assert.match(edges[0].ariaLabel!, /^从‘步行十五分钟，能到达什么’摘到‘/);
  assert.ok(edges.every(edge => !/→|摘录线/.test(edge.ariaLabel ?? '')), 'no arrow (read as “右箭头”), no term outside the glossary (CANVAS-18)');
  assert.equal(edges[0].selected, true);
  const derived = edges.filter(edge => edge.data?.derived);
  assert.ok(derived.every(edge => edge.selectable === false && edge.deletable === false && edge.focusable === true));
  assert.ok(derived.every(edge => edge.domAttributes?.['aria-description']?.includes('只读') && 'aria-describedby' in edge.domAttributes!));
  assert.match(derived[0].ariaLabel!, /^‘.+’引用到‘十五分钟的城市’：写进第 3 段$/);
  const note = edges.find(edge => edge.data?.kind === 'pencil')!;
  assert.equal(note.ariaLabel, '‘开头的写法’连到‘十五分钟的城市’：改开头');
  const changes = storedEdgeChanges([{ id: derived[0].id, type: 'remove' as const }, { id: board.edges[0].id, type: 'remove' as const }]);
  assert.deepEqual(changes.map(change => change.id), [board.edges[0].id]);
  const classified = classifyStoredEdge({ source: quotes(board)[0].id, target: quotes(board)[0].data.citation!.nodeId }, new Map(board.nodes.map(node => [node.id, node])));
  assert.equal(classified.kind, 'excerpt', 'a reversed stored excerpt edge is still drawn from its source');
  assert.equal(classified.from, quotes(board)[0].data.citation!.nodeId);
  assert.equal(edgeAriaLabel({ kind: 'excerpt', from: 'x', to: 'y', label: '摘录自' }, new Map()), '从‘未命名’摘到‘未命名’');
});
