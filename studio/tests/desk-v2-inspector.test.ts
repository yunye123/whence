import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TextReading from '../src/inspector/TextReading';
import { parseReadingDocument } from '../src/inspector/reading-markdown';
import { paragraphIndexAt } from '../src/source-location';
import Inspector from '../src/Inspector';
import { BoardContext, type BoardActions } from '../src/board-context';
import type { BoardNode } from '../src/model';
import { attr, descendants, getByLabel, textContent } from './helpers/markup';

const body = '# 原始资料🌿\n\n  空白保留 **粗体** 与 [链接](https://example.com)。\n同段第二行。\n\n> 引用\n> 原句。\n\n- 项目一\n- 项目二\n\n```txt\n  a = "🍵";\n\n  b = 2;\n```\n\n' + Array.from({ length: 100 }, (_, n) => `第${n}节，留住观察。👩🏽‍💻\t不要改写资料的文字。` .repeat(4)).join('\n\n') + '\n\n末行　 \n';

test('W3-H long Markdown, whitespace and UTF16 stay exact with overlapping traces and located ranges', () => {
  assert.ok(body.length > 8000);
  const from = body.indexOf('空白保留'), to = body.indexOf('同段第二行。') + '同段第二行。'.length;
  const html = renderToStaticMarkup(createElement(TextReading, {
    document: parseReadingDocument(body), range: { from, to },
    traces: [{ from, to, quoteIds: ['quote-a'] }, { from: from + 5, to, quoteIds: ['quote-b'] }], onSelection: () => {},
  }));
  const reading = getByLabel(html, '资料阅读正文');
  assert.equal(textContent(reading), body);
  assert.equal(textContent(getByLabel(reading, '摘录原文')), body.slice(from, to));
  assert.equal(textContent(reading).includes('已摘录'), false);
  const paragraph = descendants(reading).find(e => attr(e, 'data-provenance') === 'excerpt');
  assert.ok(paragraph);
  assert.equal(Number(attr(paragraph, 'data-para')), paragraphIndexAt(body, from));
});

test('W3-H source search stays separate from excerpt semantics and all source text remains selectable', () => {
  const from = body.indexOf('空白保留');
  const html = renderToStaticMarkup(createElement(TextReading, { document: parseReadingDocument(body), range: { from, to: from + 4 }, rangeOrigin: 'search', onSelection: () => {} }));
  const reading = getByLabel(html, '资料阅读正文');
  assert.equal(textContent(reading), body);
  assert.equal(textContent(getByLabel(reading, '搜索结果')), '空白保留');
  assert.equal(descendants(reading).some(e => attr(e, 'data-provenance') === 'excerpt'), false);
});

test('W3-H paper identity distinguishes personal notes and imported materials without changing stored kind or panel name', () => {
  for (const tags of [undefined, ['文字资料', 'Markdown']]) {
    const node: BoardNode = { id: 'material', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'note', title: '观察', body: '文字🌿。', tags } };
    const noop = () => {};
    const board: BoardActions = { nodes: [node], inspectedId: node.id, activeVideo: null, updateCard: () => true, openCard: noop, deleteCard: noop, duplicateCard: noop, addQuote: () => true, addTextQuote: () => true, focusSource: noop, openDraftSource: () => true, draftReturn: null, returnToDraft: () => true, draftRestore: null, completeDraftRestore: noop, getMediaUrl: () => undefined, playVideo: noop, videoPlaybackVersion: 0, getVideoPlayback: () => ({ time: 0, paused: true }), bindVideoPlayer: noop, captureVideoPlayback: noop, restoreVideoPlayback: noop, setPendingTranscriptEdit: noop, cancelVideoImport: noop, retryVideoImport: noop, videoImportAvailable: false, videoImportActionPending: () => false };
    const html = renderToStaticMarkup(createElement(BoardContext.Provider, { value: board }, createElement(Inspector, { node, onClose: noop, onImportSubtitles: noop, onNotify: noop })));
    const panel = getByLabel(html, tags ? '文字资料编辑面板' : '笔记编辑面板');
    assert.equal(attr(panel, 'data-kind'), 'note');
    assert.equal(attr(panel, 'data-paper'), tags ? 'plain' : 'note');
  }
});
