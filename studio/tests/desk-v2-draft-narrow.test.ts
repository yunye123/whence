import test from 'node:test';
import assert from 'node:assert/strict';
import { foldedParagraphLabel, manuscriptExcerpt, manuscriptProjection, planManuscript } from '../src/cards/draft-preview';
import type { TextOptions } from '../src/cards/text-measure';

// Grapheme-safe deterministic line seam; the actual font/wrapping runs in the Edge test.
const measure = (text: string, options: TextOptions) => {
  const count = Math.max(1, Math.floor(options.width / 16));
  const result = []; let from = 0;
  const characters = Array.from(text);
  for (let at = 0; at < characters.length; at += count) {
    const text = characters.slice(at, at + count).join('');
    result.push({ from, to: from + text.length, text }); from += text.length;
  }
  return result;
};

test('an oversized owner gets whole display lines without rewriting raw text, owners or global references', () => {
  const body = '凌晨四点😀，早餐摊已经亮着灯。'.repeat(12) + '\n\n后段。[来源：甲](field://node/s1?quote=q1)';
  const projection = manuscriptProjection(body), before = JSON.stringify(projection);
  const plan = planManuscript(projection, 152, 163, (text, options) => measure(text, options).length);
  assert.equal(plan.visible.length, 0, 'the whole-paragraph planner still folds this owner');
  const excerpt = manuscriptExcerpt(projection.paragraphs[0], 152, plan.budget, measure)!;
  assert.ok(excerpt.text && excerpt.lines >= 1);
  assert.equal(excerpt.lines, 4);
  assert.ok(excerpt.lines * 28 + 4 + 40 <= plan.budget);
  assert.ok(projection.paragraphs[0].text.startsWith(excerpt.text));
  assert.doesNotMatch(excerpt.text, /[\uD800-\uDBFF]$/u, 'no broken emoji');
  assert.equal(JSON.stringify(projection), before);
  assert.equal(manuscriptProjection(body), projection);
  assert.equal(foldedParagraphLabel(plan.folded, 1), '… 第 1 段余文 · 第 2 段');
});

test('a quoted prefix reserves its original stamp row and uses the quote font and inset', () => {
  const projection = manuscriptProjection('> ' + '引文很长，但来源仍然保持完整。'.repeat(12) + '\n\n[来源：甲](field://node/s1?quote=q1)');
  const p = projection.paragraphs[0]; assert.equal(p.quoted, true);
  const calls: TextOptions[] = [];
  const excerpt = manuscriptExcerpt(p, 152, 163, (text, options) => { calls.push(options); return measure(text, options); })!;
  assert.ok(excerpt.lines * 28 + 4 + 40 + 26 <= 163);
  assert.equal(excerpt.lines, 3);
  assert.equal(calls[0].width, 138); assert.match(calls[0].font, /^500 /);
  assert.deepEqual(p.footnotes, [1]); assert.equal(projection.footnotes[0].quoteNodeId, 'q1');
  assert.equal(foldedParagraphLabel(projection.paragraphs, 1), '… 第 1 段余文');
});

test('a fragment tail is remeasured and insufficient/deferred space stays explicit', () => {
  const p = manuscriptProjection('足够长的第一段正文需要重新检查尾巴。'.repeat(6)).paragraphs[0];
  const excerpt = manuscriptExcerpt(p, 152, 100, (text, options) => {
    const lines = measure(text, options);
    // A shortened tail can wrap into an extra row when its four-character keep moves.
    return text.length < p.text.length && lines.length === 2 ? [...lines, lines.at(-1)!] : lines;
  })!;
  assert.equal(excerpt.lines, 1);
  assert.equal(manuscriptExcerpt(p, 152, 60, measure), undefined);
  assert.equal(manuscriptExcerpt(p, 0, 163, measure), undefined);
  assert.equal(manuscriptExcerpt(p, 152, 163, null), undefined);
});
