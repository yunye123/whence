import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Toasts, { clearToasts, dismissToast, getToasts, inferToastTone, showToast, splitUndoHint, toastDuration, TOAST_LIMIT } from '../src/shell/Toasts';

// §6.22 / CV-M1: a queue (≤3, newest last), 4s / 8s with undo / errors stay, legacy “可撤销” gets a real button.

test('queue keeps at most three, newest last; the same message refreshes instead of stacking', () => {
  clearToasts();
  for (const message of ['一', '二', '三', '四']) showToast(message);
  assert.deepEqual(getToasts().map(item => item.message), ['二', '三', '四']);
  assert.equal(TOAST_LIMIT, 3);
  showToast('三');
  assert.deepEqual(getToasts().map(item => item.message), ['二', '四', '三']);
  clearToasts();
});

test('durations: 4s normal, 8s with undo, errors stay until closed', () => {
  assert.equal(toastDuration({}), 4000);
  assert.equal(toastDuration({ undo: () => {} }), 8000);
  assert.equal(toastDuration({ tone: 'error' }), null);
  assert.equal(toastDuration({ duration: 1500 }), 1500);
});

test('legacy text: “，可撤销” becomes an undo button and failures become alerts', () => {
  assert.deepEqual(splitUndoHint('已移除 3 张卡片，可撤销'), { message: '已移除 3 张卡片', undoable: true });
  assert.deepEqual(splitUndoHint('来源卡片已被移除，摘录原文仍保留。可撤销删除来恢复来源。').undoable, false);
  assert.equal(inferToastTone('导入失败：链接打不开'), 'error');
  assert.equal(inferToastTone('画布已导入'), 'info');
});

test('dismiss fades the toast out before it leaves the queue', async () => {
  clearToasts();
  const id = showToast('已移入回收站', { undo: () => {} });
  dismissToast(id);
  assert.equal(getToasts()[0]?.leaving, true);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(getToasts().length, 0);
});

test('renders nothing on the server (portal to body happens in the browser)', () => {
  clearToasts();
  assert.equal(renderToStaticMarkup(createElement(Toasts, { toast: '' })), '');
});
