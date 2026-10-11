import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import { Menu, MenuItem, MenuSection, MenuSeparator, computeMenuPosition, nextMenuIndex, typeaheadIndex } from '../src/components/Menu';
import CanvasToolbar from '../src/shell/CanvasToolbar';
import ZoomControls from '../src/shell/ZoomControls';
import CanvasContextMenu from '../src/shell/CanvasContextMenu';
import { assertNone, attr, getBy, getByRole, hasClass, isDisabled, queryAll, textContent } from './helpers/markup';

const noop = () => {};

test('menu position: element anchors open on the requested side and flip when there is no room', () => {
  const viewport = { width: 1440, height: 900 };
  const size = { width: 248, height: 380 };
  const add = { left: 871, top: 841, width: 70, height: 36 };
  // Above the “添加” button, 10px away, left edge 8px left of the button.
  assert.deepEqual(computeMenuPosition(add, size, viewport, { placement: 'top-start', offset: 10, alignOffset: -8 }), { left: 863, top: 451, side: 'top' });
  // A trigger near the top flips below.
  assert.equal(computeMenuPosition({ left: 100, top: 40, width: 32, height: 32 }, size, viewport, { placement: 'top-start' }).side, 'bottom');
  // Never closer than 8px to the viewport edge.
  const right = computeMenuPosition({ left: 1420, top: 600, width: 20, height: 20 }, size, viewport, { placement: 'top-start' });
  assert.equal(right.left, 1440 - 248 - 8);
});

test('menu position: a pointer anchor flips left and up by the real size', () => {
  const viewport = { width: 1000, height: 700 };
  const size = { width: 220, height: 260 };
  assert.deepEqual(computeMenuPosition({ x: 300, y: 200 }, size, viewport), { left: 300, top: 200, side: 'bottom' });
  assert.deepEqual(computeMenuPosition({ x: 900, y: 650 }, size, viewport), { left: 680, top: 390, side: 'top' });
});

test('menu keyboard helpers wrap and type-ahead skips to the next match', () => {
  assert.equal(nextMenuIndex('ArrowDown', 3, 4), 0);
  assert.equal(nextMenuIndex('ArrowUp', 0, 4), 3);
  assert.equal(nextMenuIndex('Home', 2, 4), 0);
  assert.equal(nextMenuIndex('End', 0, 4), 3);
  assert.equal(nextMenuIndex('ArrowDown', -1, 4), 0);
  const keys = ['笔记', '文稿', 'X 推文…', '网页链接…', 'X 推文 2'];
  assert.equal(typeaheadIndex(keys, 'x', 0), 2);
  assert.equal(typeaheadIndex(keys, 'x', 2), 4);
  assert.equal(typeaheadIndex(keys, '网', 0), 3);
  assert.equal(typeaheadIndex(keys, 'q', 0), -1);
});

test('menu markup: role=menu, items are menuitems, unavailable ones are aria-disabled with a reason', () => {
  const html = renderToStaticMarkup(createElement(Menu, { label: '添加', anchor: { x: 10, y: 10 }, onClose: noop, children: [
    createElement(MenuSection, { key: 's', title: '自己写', children: createElement(MenuItem, { label: '笔记', ariaLabel: '添加笔记', shortcut: 'N', onSelect: noop }) }),
    createElement(MenuSeparator, { key: 'sep' }),
    createElement(MenuItem, { key: 'v', label: '视频链接…', disabled: true, reason: '需要桌面版' }),
  ] }));
  getByRole(html, 'menu', '添加');
  const note = getByRole(html, 'menuitem', '添加笔记');
  assert.ok(hasClass(note, 'field-menu__item'));
  assert.equal(attr(note, 'tabindex'), '-1');
  assert.equal(attr(note, 'aria-keyshortcuts'), 'N');
  assert.equal(textContent(getBy(note, { tag: 'kbd', attrs: { 'aria-hidden': 'true' } })), 'N');
  const video = getByRole(html, 'menuitem', /视频链接/);
  assert.ok(isDisabled(video));
  assert.equal(textContent(getBy(html, { attrs: { id: attr(video, 'aria-describedby')! } })), '需要桌面版');
  getByRole(html, 'separator');
  getBy(html, { className: 'field-menu__heading', text: '自己写' });
});

