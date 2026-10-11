import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Words } from '../src/cards/Words';
import { clearTextMeasureCache, estimateLines, fitTextParagraphs, measureTextLines, segmentText, textMeasureCacheInfo, textWidthBucket } from '../src/cards/text-measure';
import { getBy, queryAll, textContent } from './helpers/markup';

// Deterministic metric fixtures test planning and caching only. Actual Chinese fonts are measured in
// the separate 200-case browser comparison; these widths never count as real layout evidence.
Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
  getContext() { return { font: '', fontKerning: '', measureText: (text: string) => ({ width: Array.from(text).length * 10 }) }; }
} });
const options = { font: '400 14px sans-serif', width: 50, mode: 'char' as const, autospace: false };

test('three break modes preserve exact source, Unicode graphemes, newlines and UTF-16 offsets', () => {
  const source = '街角（资料）里，有一句原话：Keep it.\r\n👨‍👩‍👧‍👦一起走。é';
  for (const mode of ['word', 'sentence', 'char'] as const) {
    const runs = segmentText(source, mode);
    assert.equal(runs.map(run => run.text).join(''), source);
    for (const run of runs) assert.equal(source.slice(run.from, run.to), run.text);
    const html = renderToStaticMarkup(createElement(Words, { text: source, mode }));
    assert.equal(textContent(getBy(html, { tag: 'span' })), source);
    assert.equal(queryAll(html, { tag: 'br' }).length, 0);
    assert.ok(queryAll(html, { tag: 'wbr' }).length > 0);
  }
  assert.ok(segmentText('👨‍👩‍👧‍👦', 'char').length === 1);
  assert.ok(segmentText('挣钱。', 'word').some(run => run.text === '挣钱。'), 'a short dictionary word is not split');
});

test('minRun really protects a paragraph tail; keep remains a compatible alias', () => {
  const source = '有人在街角留下这一句话。';
  const withTail = renderToStaticMarkup(createElement(Words, { text: source, mode: 'char', minRun: 4 }));
  assert.ok(textContent(getBy(withTail, { className: 'keep-together' })).length >= 4);
  assert.equal(textContent(getBy(withTail, { tag: 'span' })), source);
  assert.equal(withTail, renderToStaticMarkup(createElement(Words, { text: source, mode: 'char', keep: 4 })));
  const without = renderToStaticMarkup(createElement(Words, { text: source, mode: 'char', minRun: 0 }));
  assert.equal(queryAll(without, { className: 'keep-together' }).length, 0);
});

test('canvas estimates honour paragraphs, width, word overflow and source ranges', () => {
  assert.equal(estimateLines('', options), 0);
  assert.equal(estimateLines('一二三四五六七八九十', options), 2);
  assert.equal(estimateLines('一二三\n四五', options), 2);
  assert.equal(estimateLines('一二三\n\n四五', options), 3);
  assert.equal(estimateLines('一二三四五六', { ...options, mode: 'word' }), 2);
  const source = '一二三\r\n四五六七八九';
  for (const line of measureTextLines(source, options)) assert.equal(source.slice(line.from, line.to), line.text);
  assert.throws(() => estimateLines('文', { ...options, width: 0 }), RangeError);
  assert.throws(() => estimateLines('文', { ...options, font: 'var(--type-card-body)' }), TypeError);
});

test('CSS whitespace modes preserve raw offsets while selecting hard/soft line opportunities', () => {
  const text = '一二三\n四五六';
  assert.equal(estimateLines(text, { ...options, width: 100, whiteSpace: 'normal' }), 1);
  assert.equal(estimateLines(text, { ...options, width: 100, whiteSpace: 'pre-wrap' }), 2);
  assert.equal(estimateLines('一二三四五六七八九十', { ...options, whiteSpace: 'pre' }), 1);
  assert.equal(estimateLines('一二三\n', options), 1);
  assert.equal(estimateLines('   ', { ...options, whiteSpace: 'normal' }), 0);
});

test('whole paragraph budget returns an unmodified source prefix with omission metadata', () => {
  const source = '一二三\n四五六七八九\n末段';
  const fit = fitTextParagraphs(source, options, 2);
  assert.equal(fit.text, '一二三\n');
  assert.equal(source.slice(0, fit.end), fit.text);
  assert.equal(fit.omitted, 2);
  assert.equal(fit.lines, 1);
});

test('bounded LRU is keyed by source, resolved font, precise width bucket and mode', () => {
  clearTextMeasureCache();
  const first = measureTextLines('一二三四五六', options);
  assert.equal(measureTextLines('一二三四五六', { ...options }), first);
  assert.notEqual(measureTextLines('一二三四五六', { ...options, font: '500 16px serif' }), first);
  assert.notEqual(measureTextLines('一二三四五六', { ...options, width: 40 }), first);
  assert.notEqual(measureTextLines('一二三四五六', { ...options, mode: 'word' }), first);
  assert.notEqual(measureTextLines('一二三四五六', { ...options, letterSpacing: .48 }), first);
  assert.notEqual(measureTextLines('一二三四五六', { ...options, whiteSpace: 'normal' }), first);
  assert.equal(textWidthBucket(50.001), 50);
  for (let index = 0; index < 1250; index++) estimateLines(`文本${index}`, options);
  assert.equal(textMeasureCacheInfo().lines, textMeasureCacheInfo().limit);
});
