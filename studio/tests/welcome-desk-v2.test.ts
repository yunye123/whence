import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Welcome from '../src/shell/Welcome';
import EmptyCanvas from '../src/shell/EmptyCanvas';
import { CrashScreen, LoadErrorScreen, LoadingScreen } from '../src/shell/RecoveryScreens';
import { EXAMPLES } from '../src/templates';
import { attr, getAllBy, getBy, getByRole, queryAll, textContent } from './helpers/markup';

const noop = () => {};

test('desk welcome keeps its accessible entry contracts and uses three distinct stationery types', () => {
  const html = renderToStaticMarkup(createElement(Welcome, { onOpenExample: noop, onNewBoard: noop }));
  const entries = getAllBy(html, { tag: 'button', className: 'welcome__entry' });
  assert.equal(entries.length, 3);
  for (const example of EXAMPLES) {
    const entry = getByRole(html, 'button', `${example.entry}：打开示例画布“${example.title}”`);
    assert.ok(attr(entry, 'class')?.split(' ').includes('template-card'));
    assert.equal(attr(entry, 'data-stationery'), example.id);
  }
  getBy(html, { tag: 'section', className: 'welcome' });
  getBy(html, { className: 'welcome__voice--theirs', text: '把收集来的，' });
  getBy(html, { className: 'welcome__voice--mine', text: '写成自己的。' });
  getByRole(html, 'button', '从空白画布开始');
  assert.match(textContent(html), /不会上传/);
  assert.doesNotMatch(html, /welcome__grid|welcome__spine|wl-knot|wl-draft__eyelet|wl-ring/);
});

test('welcome demonstration highlights only the source and links it to manuscript paragraph five', () => {
  const html = renderToStaticMarkup(createElement(Welcome, { onOpenExample: noop, onNewBoard: noop }));
  const demo = getBy(html, { className: 'welcome__demo' });
  assert.equal(attr(demo, 'aria-hidden'), 'true', 'decoration must not duplicate the real entry announcements');
  const video = getBy(demo, { className: 'wl-video' });
  assert.equal(getAllBy(video, { tag: 'mark' }).length, 1);
  for (const name of ['wl-quote', 'wl-draft']) assert.equal(queryAll(getBy(demo, { className: name }), { tag: 'mark' }).length, 0);
  getBy(demo, { className: 'wl-used-label', text: '写进⑤' });
  getBy(demo, { className: 'wl-draft__paragraph', text: '5' });
  assert.match(textContent(getBy(demo, { className: 'wl-quote' })), /01:12–01:26/);
});

test('blank canvas title remains literal and only the three actions can intercept the canvas', () => {
  const title = '保留 <原名> & 空格';
  const html = renderToStaticMarkup(createElement(EmptyCanvas, { readOnly: true, onImport: noop, onAddNote: noop, title }));
  getBy(html, { tag: 'h2', text: title });
  for (const name of [/^笔记/, '本机文件', '粘贴链接']) assert.equal(attr(getByRole(html, 'button', name), 'disabled'), '');
  assert.match(textContent(html), /此窗口只读/);
  assert.equal(getAllBy(html, { role: 'button' }).length, 3);
  assert.doesNotMatch(html, /field-card|wl-draft/);
});

test('both recovery screens put the unchanged recovery action and folded details on manuscript paper', () => {
  for (const Screen of [LoadErrorScreen, CrashScreen]) {
    const html = renderToStaticMarkup(createElement(Screen, { message: 'read <failed> & disk' }));
    const paper = getBy(html, { className: 'recovery-screen__paper' });
    getByRole(paper, 'button', '重新载入');
    const details = getBy(paper, { tag: 'details', className: 'recovery-screen__details' });
    assert.equal(attr(details, 'open'), undefined);
    getBy(details, { tag: 'pre', text: 'read <failed> & disk' });
    getByRole(details, 'button', '复制错误信息');
  }
  getByRole(renderToStaticMarkup(createElement(CrashScreen, { message: 'failed' })), 'alert');
});

test('boot keeps its busy state, silent brand and status without a grid or spinner', () => {
  const html = renderToStaticMarkup(createElement(LoadingScreen));
  assert.equal(attr(getBy(html, { tag: 'main', className: 'boot-screen' }), 'aria-busy'), 'true');
  getByRole(html, 'status', '正在打开来处');
  assert.equal(attr(getBy(html, { className: 'boot-screen__brand' }), 'aria-hidden'), 'true');
  assert.doesNotMatch(html, /pattern|spinner|welcome__grid/);
});
