import assert from 'node:assert/strict';
import test from 'node:test';
import { infoDescription } from '../native/download';
import { assertPublicPageUrl } from '../native/web-page';

test('a private or credentialled page is refused before any connection', () => {
  assert.throws(() => assertPublicPageUrl('http://127.0.0.1/secret'), /公开网络/);
  assert.throws(() => assertPublicPageUrl('http://user:pw@example.com/a'), /公开网络/);
  assert.throws(() => assertPublicPageUrl('file:///tmp/page.html'), /公开网络/);
  assert.equal(assertPublicPageUrl('https://example.com/a').hostname, 'example.com');
});

test('a video description is trimmed and is not part of the download source object', () => {
  assert.equal(infoDescription({ description: '  hello\u0000 world  ' }), 'hello world');
  assert.equal(infoDescription({ description: '   ' }), undefined);
  assert.equal(infoDescription(null), undefined);
  assert.equal(infoDescription({ description: 'x'.repeat(20_001) })?.length, 20_000);
});
