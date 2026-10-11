import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import CanvasSelectionTools from '../src/CanvasSelectionTools';
import StatusBanners from '../src/shell/StatusBanners';
import { createNode } from '../src/board-utils';
import { attr, getByRole, isDisabled, queryAll, textContent } from './helpers/markup';

const css = (name: string) => fs.readFileSync(new URL(`../src/styles/${name}.css`, import.meta.url), 'utf8');
const declarations = (name: string, selector: string) => {
  const values: Record<string, string> = {};
  postcss.parse(css(name)).walkRules(rule => {
    if (rule.selector.split(',').map(value => value.trim()).includes(selector)) {
      rule.walkDecls(decl => { values[decl.prop] = decl.value; });
    }
  });
  return values;
};

test('menus, selection controls and search use neutral panels without retired accent tokens', () => {
  assert.equal(declarations('components/menu', '.field-menu').background, 'var(--bg-panel)');
  assert.equal(declarations('components/contextbar', '.selection-tools').background, 'var(--bg-panel)');
  assert.equal(declarations('components/contextbar', '.action-menu').background, 'var(--bg-panel)');
  assert.equal(declarations('features/search', 'dialog.inspector-dialog.workspace-search').background, 'var(--bg-panel)');
  for (const name of ['components/menu', 'components/contextbar', 'components/button', 'components/field', 'features/search']) {
    assert.doesNotMatch(css(name), /var\(--(?:source-[\w-]+|bg-contextbar|bg-surface|bg-elevated|bg-paper|light-[\w-]+)\)/, name);
  }
});

test('search marks distinguish matches from extracted text with neutral ink and an underline', () => {
  const mark = declarations('features/search', '.ws mark');
  assert.equal(mark.background, 'var(--text-selection)');
  assert.equal(mark['text-decoration-line'], 'underline');
  assert.equal(mark['text-decoration-color'], 'var(--fg-1)');
  assert.equal(mark['text-decoration-thickness'], '1px');
});

test('invalid focused inputs retain the ink double ring and forced colors retain an outline', () => {
  const focused = declarations('components/field', '.input[aria-invalid="true"]:focus-visible');
  assert.match(focused['box-shadow'], /var\(--focus-shadow\)/);
  assert.match(css('base/focus'), /@media\s*\(forced-colors:\s*active\)/);
  assert.equal(declarations('base/focus', '.react-flow__node:focus-visible')['outline-offset'], 'var(--focus-node-offset)');
});

test('reduced motion keeps the backdrop still and provides stamp timings without blanket animation removal', () => {
  const motion = css('base/motion');
  assert.match(motion, /--dur-stamp-in:\s*120ms/);
  assert.match(motion, /--dur-stamp-hold:\s*240ms/);
  assert.match(motion, /--dur-stamp-out:\s*360ms/);
  assert.match(motion, /\.modal-backdrop\s*\{\s*animation:\s*none !important/);
  assert.doesNotMatch(motion, /(?:\*|\.field-card[^{}]*)\s*\{[^{}]*animation:\s*none/);
});

test('failure and read-only banners announce status with distinct icons and keep the retry contract', () => {
  const props = { saveStatus: 'error' as const, saveError: '最新修改还没有写入本机。', readOnly: false, busy: false, canReconnect: true, onRetrySave() {}, onReconnect() {}, onExportBackup() {} };
  const failed = renderToStaticMarkup(createElement(StatusBanners, props));
  assert.match(textContent(getByRole(failed, 'status')), /保存失败/);
  assert.equal(isDisabled(getByRole(failed, 'button', '重试保存')), false);
  assert.equal(queryAll(failed, { tag: 'svg', attrs: { 'data-status-icon': 'error', 'aria-hidden': 'true' } }).length, 1);
  const locked = renderToStaticMarkup(createElement(StatusBanners, { ...props, saveStatus: 'saved', readOnly: true }));
  assert.match(textContent(getByRole(locked, 'status')), /此窗口只读/);
  assert.equal(queryAll(locked, { tag: 'svg', attrs: { 'data-status-icon': 'readonly', 'aria-hidden': 'true' } }).length, 1);
});

test('single-quote toolbar keeps source actions accessible without nested buttons; read-only disables writes', () => {
  const source = createNode('video');
  const quote = createNode('quote');
  quote.data.citation = { nodeId: source.id, title: '早餐摊', start: 72, text: '凌晨四点的早餐摊。' };
  const render = (readOnly: boolean) => renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(CanvasSelectionTools, {
    nodes: [source, quote], selectedIds: [quote.id], readOnly, onOpen() {}, onDelete() {}, onDuplicate() {}, onConnect() {}, onResize() {}, onWriteToDraft() {},
  })));
  const html = render(false);
  const lead = getByRole(html, 'button', '回到原片 01:12');
  assert.equal(queryAll(lead, { tag: 'button' }).length, 0, 'no nested button inside the action');
  assert.match(textContent(lead), /01:12/);
  assert.equal(attr(getByRole(html, 'button', '更多选中卡片操作'), 'aria-haspopup'), 'menu');
  const locked = render(true);
  assert.equal(queryAll(locked, { role: 'button', name: '写进文稿' }).length, 0);
  assert.equal(attr(getByRole(locked, 'button', '更多选中卡片操作'), 'title'), '当前窗口只读');
});
