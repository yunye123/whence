import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../src/templates';
import { createNode } from '../src/board-utils';
import { validateBoard } from '../src/storage';

function fixture() {
  const board = createBoard('blank');
  const quote = createNode('quote', { x: 0, y: 0 });
  quote.data.citation = { nodeId: 'removed-source', title: '原文', text: '雨\r\n停了', textAnchor: { from: 110000, to: 110004, prefix: '旧段落', suffix: '下一段' } };
  board.nodes = [quote];
  return board;
}
test('a historical anchor beyond text import length survives source removal and preserves CRLF snapshot', () => {
  const board = fixture(), saved = validateBoard(board);
  assert.deepEqual(saved.nodes[0].data.citation, board.nodes[0].data.citation);
});
test('anchor validation rejects contradictory offsets, partial characters and unrecognized metadata', () => {
  for (const patch of [{ to: 110006 }, { from: 110000.5 }, { to: 300001 }, { prefix: '\ud800' }, { suffix: '\r' }, { extra: true }]) {
    const board = fixture(); Object.assign(board.nodes[0].data.citation!.textAnchor!, patch);
    assert.throws(() => validateBoard(board));
  }
});
test('old quotations without anchors remain compatible', () => {
  const board = fixture(); delete board.nodes[0].data.citation!.textAnchor;
  assert.equal(validateBoard(board).nodes[0].data.citation!.text, '雨\r\n停了');
});
