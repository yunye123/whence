import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import OutlineView, { draftOutline, moveDraftSection } from '../src/shell/OutlineView';
import { createExampleBoard } from '../src/templates';

import { getAllBy, textContent } from './helpers/markup';

const noop = () => {};

test('outline follows the draft headings and hangs each section’s citations under it', () => {
  const board = createExampleBoard('video');
  const draft = board.nodes.find(node => node.data.kind === 'draft')!;
  const sections = draftOutline(draft.data.body);
  assert.deepEqual(sections.map(section => section.heading), ['开场 00:00–00:43', '展开 00:43–01:50', '结尾 01:50–02:20']);
  assert.deepEqual(sections.map(section => section.references.length), [0, 1, 1]);
  const html = renderToStaticMarkup(createElement(OutlineView, { board, onOpenCard: noop, onImport: noop }));
  assert.ok(getAllBy(html, { className: 'outline-row' }).length >= 6);
  assert.match(textContent(html), /01:12–01:26/);
  assert.match(textContent(html), /摊主说/);
  const moved = moveDraftSection(draft.data.body, 2, 0);
  assert.deepEqual(draftOutline(moved).map(section => section.heading), ['结尾 01:50–02:20', '开场 00:00–00:43', '展开 00:43–01:50']);
  assert.equal(moved.replace(/\s/g, '').length, draft.data.body.replace(/\s/g, '').length, 'moving a section changes no characters');
  const noDraft = renderToStaticMarkup(createElement(OutlineView, { board: createExampleBoard('creative'), onOpenCard: noop, onImport: noop }));
  assert.match(textContent(noDraft), /图片/);
});
