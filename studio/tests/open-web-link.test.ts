import test from 'node:test';
import assert from 'node:assert/strict';
import { openWebLink } from '../src/cards/open-web-link';

test('桌面版：通过桌面桥打开，不使用 window.open', async () => {
  const calls: string[] = [];
  const opened: string[] = [];
  const ok = await openWebLink('https://x.com/a/status/1', {
    external: async url => { calls.push(url); },
    fallbackOpen: url => { opened.push(url); },
    notify: message => { throw new Error('不应提示：' + message); },
  });
  assert.equal(ok, true);
  assert.deepEqual(calls, ['https://x.com/a/status/1']);
  assert.deepEqual(opened, []);
});

test('普通浏览器：没有桌面桥时退回 window.open', async () => {
  const opened: string[] = [];
  const ok = await openWebLink('https://example.com/', {
    fallbackOpen: url => { opened.push(url); },
    notify: () => { throw new Error('不应提示'); },
  });
  assert.equal(ok, true);
  assert.deepEqual(opened, ['https://example.com/']);
});

test('桌面桥失败时给出提示而不是静默', async () => {
  const messages: string[] = [];
  const ok = await openWebLink('ftp://bad', {
    external: async () => { throw new Error('仅允许打开网页链接'); },
    fallbackOpen: () => { throw new Error('不应退回 window.open'); },
    notify: message => { messages.push(message); },
  });
  assert.equal(ok, false);
  assert.deepEqual(messages, ['打开网页失败：仅允许打开网页链接']);
});
