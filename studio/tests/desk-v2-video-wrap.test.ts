import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runBreaks, sentenceNodes, transcriptRuns } from '../src/inspector/transcript-wrap';
import { getAllBy, textContent } from './helpers/markup';

test('search across several wrap points remains one mark and preserves every source character', () => {
  for (const text of ['四点出摊，不是为了赚钱。', '先在 Premiere Pro 里剪辑，保留 4K 原片。', '原句 & < > “引号” 😀\r\n第二行。']) {
    const runs = transcriptRuns(text, 12);
    assert.equal(runs?.join('') ?? text, text);
    const needle = text.slice(1, -1).toLocaleLowerCase();
    const html = renderToStaticMarkup(createElement(Fragment, null, sentenceNodes(text, needle, runBreaks(runs))));
    assert.equal(textContent(html), text);
    assert.equal(getAllBy(html, { tag: 'mark' }).length, 1);
    assert.equal(textContent(getAllBy(html, { tag: 'mark' })[0]), text.slice(1, -1));
  }
});

test('Noto Sans narrow and wide Latin clauses choose different fitting runs without splitting Latin words', () => {
  const narrow = transcriptRuns('现在iiiiiiiiii，继续看下一句。', 12)!;
  const wide = transcriptRuns('现在WWWWWWWWWW，继续看下一句。', 12)!;
  assert.ok(narrow.includes('现在iiiiiiiiii，'), 'narrow Latin letters fit the clause');
  assert.ok(!wide.includes('现在WWWWWWWWWW，'), 'wide Latin capitals do not fit that same clause');
  assert.ok(wide.some(run => run.includes('WWWWWWWWWW')), 'Latin words are never split by the planner');
});
