import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import Welcome from '../src/shell/Welcome';
import EmptyCanvas from '../src/shell/EmptyCanvas';

import { EXAMPLES } from '../src/templates';

import { assertNone, attr, getAllBy, getBy, getByRole, mentions, textContent } from './helpers/markup';

const noop = () => {};

test('welcome: three entries tied to the examples, blank-board button still opens the dialog path', () => {
  const html = renderToStaticMarkup(createElement(Welcome, { onOpenExample: noop, onNewBoard: noop }));
  const entries = getAllBy(html, { className: 'welcome__entry' });
  assert.equal(entries.length, EXAMPLES.length);
  EXAMPLES.forEach((example, index) => { assert.ok(textContent(entries[index]).includes(example.entry)); assert.ok(attr(entries[index], 'aria-label')!.includes(example.title)); });
  getBy(html, { className: 'new-board', role: 'button' });
  getByRole(html, 'img', '来处'); // 字标的读屏名是新产品名
  assert.match(textContent(html), /把收集来的/);
  assert.match(textContent(html), /写成自己的/);
  assert.match(textContent(html), /不会上传/);
  assertNone(html, { tag: 'kbd', text: 'N' }, 'no shortcut is shown for a key the app does not handle');
  const desktop = renderToStaticMarkup(createElement(Welcome, { onOpenExample: noop, onNewBoard: noop, storagePath: 'D:\\文档\\原野', onChangeLocation: noop, newBoardShortcut: 'Ctrl N' }));
  assert.ok(mentions(desktop, 'D:\\文档\\原野'));
  getByRole(desktop, 'button', '更改位置');
  getBy(desktop, { tag: 'kbd', text: 'Ctrl N' });
});

test('empty canvas names the place and offers note, files and link', () => {
  const html = renderToStaticMarkup(createElement(EmptyCanvas, { readOnly: false, onImport: noop, onAddNote: noop, title: '城中村的夜晚' }));
  getBy(html, { className: 'empty-canvas' });
  getBy(html, { tag: 'h2', text: '城中村的夜晚' });
  assert.match(textContent(html), /这页还空着/);
  for (const name of [/^笔记/, '本机文件', '粘贴链接']) getByRole(html, 'button', name);
});
