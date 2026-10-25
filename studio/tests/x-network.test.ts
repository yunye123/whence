import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { fetchXResource, parseFxTwitterResponse } from '../native/x-import';
import { openXPublicResponse, validateXResourceUrl, isPublicXAddress, type XPublicRequestOptions } from '../native/x-public-request';

const imageUrl = 'https://pbs.twimg.com/media/photo.png';
const metadataUrl = 'https://api.fxtwitter.com/2/status/2104200939095904322';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const publicDNS = async () => [{ address: '1.1.1.1', family: 4 }];
interface MockResponse { chunks?: Uint8Array[]; status?: number; headers?: Record<string, string>; stream?: Readable }
function direct(responses: MockResponse[], pinned?: string[]): XPublicRequestOptions['request'] {
  return (_url, options, callback) => {
    const req = new EventEmitter() as ClientRequest;
    req.setTimeout = (() => req) as typeof req.setTimeout;
    req.destroy = ((error?: Error) => { if (error) queueMicrotask(() => req.emit('error', error)); return req; }) as typeof req.destroy;
    req.end = (() => {
      if (pinned) (options.lookup as (host: string, opts: { all: boolean }, cb: (error: unknown, addresses: { address: string }[]) => void) => void)('pbs.twimg.com', { all: true }, (_error, addresses) => pinned.push(addresses[0].address));
      const specification = responses.shift();
      if (!specification) throw new Error('unexpected network call');
      const response = (specification.stream || Readable.from(specification.chunks || [png])) as IncomingMessage;
      response.statusCode = specification.status || 200;
      response.headers = specification.headers || { 'content-type': 'image/png', 'content-length': String(png.length) };
      const aborted = () => response.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      options.signal?.addEventListener('abort', aborted, { once: true });
      response.on('close', () => options.signal?.removeEventListener('abort', aborted));
      queueMicrotask(() => callback(response)); return req;
    }) as typeof req.end;
    return req;
  };
}
test('only exact HTTPS provider and CDN hosts without credentials or foreign ports are accepted', () => {
  assert.equal(validateXResourceUrl(metadataUrl, 'metadata').hostname, 'api.fxtwitter.com');
  assert.equal(validateXResourceUrl(imageUrl, 'image').hostname, 'pbs.twimg.com');
  assert.equal(validateXResourceUrl('https://video.twimg.com/a.mp4', 'video').hostname, 'video.twimg.com');
  for (const value of ['https://pbs.twimg.com.evil.test/a.png', 'http://pbs.twimg.com/a.png', 'https://a:b@pbs.twimg.com/a.png', 'https://pbs.twimg.com:3000/a.png', 'https://127.0.0.1/a.png', 'https://pbs.twimg.com@evil.test/a.png']) assert.throws(() => validateXResourceUrl(value, 'image'));
  assert.throws(() => validateXResourceUrl(imageUrl, 'metadata'));
});
test('public address check rejects private, loopback, mapped IPv6 and special/documentation ranges', () => {
  for (const address of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '198.18.0.1', '192.0.2.1', '198.51.100.2', '203.0.113.2', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::1', 'localhost']) assert.equal(isPublicXAddress(address), false, address);
  assert.equal(isPublicXAddress('1.1.1.1'), true); assert.equal(isPublicXAddress('2606:4700::1111'), true);
});
test('direct public socket pins the validated address and validates actual image bytes', async () => {
  const pinned: string[] = [];
  const result = await fetchXResource(imageUrl, 'image', 1024, { lookup: publicDNS, request: direct([{}], pinned) });
  assert.deepEqual(pinned, ['1.1.1.1']); assert.equal(result.mime, 'image/png'); assert.deepEqual(Buffer.from(result.data), png);
});
test('DNS mixed public/private records and family mismatch fail before any socket opens', async () => {
  let opened = false;
  for (const records of [[{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }], [{ address: '2606:4700::1111', family: 4 }], []]) {
    await assert.rejects(fetchXResource(imageUrl, 'image', 1024, { lookup: async () => records, request: () => { opened = true; throw new Error('should not request'); } }), /非公开/);
  }
  assert.equal(opened, false);
});
test('every redirect is revalidated, and local or foreign redirect never opens another socket', async () => {
  for (const location of ['http://127.0.0.1/private', 'https://evil.test/a.png', 'https://pbs.twimg.com:123/a.png']) {
    await assert.rejects(fetchXResource(imageUrl, 'image', 1024, { lookup: publicDNS, request: direct([{ status: 302, headers: { location } }]) }), /允许/);
  }
  let lookups = 0;
  await assert.rejects(fetchXResource(imageUrl, 'image', 1024, { lookup: async () => ++lookups === 1 ? [{ address: '1.1.1.1', family: 4 }] : [{ address: '127.0.0.1', family: 4 }], request: direct([{ status: 302, headers: { location: '/media/next.png' } }]) }), /非公开/);
  assert.equal(lookups, 2);
});
test('same CDN redirect succeeds and reports direct transport while redirect loops are bounded', async () => {
  const response = await openXPublicResponse(imageUrl, { purpose: 'image', lookup: publicDNS, request: direct([{ status: 302, headers: { location: '/media/next.png' } }, {}]) });
  assert.equal(response.transport, 'direct-dns-pinned'); const chunks = []; for await (const chunk of response.body) chunks.push(chunk); assert.equal(Buffer.concat(chunks).length, png.length); response.dispose();
  await assert.rejects(fetchXResource(imageUrl, 'image', 1024, { lookup: publicDNS, request: direct(Array.from({ length: 6 }, () => ({ status: 302, headers: { location: imageUrl } }))) }), /重定向过多/);
});
test('MIME mismatch, forged signatures, compressed body and unsuccessful HTTP status fail honestly', async () => {
  const cases: MockResponse[] = [
    { headers: { 'content-type': 'text/html' } },
    { chunks: [Buffer.from('<html>login</html>')], headers: { 'content-type': 'image/png' } },
    { headers: { 'content-type': 'image/png', 'content-encoding': 'gzip' } },
    { status: 403 },
  ];
  for (const response of cases) await assert.rejects(fetchXResource(imageUrl, 'image', 1024, { lookup: publicDNS, request: direct([response]) }));
});
test('declared and actual size caps and truncated content are enforced without local-looking success', async () => {
  const cases: MockResponse[] = [
    { headers: { 'content-type': 'image/png', 'content-length': '2000' } },
    { chunks: [Buffer.alloc(1100)], headers: { 'content-type': 'image/png' } },
    { headers: { 'content-type': 'image/png', 'content-length': String(png.length + 1) } },
    { chunks: [], headers: { 'content-type': 'image/png' } },
    { headers: { 'content-type': 'image/png', 'content-length': '-1' } },
  ];
  for (const response of cases) await assert.rejects(fetchXResource(imageUrl, 'image', 1024, { lookup: publicDNS, request: direct([response]) }));
});
test('cancellation interrupts DNS and active image stream instead of waiting for a fake success', async () => {
  const dnsController = new AbortController();
  const dns = fetchXResource(imageUrl, 'image', 1024, { signal: dnsController.signal, lookup: () => new Promise(() => {}) });
  const dnsRejected = assert.rejects(dns, { name: 'AbortError' }); dnsController.abort(); await dnsRejected;
  const bodyController = new AbortController(), stream = new Readable({ read() {} });
  const body = fetchXResource(imageUrl, 'image', 1024, { signal: bodyController.signal, lookup: publicDNS, request: direct([{ stream }]) });
  const bodyRejected = assert.rejects(body, { name: 'AbortError' }); await new Promise(resolve => setImmediate(resolve)); bodyController.abort(); await bodyRejected;
  assert.equal(stream.destroyed, true);
});
test('absolute timeout bounds stalled DNS resolution', async () => {
  const interval = setInterval(() => {}, 50);
  try { await assert.rejects(fetchXResource(imageUrl, 'image', 1024, { timeoutMs: 20, lookup: () => new Promise(() => {}) }), /超时/); }
  finally { clearInterval(interval); }
});
test('existing system proxy transport uses no session cookies and manual redirect without claiming DNS socket pin', async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const proxyTransport = { fetch: async (url: string, options: RequestInit) => { calls.push({ url, options }); return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'content-length': String(png.length) } }); } };
  const response = await openXPublicResponse(imageUrl, { purpose: 'image', lookup: publicDNS, proxyTransport });
  assert.equal(response.transport, 'electron-system-proxy'); for await (const _chunk of response.body) { /* consume real stream mock */ } response.dispose();
  assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.redirect, 'manual'); assert.equal(calls[0].url, imageUrl);
});
test('system proxy path still validates private DNS and redirect hosts before contacting proxy', async () => {
  let calls = 0;
  const proxyTransport = { fetch: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }); } };
  await assert.rejects(fetchXResource(imageUrl, 'image', 1024, { lookup: async () => [{ address: '127.0.0.1', family: 4 }], proxyTransport }), /非公开/); assert.equal(calls, 0);
  await assert.rejects(fetchXResource(imageUrl, 'image', 1024, { lookup: publicDNS, proxyTransport }), /允许/); assert.equal(calls, 1);
});
test('metadata stream requires JSON format and returns bounded actual bytes', async () => {
  const json = Buffer.from('{"code":404,"status":null}');
  const result = await fetchXResource(metadataUrl, 'metadata', 1024, { lookup: publicDNS, request: direct([{ chunks: [json], headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': String(json.length) } }]) });
  assert.equal(Buffer.from(result.data).toString(), json.toString());
  await assert.rejects(fetchXResource(metadataUrl, 'metadata', 5, { lookup: publicDNS, request: direct([{ chunks: [json], headers: { 'content-type': 'application/json' } }]) }), /正文响应过大/);
});
test('an X article keeps its cover and inline pictures in the text', () => {
  const post = parseFxTwitterResponse({
    code: 200,
    status: {
      id: '2104200939095904322', text: '短', author: { name: '作者', screen_name: 'creator' },
      article: {
        title: '一篇文章',
        cover_media: { type: 'photo', url: 'https://pbs.twimg.com/media/cover.jpg' },
        content: {
          blocks: [
            { text: '开头', type: 'unstyled', entityRanges: [] },
            { text: ' ', type: 'unstyled', entityRanges: [{ offset: 0, length: 1, key: 0 }] },
          ],
          entityMap: { 0: { type: 'MEDIA', data: { mediaItems: [{ mediaId: 'm1' }] } } },
        },
        media_entities: [{ media_id: 'm1', type: 'photo', url: 'https://pbs.twimg.com/media/inline.jpg', alt_text: '文中的图' }],
      },
    },
  }, 'https://x.com/creator/status/2104200939095904322');
  assert.match(post.text, /^!\[文章封面：一篇文章\]\(https:\/\/pbs\.twimg\.com\/media\/cover\.jpg\?name=orig\)/);
  assert.match(post.text, /!\[文中的图\]\(https:\/\/pbs\.twimg\.com\/media\/inline\.jpg\?name=orig\)/);
  assert.ok(post.text.indexOf('cover.jpg') < post.text.indexOf('开头'));
  assert.ok(post.text.indexOf('开头') < post.text.indexOf('inline.jpg'));
  assert.deepEqual(post.media.map(item => item.kind), ['image', 'image']);
});
