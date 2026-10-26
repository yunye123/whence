import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ModalShell from '../src/shell/ModalShell';
import NewBoardDialog, { BOARD_TEMPLATES } from '../src/dialogs/NewBoardDialog';
import ImportDialog, { type ImportDialogProps } from '../src/dialogs/ImportDialog';

import HelpDialog from '../src/dialogs/HelpDialog';
import TranslationSettingsDialog from '../src/dialogs/TranslationSettingsDialog';
import MediaToolsDialog from '../src/dialogs/MediaToolsDialog';
import VideoImportsDialog, { importRowTitle } from '../src/dialogs/VideoImportsDialog';

import { createBoard } from '../src/templates';

import { quoteTitle } from '../src/dialogs/display';
import { assertNone, attr, getAllBy, getBy, getByLabel, getByRole, hasClass, isDisabled, mentions, queryAll, textContent } from './helpers/markup';

const noop = () => {};
const inModal = (kind: string, child: ReactElement) => renderToStaticMarkup(createElement(ModalShell, { kind, locked: false, closeDisabled: false, onClose: noop, children: child }));

function importProps(overrides: Partial<ImportDialogProps> = {}): ImportDialogProps {
  return { mode: 'web', onModeChange: noop, value: '', onTextChange: noop, onXTextChange: noop, error: '', xProgress: '', xCommitting: false, xAvailable: false, videoAvailable: false, native: false, readOnly: false, busy: false, onPickFiles: noop, onSubmitLink: noop, onImportX: noop, onCancelX: noop, onRestoreBoardFile: noop, onOpenLocalBoard: noop, onRunNative: noop, ...overrides };
}

test('modal shell keeps the dialog contract: role, aria-modal, labelled by modal-title, close button', () => {
  const html = inModal('help', createElement(HelpDialog));
  const dialog = getByRole(html, 'dialog');
  assert.equal(attr(dialog, 'aria-modal'), 'true');
  assert.equal(attr(dialog, 'aria-labelledby'), 'modal-title');
  assert.ok(hasClass(dialog, 'modal') && hasClass(dialog, 'modal-help'));
  getBy(html, { className: 'modal-backdrop' });
  getByRole(html, 'button', '关闭对话框');
  getBy(html, { attrs: { id: 'modal-title' }, text: '使用指南' });
});

test('new board dialog: templates first, blank card kept, Enter-able name field, create button', () => {
  const props = { name: '', onName: noop, template: 'blank' as const, onTemplate: noop, directory: null, directoryError: '', creating: false, readOnly: false, onChooseDirectory: noop, onClearDirectory: noop, onCreate: noop };
  const html = inModal('new', createElement(NewBoardDialog, props));
  getBy(html, { attrs: { id: 'modal-title' }, text: '新建画布' });
  const cards = getAllBy(html, { className: 'template-card' });
  assert.equal(cards.length, BOARD_TEMPLATES.length);
  const blank = cards.find(card => textContent(card).includes('空白画布'));
  assert.ok(blank, 'the “空白画布” template card stays (K4, K11)');
  assert.equal(attr(blank, 'aria-checked'), 'true', 'blank is selected by default (F-M1)');
  assert.ok(textContent(html).indexOf('空白画布') < textContent(html).indexOf('画布名称'), 'templates come before the name');
  // KB-m1: the dialog's field is “新画布名称” for screen readers, apart from the top bar's “画布名称”; the visible label stays.
  getByLabel(html, '新画布名称', { role: 'textbox' });
  assert.ok(mentions(html, '给这块画布起个名字'));
  assert.equal(isDisabled(getByRole(html, 'button', '创建画布')), false);
  const creating = inModal('new', createElement(NewBoardDialog, { ...props, creating: true }));
  assert.ok(isDisabled(getByRole(creating, 'button', '正在创建…')));
  const readOnly = inModal('new', createElement(NewBoardDialog, { ...props, readOnly: true }));
  assert.ok(isDisabled(getByRole(readOnly, 'button', '创建画布')));
  assert.ok(mentions(readOnly, '此窗口只读'));
});

test('import dialog: files, links and board files are separate; unavailable link modes go last with a reason', () => {
  const html = inModal('import', createElement(ImportDialog, importProps()));
  getBy(html, { attrs: { id: 'modal-title' }, text: '导入素材' });
  const group = getByLabel(html, '链接导入方式');
  const modes = queryAll(group, { role: 'button' }).map(button => attr(button, 'aria-label'));
  assert.deepEqual(modes, ['网页资料', '视频链接', 'X 推文'], 'browser: the available mode first');
  assert.ok(mentions(group, '需要桌面版'));
  getByLabel(html, '网页链接或分享文案', { role: 'textbox' });
  getByRole(html, 'button', /^恢复画布文件/);
  assertNone(html, { role: 'button', name: /^打开本机画布/ }, 'desktop-only rows are described, not offered as dead buttons');
  assert.ok(mentions(html, '桌面版另有'));
  const desktop = inModal('import', createElement(ImportDialog, importProps({ mode: 'video', videoAvailable: true, xAvailable: true, native: true, value: 'https://www.douyin.com/video/1' })));
  assert.deepEqual(queryAll(getByLabel(desktop, '链接导入方式'), { role: 'button' }).map(button => attr(button, 'aria-label')), ['视频链接', 'X 推文', '网页资料']);
  getByRole(desktop, 'button', '下载并提取逐字稿');
  getByRole(desktop, 'button', /^打开本机画布/);
  assert.match(textContent(desktop), /识别到 1 个链接：抖音/);
  const browserVideo = inModal('import', createElement(ImportDialog, importProps({ mode: 'video', value: 'https://www.douyin.com/video/1' })));
  getByRole(browserVideo, 'button', '改存为网页资料');
  assert.ok(mentions(browserVideo, '自动下载与逐字稿需要来处桌面版'));
});

