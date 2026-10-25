import test from 'node:test';
import assert from 'node:assert/strict';
import { startAgentBoardServer } from '../native/agent-board-server';

const boardId = '11111111-1111-4111-8111-111111111111';

test('the local link reads and writes through the open canvas, without storing a copy', async () => {
  const seen: { method: string; body: string }[] = [];
  const server = await startAgentBoardServer(async (id, method, body) => {
    seen.push({ method, body });
    assert.equal(id, boardId);
    if (method === 'GET') return { status: 200, body: JSON.stringify({ read: ['用 GET 请求这个链接。'], write: ['用 PUT 把整个 board 送回这个链接。'], board: { id } }) };
    return { status: 200, body };
  });
  try {
    const read = await fetch(`http://127.0.0.1:${server.port}/agent/boards/${boardId}`);
    const view = await read.json() as { read: string[]; write: string[]; board: { id: string } };
    assert.equal(read.status, 200);
    assert.match(view.read.join('\n'), /GET/);
    assert.match(view.write.join('\n'), /PUT/);
    assert.equal(view.board.id, boardId);
    const write = await fetch(`http://127.0.0.1:${server.port}/agent/boards/${boardId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"id":"11111111-1111-4111-8111-111111111111"}' });
    assert.equal(write.status, 200);
    assert.equal(seen[1]?.body, '{"id":"11111111-1111-4111-8111-111111111111"}');
    const missing = await fetch(`http://127.0.0.1:${server.port}/agent/boards`);
    assert.equal(missing.status, 404);
    const text = await missing.json() as { error: string };
    assert.match(text.error, /GET/);
    assert.match(text.error, /PUT/);
  } finally { await server.close(); }
});
