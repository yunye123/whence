import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../src/templates';
import { AGENT_READ, AGENT_WRITE, agentBoardLink, agentBoardView, applyAgentEdit } from '../src/agent-board';

test('the local link tells an agent how to read and how to write the live canvas', () => {
  const board = createBoard('blank');
  const link = agentBoardLink('http://127.0.0.1:5189/', board.id);
  assert.equal(link, `http://127.0.0.1:5189/agent/boards/${board.id}`);
  const view = agentBoardView(board, link);
  assert.equal(view.board, board);
  assert.match(view.read.join('\n'), /GET/);
  assert.match(view.read.join('\n'), /data\.body/);
  assert.match(view.write.join('\n'), /PUT/);
  assert.match(view.write.join('\n'), /updatedAt/);
  assert.ok(AGENT_READ.length >= 5);
  assert.ok(AGENT_WRITE.some(line => line.includes('明确要求修改')));
  assert.throws(() => agentBoardLink('https://example.com', board.id), /桌面版/);
});

test('a requested edit keeps the live canvas identity and rejects a stale copy', () => {
  const board = createBoard('blank');
  const saved = { ...board, viewport: { x: 12, y: 34, zoom: 1.5 }, storage: { id: 'folder-1', directory: 'D:\\boards\\live' } };
  const edited = { ...board, title: '智能体整理后的标题', viewport: { x: 0, y: 0, zoom: 1 }, storage: { id: 'other', directory: 'D:\\somewhere-else' } };
  const decision = applyAgentEdit(saved, { read: AGENT_READ, write: AGENT_WRITE, board: edited });
  assert.equal(decision.kind, 'apply');
  if (decision.kind !== 'apply') return;
  assert.equal(decision.board.title, '智能体整理后的标题');
  assert.deepEqual(decision.board.viewport, saved.viewport);
  assert.deepEqual(decision.board.storage, saved.storage);
  assert.equal(applyAgentEdit(saved, { ...edited, updatedAt: '2026-10-25T02:00:00.000Z' }).kind, 'conflict');
  assert.equal(applyAgentEdit(saved, { ...edited, id: 'other-board' }).kind, 'invalid');
  assert.equal(applyAgentEdit(board, '{').kind, 'invalid');
});
