import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { BoardStorage } from './board-storage';

export async function folderMediaResponse(storage: BoardStorage, request: Request): Promise<Response> {
  try {
    const origin = request.headers.get('Origin');
    let allowed = ''; try { const url = new URL(process.env.CANVAS_DEV_URL || ''); if (url.protocol === 'http:' && url.hostname === '127.0.0.1') allowed = url.origin; } catch {}
    if (origin && origin !== allowed) return new Response('Forbidden origin', { status: 403 });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const url = new URL(request.url); const id = decodeURIComponent(url.pathname.slice(1));
    if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(id)) return new Response('Invalid media', { status: 403 });
    const media = await storage.mediaFile(url.hostname, id);
    const headers = new Headers({ 'Content-Type': media.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    if (origin && origin === allowed) { headers.set('Access-Control-Allow-Origin', allowed); headers.set('Access-Control-Allow-Headers', 'Range'); headers.set('Vary', 'Origin'); }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    let start = 0, end = media.size - 1, status = 200;
    const range = request.headers.get('Range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416 });
      if (!match[1]) start = Math.max(0, media.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= media.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${media.size}` } });
      status = 206; headers.set('Content-Range', `bytes ${start}-${end}/${media.size}`);
    }
    headers.set('Content-Length', String(end - start + 1));
    if (request.method === 'HEAD') return new Response(null, { status, headers });
    return new Response(Readable.toWeb(createReadStream(media.file, { start, end })) as ReadableStream<Uint8Array>, { status, headers });
  } catch { return new Response('Media unavailable', { status: 404 }); }
}
