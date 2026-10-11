import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoardContext, type BoardActions } from '../src/board-context';
import { createExampleBoard } from '../src/templates';
import ScriptView from '../src/inspector/script-view/ScriptView';
import { PRINT_FONTS_FALLBACK, PRINT_PALETTE_FALLBACK, scriptPrintHtml, scriptSource, scriptSummaryText } from '../src/inspector/script-view/script-export';
import { printPalette } from '../src/inspector/script-view/script-print';
import { draftParagraphIndexAt } from '../src/source-location';
import { isScriptLine } from '../src/inspector/script-view/script-model';

test('W3-J print uses fixed white paper, neutral ink and Zhu frames in SSR', () => {
  assert.deepEqual(PRINT_PALETTE_FALLBACK, {
    ink: 'rgb(34, 31, 27)', ink2: 'rgb(72, 69, 63)', ink3: 'rgb(89, 85, 79)',
    rule: 'rgba(38, 38, 38, 0.12)', ruleStrong: 'rgba(38, 38, 38, 0.24)',
    source: 'rgb(72, 69, 63)', tag: 'rgb(165, 39, 26)', tagOn: 'rgb(34, 31, 27)',
    paper: 'rgb(255, 255, 255)', sunken: 'rgb(242, 241, 238)',
  });
  assert.deepEqual(printPalette(), PRINT_PALETTE_FALLBACK);
  assert.match(PRINT_FONTS_FALLBACK.sans, /^'Noto Sans SC Variable'/);
  assert.match(PRINT_FONTS_FALLBACK.num, /^'IBM Plex Mono'/);
});

test('W3-J print has solid provenance icons, manuscript rules, ink footnotes, intact source indices', () => {
  const board = createExampleBoard('video');
  const draft = board.nodes.find(n => n.data.kind === 'draft')!;
  const before = JSON.stringify(board);
  const { model, references } = scriptSource(draft.data.body, board.nodes);
  const html = scriptPrintHtml({ title: draft.data.title, model, references, pictures: new Map(), date: '2026 年 10 月 10 日' });
  assert.match(html, /data-provenance-icon="video"/);
  assert.doesNotMatch(html, /fill-rule="evenodd"|M18 0H7\.5/);
  assert.match(html, /border: \.5pt solid var\(--tag\)/);
  assert.match(html, /\.tag__body[^}]+color: var\(--ink\)/);
  assert.match(html, /\.words sup[^}]+color: var\(--ink-2\)/);
  assert.match(html, /\.doc::after/);
  assert.match(html, /共 <b>3<\/b> 场 <b>9<\/b> 行，成片约 <b>2:20<\/b>/);
  assert.match(html, /<th>旁白<\/th>/);
  assert.doesNotMatch(html, /口播|field:\/\/|<script/i);
  assert.deepEqual(references.map(r => r.index), [1, 2]);
  assert.equal(JSON.stringify(board), before);
});

test('W3-J sources use paragraph stamps for text, retain encoded removed-video locations', () => {
  const board = createExampleBoard('writing');
  const draft = board.nodes.find(n => n.data.kind === 'draft')!;
  const { model, references } = scriptSource(draft.data.body, board.nodes);
  const html = scriptPrintHtml({ title: draft.data.title, model, references, pictures: new Map(), date: '今天' });
  assert.match(html, /data-provenance-icon="text"/);
  for (const reference of references) assert.ok(html.includes(`value="${reference.index}"`));
  const video = createExampleBoard('video');
  const videoDraft = video.nodes.find(n => n.data.kind === 'draft')!;
  const present = scriptSource(videoDraft.data.body, video.nodes);
  const removed = scriptSource(videoDraft.data.body, video.nodes.filter(n => n.data.kind === 'draft'));
  const goneHtml = scriptPrintHtml({ title: draft.data.title, ...removed, pictures: new Map(), date: '今天' });
  assert.match(goneHtml, /tag--gone/);
  assert.deepEqual(removed.references.map(r => r.index), present.references.map(r => r.index));
  // With the source gone, the URL retains its start; the lost quote's end is not fabricated.
  assert.deepEqual(removed.references.map(r => r.location), ['01:12', '01:38']);
  assert.equal(removed.references.every(r => !r.source), true);
  assert.match(goneHtml, /来源卡片已不在画布上/);
});

test('W3-J screen retains narration and full-draft numbering in editable and read-only views', () => {
  const board = createExampleBoard('video');
  const draft = board.nodes.find(n => n.data.kind === 'draft')!;
  const { model, references } = scriptSource(draft.data.body, board.nodes);
  const noop = () => {};
  for (const readOnly of [false, true]) {
    const context = { nodes: board.nodes, getMediaUrl: () => undefined, readOnly } as unknown as BoardActions;
    const html = renderToStaticMarkup(createElement(BoardContext.Provider, { value: context }, createElement(ScriptView, {
      model, references, nodes: board.nodes, readOnly, actions: { open: noop, openSource: noop, edit: noop, showBody: noop },
    })));
    assert.match(html, /role="columnheader" class="draft-script__words">旁白/);
    assert.match(html, /data-provenance-icon="video"/);
    assert.match(html, /tag--stamp/);
    if (readOnly) assert.doesNotMatch(html, /<button[^>]+draft-script__fill/);
    assert.equal(scriptSummaryText(model), '共 3 场 9 行，成片约 2:20');
    for (const line of model.scenes.flatMap(s => s.rows.filter(isScriptLine))) {
      assert.equal(line.number, draftParagraphIndexAt(draft.data.body, line.caret));
      for (const part of line.segments) if ('text' in part) assert.ok(html.includes(part.text), part.text);
    }
  }
});

test('W3-J only uses dedicated print tokens, no legacy source palette or continuous viewport subscription', () => {
  const print = readFileSync(new URL('../src/inspector/script-view/script-print.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(print, /read\('--(?:source-|fg-|bg-|border-)/);
  for (const token of ['paper', 'sunken', 'ink', 'ink-2', 'ink-3', 'rule', 'rule-strong', 'zhu']) assert.ok(print.includes(`--print-${token}`));
  const css = ['inspector-script.css', 'inspector-script-tail.css'].map(name => readFileSync(new URL(`../src/styles/features/${name}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(css, /var\(--(?:source-|light-|trace-walk|bg-surface|bg-elevated)/);
  assert.match(css, /var\(--paper-manuscript\)/);
  assert.match(css, /var\(--radius-photo\)/);
  assert.match(css, /\.draft-script__scene-title[^}]+var\(--font-ui\)/);
  const shot = readFileSync(new URL('../src/inspector/script-view/ShotFrame.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(shot, /useViewport|useReactFlow|ResizeObserver|getBoundingClientRect/);
});