test('translation settings dialog asks for a key and does not print one', () => {
  const html = inModal('translation', createElement(TranslationSettingsDialog));
  getBy(html, { attrs: { id: 'modal-title' }, text: '翻译密钥' });
  const field = getByLabel(html, '接口密钥');
  assert.equal(attr(field, 'type'), 'password');
  assert.equal(field.attrs.value ?? '', '');
  getByLabel(html, '接口地址');
  getByRole(html, 'button', '保存');
  assert.ok(mentions(html, '不会写入画布'));
  assert.equal(html.includes('sk-'), false);
});

test('local tools dialog explains what is already in the app and asks for the four paths', () => {
  const html = inModal('tools', createElement(MediaToolsDialog));
  getBy(html, { attrs: { id: 'modal-title' }, text: '本机工具' });
  for (const label of ['Python', 'FFmpeg', 'ffprobe', '语音模型']) getByLabel(html, label);
  getByRole(html, 'button', '检查');
  getByRole(html, 'button', '保存');
  assert.ok(mentions(html, '已经在来处里'));
  assert.ok(mentions(html, '翻译密钥'));
  assert.ok(mentions(html, '识图已经备好'));
  assert.ok(isDisabled(getByRole(html, 'button', '保存')));
  assert.ok(mentions(html, '需要来处桌面版'));
});

test('help dialog groups shortcuts by 收集 / 整理 / 写作 / 交付 and lists ? and Esc', () => {
  const html = inModal('help', createElement(HelpDialog));
  for (const title of ['收集', '整理', '写作', '交付']) getBy(html, { tag: 'h3', text: title });
  const text = textContent(html);
  for (const label of ['搜索与命令', '新建笔记', '查看全部', '撤销', '重做', '使用指南', '逐层退出']) assert.ok(text.includes(label), label);
  assert.ok(text.includes('Esc') && text.includes('?'));
  assert.ok(mentions(html, '不会上传'));
  // 2026-10-07 起由原野改名为来处：关于里的名称行写新名（whence 只作副名），并说明原来的画布照常可用。
  getBy(html, { className: 'help-version', text: /^来处 whence/ });
  assert.ok(!textContent(html).includes('原野 FIELD'));
  assert.ok(mentions(html, /改名为“来处”.*照常可用/));
  assert.ok(mentions(html, '本机工具'));
  assert.ok(mentions(html, '安装并检查'));
});

test('video import tasks that did not finish stop saying “正在导入”', () => {
  assert.equal(importRowTitle('正在导入 · 抖音', 'failed', 'https://www.douyin.com/video/1'), '导入未完成 · 抖音');
  assert.equal(importRowTitle('凌晨四点的早餐摊', 'interrupted', 'https://www.douyin.com/video/1'), '导入未完成 · 凌晨四点的早餐摊');
  assert.equal(importRowTitle('凌晨四点的早餐摊', 'completed', 'https://www.douyin.com/video/1'), '凌晨四点的早餐摊');
  const board = createBoard('blank');
  const node = { id: 'n1', type: 'card' as const, position: { x: 0, y: 0 }, data: { kind: 'video' as const, title: '正在导入 · 抖音', body: '' } };
  const task = { attemptId: 'a', url: 'https://www.douyin.com/video/1', originalText: '', status: 'failed' as const, message: '', error: '链接打不开。', mediaReady: false, createdAt: '', updatedAt: '' };
  const html = inModal('imports', createElement(VideoImportsDialog, { entries: [{ board, node, task }], readOnly: false, videoAvailable: false, isActionPending: () => false, onGoToCard: noop, onCancel: noop, onRetry: noop }));
  const row = getBy(html, { testId: 'video-import-task-n1' });
  assert.match(textContent(row), /导入未完成 · 抖音/);
  assert.ok(isDisabled(getByRole(row, 'button', '重新导入')));
  assert.ok(mentions(row, '重新导入需要来处桌面版'));
  assert.match(textContent(html), /1 个需要处理/);
});

test('quote display titles use the sentence while the stored title is a default', () => {
  assert.equal(quoteTitle({ title: '摘录 · 01:12–01:26', body: '', citation: { nodeId: 'v', title: '片', text: '摊主说，四点出摊' } }), '摊主说，四点出摊');
  assert.equal(quoteTitle({ title: '我的标题', body: '', citation: { nodeId: 'v', title: '片', text: '摊主说' } }), '我的标题');
});
