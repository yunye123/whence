import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import CanvasSelectionTools, { type CanvasSelectionToolsProps } from '../src/CanvasSelectionTools';
import { createNode } from '../src/board-utils';
import { assertNone, attr, getByLabel, getByRole, isButton, isDisabled, mentions, textContent } from './helpers/markup';

// Behaviour contracts only: toolbar role and name, menu buttons with aria-haspopup/aria-expanded,
// disabled state with an explained reason, visible selection count. Attribute order, the `title`
// attribute as the carrier of the disabled reason and exact wording are not asserted (EN-M2, map-tests §3.2):
// the reason only has to be present in the toolbar (text, title, aria-description, …).

const nodes = [createNode('note'), createNode('video'), createNode('image')];
function render(props: Partial<CanvasSelectionToolsProps> = {}) {
  // The toolbar follows the React Flow viewport, so it renders inside the provider like it does in App.
  return renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(CanvasSelectionTools, {
    nodes, selectedIds: nodes.map(node => node.id), readOnly: false,
    onOpen: () => {}, onDelete: () => {}, onDuplicate: () => {}, onConnect: () => {}, onResize: () => {}, onAlign: () => {}, onViewSelected: () => {}, ...props,
  })));
}

function menuButton(html: string, label: string) {
  const button = getByLabel(html, label);
  assert.ok(isButton(button), `${label} is a button`);
  assert.equal(attr(button, 'aria-haspopup'), 'menu', `${label} announces a menu`);
  return button;
}

test('multiple selection exposes compact labelled alignment and arrangement menus instead of a long action strip', () => {
  const html = render();
  const toolbar = getByRole(html, 'toolbar', '整理选中卡片');
  for (const label of ['对齐选中卡片', '排列选中卡片']) {
    const button = menuButton(html, label);
    assert.equal(attr(button, 'aria-expanded'), 'false', `${label} starts collapsed`);
    assert.equal(isDisabled(button), false, `${label} is usable for an ordinary multi-selection`);
  }
  assert.match(textContent(toolbar), /3\s*张/, 'the selected count is visible');
  assert.doesNotMatch(textContent(html), /靠左对齐|横向排列/, 'menus are collapsed by default');
});

test('read-only and selections containing frames keep arrangement actions disabled', () => {
  const readOnly = render({ readOnly: true });
  for (const label of ['对齐选中卡片', '排列选中卡片']) assert.ok(isDisabled(menuButton(readOnly, label)), `${label} is disabled when read-only`);
  assert.ok(mentions(readOnly, '当前窗口只读'), 'the read-only reason is explained');
  const frame = createNode('frame'), combined = [...nodes, frame];
  const grouped = render({ nodes: combined, selectedIds: combined.map(node => node.id) });
  assert.ok(isDisabled(menuButton(grouped, '对齐选中卡片')));
  assert.ok(mentions(grouped, '请选择至少两张普通卡片'), 'the frame restriction is explained');
});

test('single text-card selection retains the labelled editing and more-action controls', () => {
  const html = render({ selectedIds: [nodes[0].id] });
  assert.ok(isButton(getByRole(html, 'button', '打开编辑')));
  menuButton(html, '更多选中卡片操作');
  assertNone(html, { label: /^(对齐|排列)选中卡片$/ }, 'positive control: the multi-selection render above');
  assert.equal(render({ selectedIds: [] }), '');
});
