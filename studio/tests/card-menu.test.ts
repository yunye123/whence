import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import { CardMenu, cardMenuEntries, computeMenuPosition, onCardCommand, requestCardCommand, type ActionMenuItem } from '../src/cards/CardMenu';
import { attr, getByLabel } from './helpers/markup';

// CD-M6 / §6.21: one menu for the card “…”, the right-click and the toolbar “更多”; portalled, keyboard, read-only reasons.

const noop = () => {};
const items = (entries: ReturnType<typeof cardMenuEntries>) => entries.filter((entry): entry is ActionMenuItem => entry.kind === undefined || entry.kind === 'item');

test('the card actions keep their K4 names, and 打开 is first; read-only greys the editing ones with a reason', () => {
  const actions = { onOpen: noop, onView: noop, onConnect: noop, onResize: noop, onDuplicate: noop, onDelete: noop };
  assert.deepEqual(items(cardMenuEntries({ kind: 'note' }, actions)).map(item => item.label), ['打开', '查看这张卡片', '连接到卡片…', '调整尺寸…', '复制卡片', '移除卡片']);
  const locked = items(cardMenuEntries({ kind: 'note' }, { ...actions, readOnly: true }));
  assert.equal(locked.find(item => item.id === 'open')?.disabled, undefined);
  assert.equal(locked.find(item => item.id === 'view')?.disabled, undefined);
  for (const id of ['connect', 'resize', 'duplicate', 'delete']) {
    const item = locked.find(entry => entry.id === id);
    assert.equal(item?.disabled, true, `${id} disabled`);
    assert.ok(item?.reason, `${id} explains why`);
  }
  assert.ok(!items(cardMenuEntries({ kind: 'frame' }, actions)).some(item => item.id === 'connect'), 'frames do not connect');
});

test('a video can excerpt every transcript line, and the row says why it cannot', () => {
  const actions = { onOpen: noop, onExcerptTranscript: noop, onView: noop };
  const line = { id: 'a', start: 0, end: 1, text: '一句原话' };
  const ready = items(cardMenuEntries({ kind: 'video', transcript: [line] }, actions));
  assert.equal(ready[0]?.label, '打开');
  assert.equal(ready.find(item => item.id === 'excerpt-transcript')?.label, '摘录全部逐字稿到画布');
  assert.equal(ready.find(item => item.id === 'excerpt-transcript')?.disabled, undefined);
  assert.equal(ready.find(item => item.id === 'view')?.label, '查看这张卡片');
  const none = items(cardMenuEntries({ kind: 'video', transcript: [{ ...line, text: '  ' }] }, actions));
  assert.equal(none.find(item => item.id === 'excerpt-transcript')?.reason, '还没有逐字稿');
  const busy = items(cardMenuEntries({ kind: 'video', transcript: [line], videoImport: { status: 'transcribing' } as never }, actions));
  assert.equal(busy.find(item => item.id === 'excerpt-transcript')?.reason, '逐字稿还在提取');
  const downloading = items(cardMenuEntries({ kind: 'video', videoImport: { status: 'downloading' } as never }, actions));
  assert.equal(downloading.find(item => item.id === 'excerpt-transcript')?.reason, '逐字稿还在提取');
  const locked = items(cardMenuEntries({ kind: 'video', transcript: [line], videoImport: { status: 'queued' } as never }, { ...actions, readOnly: true }));
  assert.equal(locked.find(item => item.id === 'excerpt-transcript')?.reason, '只读窗口');
  assert.equal(locked.find(item => item.id === 'open')?.disabled, undefined);
});

test('menus flip above and shift inside the window, 8px from the edges', () => {
  const below = computeMenuPosition({ left: 100, top: 100, right: 132, bottom: 132 }, { width: 220, height: 200 }, { width: 1000, height: 800 }, 'bottom-end');
  assert.deepEqual([below.side, below.left, below.top], ['bottom', 8, 138]);
  const flipped = computeMenuPosition({ left: 600, top: 700, right: 632, bottom: 732 }, { width: 220, height: 200 }, { width: 1000, height: 800 }, 'bottom-start');
  assert.equal(flipped.side, 'top');
  assert.equal(flipped.top, 700 - 6 - 200);
});

test('card “…” trigger announces a menu and renders no inline (zoom-scaled) menu', () => {
  const html = renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(CardMenu, {
    id: 'n1', data: { kind: 'note', title: '笔记', body: '' }, board: { readOnly: false, tool: 'select', duplicateCard: noop, deleteCard: noop } as never,
    activate: noop as never, openCard: noop, menuOpen: true, setMenuOpen: noop as never, menuRef: { current: null },
  })));
  const trigger = getByLabel(html, '更多操作：笔记');
  assert.equal(attr(trigger, 'aria-haspopup'), 'menu');
  assert.equal(attr(trigger, 'aria-expanded'), 'true');
  assert.doesNotMatch(html, /role="menu"/, 'the open menu is portalled to the body, not inside the node');
});

test('card commands reach the registered owner of the dialogs', () => {
  const calls: string[] = [];
  const release = onCardCommand((id, command) => { calls.push(`${id}:${command}`); return id === 'known'; });
  assert.equal(requestCardCommand('known', 'resize'), true);
  assert.equal(requestCardCommand('missing', 'view'), false);
  release();
  assert.equal(requestCardCommand('known', 'connect'), false);
  assert.deepEqual(calls, ['known:resize', 'missing:view']);
});
