import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, validateBoard } from '../src/storage';
import { createExampleBoard } from '../src/templates';
import { collectedLine } from '../src/inspector/TextSourceSection';
import type { BoardNode } from '../src/model';

const card = (data: Record<string, unknown>): BoardNode => ({ id: 'n1', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'note', title: '资料', body: '正文', ...data } as BoardNode['data'] });

test('collectedAt (INSP-21) is stored as an ISO UTC time and refused in any other shape', () => {
  const board = { ...createBoard('blank'), nodes: [card({ collectedAt: '2026-10-02T14:15:00.000Z' })] };
  assert.equal(validateBoard(board).nodes[0].data.collectedAt, '2026-10-02T14:15:00.000Z');
  assert.throws(() => validateBoard({ ...board, nodes: [card({ collectedAt: '10 月 2 日' })] }), /收进时间/);
  assert.throws(() => validateBoard({ ...board, nodes: [card({ collectedAt: 1791316447629 })] }));
});

test('the example long read says when it was collected; the notes and the draft do not', () => {
  const board = createExampleBoard('writing');
  const article = board.nodes.find(node => node.data.title === '步行十五分钟，能到达什么');
  assert.ok(article?.data.collectedAt);
  assert.match(collectedLine(article.data.collectedAt, new Date('2026-10-07T00:00:00Z')) ?? '', /^10 月 \d+ 日 \d+:\d{2} 收进这块画布$/);
  for (const node of board.nodes) if (node.data.kind === 'draft' || node.data.kind === 'quote') assert.equal(node.data.collectedAt, undefined, node.data.title);
});
