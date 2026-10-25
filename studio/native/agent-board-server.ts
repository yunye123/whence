import http from 'node:http';

const UUID = /^\/agent\/boards\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const BODY_LIMIT = 20 * 1024 * 1024;

export interface AgentBoardReply { status: number; body: string }

/** Loopback bridge. The open canvas answers; this server does not keep a copy. */
export function startAgentBoardServer(ask: (boardId: string, method: 'GET' | 'PUT', body: string) => Promise<AgentBoardReply>): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    void handle(request, response, ask);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { reject(new Error('本地地址没有打开。')); return; }
      resolve({
        port: address.port,
        close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())),
      });
    });
  });
}

export async function registerAgentPort(pageUrl: string, token: string, port: number): Promise<void> {
  const endpoint = new URL('/__field_launcher__/agent-port', pageUrl);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') throw new Error('本地地址没有接上。');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-field-launch-token': token },
    body: JSON.stringify({ port }),
  });
  if (!response.ok) throw new Error('本地地址没有接上。');
}

async function handle(request: http.IncomingMessage, response: http.ServerResponse, ask: (boardId: string, method: 'GET' | 'PUT', body: string) => Promise<AgentBoardReply>): Promise<void> {
  if (!isLoopback(request.socket.remoteAddress)) { send(response, 403, '{"error":"只接受本机访问。"}'); return; }
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  const match = UUID.exec(pathname);
  if (!match || (request.method !== 'GET' && request.method !== 'PUT')) {
    send(response, 404, '{"error":"请使用来处导出里复制的本地链接。GET 读取，PUT 写入。"}');
    return;
  }
  try {
    const body = request.method === 'PUT' ? await readBody(request) : '';
    const answer = await ask(match[1], request.method, body);
    const status = Number.isInteger(answer.status) ? answer.status : 500;
    const text = typeof answer.body === 'string' ? answer.body : '{"error":"没有读成。"}';
    if (Buffer.byteLength(text) > BODY_LIMIT) { send(response, 413, '{"error":"这张画布的文字太大，链接一次读不完。"}'); return; }
    send(response, status, text);
  } catch (error) {
    const message = error instanceof Error ? error.message : '没有读成。';
    send(response, message === '内容太大。' ? 413 : 500, JSON.stringify({ error: message }));
  }
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > BODY_LIMIT) { reject(new Error('内容太大。')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', () => reject(new Error('没有读成。')));
  });
}

function send(response: http.ServerResponse, status: number, body: string): void {
  if (response.writableEnded) return;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}