test('toolbar keeps K4 names and groups, shows the four tool labels, and occupies rail layout without an overlay', () => {
  const html = renderToStaticMarkup(createElement(CanvasToolbar, { tool: 'select', readOnly: false, onTool: noop, onAddCard: noop, onPickFiles: noop, onOpenImport: noop, smartSnap: true, onToggleSnap: noop }));
  assert.ok(hasClass(getByRole(html, 'toolbar', '画布工具'), 'canvas-toolbar'));
  assertNone(html, { attrs: { 'data-canvas-overlay': true } });
  getByRole(html, 'group', '移动与选择'); getByRole(html, 'group', '创建与收集');
  for (const [name, label, key] of [['选择', '选择', 'V'], ['平移', '平移', 'H'], ['连线', '连线', 'C'], ['添加分组区域', '分组', 'G']]) {
    const button = getByRole(html, 'button', name);
    assert.equal(textContent(button), label);
    assert.equal(attr(button, 'data-tip-kbd'), key);
    assert.equal(attr(button, 'title'), undefined, 'C15: a drawn tooltip has no duplicate native title');
  }
  assert.equal(attr(getByRole(html, 'button', '选择'), 'aria-pressed'), 'true');
  assert.equal(attr(getByRole(html, 'button', '平移'), 'aria-pressed'), 'false');
  const add = getByRole(html, 'button', '添加');
  assert.equal(attr(add, 'aria-haspopup'), 'menu'); assert.equal(attr(add, 'aria-expanded'), 'false');
  assertNone(html, { tag: 'kbd' });
  for (const name of ['智能贴齐', '添加笔记', '导入素材', '收集链接', '所有导入方式']) assertNone(html, { name });
});

test('read-only toolbar keeps the buttons focusable but aria-disabled', () => {
  const html = renderToStaticMarkup(createElement(CanvasToolbar, { tool: 'select', readOnly: true, onTool: noop, onAddCard: noop, onPickFiles: noop, onOpenImport: noop }));
  for (const name of ['连线', '添加分组区域', '添加']) {
    const button = getByRole(html, 'button', name);
    assert.ok(isDisabled(button)); assert.equal(attr(button, 'disabled'), undefined);
    assert.equal(attr(button, 'title'), '当前窗口只读');
  }
});

test('navigator renders the zoom group, the settings group with smart snapping, and the K4/K5 hooks', () => {
  const html = renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(ZoomControls, { zoom: .64, onZoomOut: noop, onZoomReset: noop, onZoomIn: noop, onFit: noop, smartSnap: true, onToggleSnap: noop })));
  const root = getByRole(html, 'toolbar', '画布导航');
  assert.ok(hasClass(root, 'zoom-controls') && hasClass(root, 'navigator'));
  assertNone(html, { attrs: { 'data-canvas-overlay': true } });
  getByRole(html, 'group', '画布缩放'); getByRole(html, 'group', '画布设置');
  for (const name of ['缩小', '放大', '查看全部']) getByRole(html, 'button', name);
  assert.ok(hasClass(getByRole(html, 'button', '当前缩放 64%，恢复 100%'), 'zoom-value'));
  assert.equal(attr(getByRole(html, 'button', '查看全部'), 'title'), undefined);
  const snap = getByRole(html, 'button', '智能贴齐');
  assert.equal(attr(snap, 'aria-pressed'), 'true'); assert.equal(textContent(snap), '贴齐');
  const map = getByRole(html, 'button', '小地图');
  assert.equal(attr(map, 'aria-pressed'), 'false'); assert.ok(isDisabled(map), 'an empty canvas has no minimap');
  getByRole(html, 'button', '画布导航，当前缩放 64%');
});

test('canvas context menu offers note, draft, group, import and fit with their shortcuts', () => {
  const html = renderToStaticMarkup(createElement(CanvasContextMenu, { x: 20, y: 30, onAddCard: noop, onImport: noop, onFit: noop }));
  getByRole(html, 'menu', '画布操作');
  // K12 (CHROME-16): one verb with the add menu; “添加分组区域” stays the accessible name of the group item.
  for (const label of ['添加笔记', '添加文稿', '添加分组', '导入素材…', '查看全部']) getBy(html, { role: 'menuitem', text: label });
  assert.equal(attr(getByRole(html, 'menuitem', '添加分组区域'), 'aria-keyshortcuts'), 'G');
  const locked = renderToStaticMarkup(createElement(CanvasContextMenu, { x: 20, y: 30, onAddCard: noop, onImport: noop, onFit: noop, readOnly: true }));
  assert.equal(queryAll(locked, { role: 'menuitem', attrs: { 'aria-disabled': 'true' } }).length, 4);
});
