import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TopBar, { type TopBarProps } from '../src/shell/TopBar';
import type { Board } from '../src/model';
import { attr, getByLabel, getByTestId, queryAll, textContent } from './helpers/markup';

const noop = () => {};
const longTitle = '凌晨四点的早餐摊与城市里醒得最早的人我们沿着街道继续寻找每段故事和那些平凡的来处';
const board: Board = {
  id: 'topbar-v2', title: longTitle, description: '', category: 'video',
  createdAt: '', updatedAt: '', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
};
const defaults: TopBarProps = {
  board, readOnly: false, saveStatus: 'saved', saveError: '',
  sidebarOpen: true, sidebarHasCollapse: true, onToggleSidebar: noop,
  onRename: noop, onRevealStorage: noop, view: 'canvas', onViewChange: noop,
  canUndo: true, canRedo: true, onUndo: noop, onRedo: noop,
  importTaskCount: 3, activeImportCount: 2, onOpenImports: noop, onOpenExport: noop,
};
const render = (props: Partial<TopBarProps> = {}) => renderToStaticMarkup(createElement(TopBar, { ...defaults, ...props }));

test('W2-J: all save states report honestly in the original status element (K3/C4)', () => {
  const states = { loading: '读取中', saving: '保存中', saved: '已保存到本机', error: '保存失败', readonly: '只读窗口' } as const;
  for (const [saveStatus, text] of Object.entries(states)) {
    const status = getByTestId(render({ saveStatus: saveStatus as TopBarProps['saveStatus'] }), 'save-status');
    assert.equal(status.tag, 'span');
    assert.equal(attr(status, 'role'), 'status');
    assert.equal(textContent(status), text);
    assert.equal(queryAll(status, { tag: 'svg' }).length, 1, `${saveStatus} has a distinct status icon`);
    assert.equal(queryAll(status, { role: 'button' }).length, 0, 'retry remains in the banner');
    if (saveStatus === 'loading') assert.doesNotMatch(textContent(status), /已保存/);
  }
  const status = getByTestId(render({ board: { ...board, storage: { id: 'folder', directory: 'D:\\来处测试' } } }), 'save-status');
  assert.equal(textContent(status), '已保存到本机文件夹');
  assert.equal(attr(status, 'title'), '已保存到 D:\\来处测试');
});

test('W2-J: board title remains an input; the original action names survive (K3/K4)', () => {
  const html = render();
  assert.equal(Array.from(longTitle).length, 40);
  const title = getByTestId(html, 'board-title');
  assert.equal(title.tag, 'input');
  assert.equal(attr(title, 'value'), longTitle);
  assert.equal(attr(title, 'aria-label'), '画布名称');
  for (const label of ['撤销', '重做', '导出作品', '查看视频导入任务']) assert.equal(getByLabel(html, label).tag, 'button');
  assert.equal(attr(getByTestId(render({ readOnly: true }), 'board-title'), 'disabled'), '');
  for (const label of ['撤销', '重做']) assert.equal(attr(getByLabel(render({ readOnly: true }), label), 'disabled'), '');
});

test('W2-J: video states always expose an icon and separate count for narrow layouts', () => {
  for (const [props, count, copy] of [
    [{ activeImportCount: 2 }, '2', ' 个处理中'],
    [{ activeImportCount: 0, attentionImportCount: 3 }, '3', ' 个需要处理'],
    [{ activeImportCount: 0, attentionImportCount: 0 }, '3', ' 个视频任务'],
  ] as const) {
    const activity = getByLabel(render(props), '查看视频导入任务');
    assert.equal(queryAll(activity, { tag: 'svg' }).length, 1);
    assert.equal(textContent(queryAll(activity, { className: 'video-import-activity__count' })[0]), count);
    assert.equal(textContent(queryAll(activity, { className: 'video-import-activity__text' })[0]), copy);
  }
  // Positive control above ensures this absence check cannot pass after a selector rename.
  assert.equal(queryAll(render({ importTaskCount: 0, activeImportCount: 0 }), { label: '查看视频导入任务' }).length, 0);
  assert.match(attr(getByLabel(render({ attentionImportCount: 1 }), '查看视频导入任务'), 'title') ?? '', /2 个视频处理中.*1 个视频导入需要处理/);
});

test('W2-J: sidebar integration and the pre-integration fallback remain usable', () => {
  const closed = getByLabel(render({ sidebarOpen: false }), '展开侧栏');
  assert.equal(attr(closed, 'aria-expanded'), 'false');
  assert.equal(getByLabel(render({ sidebarHasCollapse: false }), '收起侧栏').tag, 'button');
  assert.equal(queryAll(render(), { label: '收起侧栏' }).length, 0);
});

test('W2-J: view state and failed-save recovery keep their existing contracts', () => {
  const outline = render({ view: 'outline', saveStatus: 'error', saveError: '本机磁盘尚未连接', onRetrySave: noop });
  assert.equal(attr(queryAll(outline, { role: 'button', text: '大纲' })[0], 'aria-pressed'), 'true');
  assert.equal(attr(queryAll(outline, { role: 'button', text: '画布' })[0], 'aria-pressed'), 'false');
  assert.equal(attr(getByTestId(outline, 'save-status'), 'title'), '本机磁盘尚未连接');
  assert.equal(queryAll(outline, { role: 'button', text: /重试/ }).length, 0);
});
