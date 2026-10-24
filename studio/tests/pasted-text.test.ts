import assert from 'node:assert/strict';
import test from 'node:test';
import { pastedMaterial } from '../src/app/pasted-text';

test('one paste is a video, an ordinary page, and the prose beside the links', () => {
  const text = '这是一段说明\nhttps://www.youtube.com/watch?v=abcdefghijk\nhttps://example.com/story';
  const plan = pastedMaterial(text);
  assert.equal(plan.x, false);
  assert.deepEqual(plan.videos, ['https://www.youtube.com/watch?v=abcdefghijk']);
  assert.deepEqual(plan.pages, ['https://example.com/story']);
  assert.equal(plan.note, '这是一段说明');
});

test('an X link is handled as a whole paste, and a page is not sent to it', () => {
  const plan = pastedMaterial('看看 https://x.com/someone/status/1');
  assert.equal(plan.x, true);
  assert.deepEqual(plan.pages, []);
  assert.deepEqual(plan.videos, []);
});

test('a paste with no link keeps the prose, including the line break, once the ends are trimmed', () => {
  const plan = pastedMaterial('  原始 😀 文本\r\n保留  空格  ');
  assert.deepEqual(plan.videos, []);
  assert.deepEqual(plan.pages, []);
  assert.equal(plan.note, '原始 😀 文本\r\n保留  空格');
});
