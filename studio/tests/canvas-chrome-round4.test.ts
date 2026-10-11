import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { saveFailureCopy } from '../src/shell/StatusBanners';
import StatusBanners from '../src/shell/StatusBanners';
import TopBar from '../src/shell/TopBar';
import { Words, withKeptTails } from '../src/cards/Words';
import { platformLabel } from '../src/cards/card-utils';
import type { Board } from '../src/model';
import { attr, getByRole, getByTestId, queryAll, textContent } from './helpers/markup';

// polish round 4 P7: a folder that cannot be written is said in plain words, with “本机”, and the raw error stays as detail.
test('a folder save failure reads as what happened and why, not as the storage message', () => {
  const raw = '以下画布的本机文件夹尚未更新：“城中村的夜晚”：ENOENT: no such file or directory, open \'D:\\原野\\board.json\'';
  const copy = saveFailureCopy(raw);
  assert.equal(copy.message, '最新修改已留在本机，还没写进“城中村的夜晚”的画布文件夹。文件夹可能被移动、改名，或所在磁盘没有连接。');
  assert.equal(copy.detail, raw);
  assert.doesNotMatch(copy.message, /本地|ENOENT|尚未更新/);
  // The older wording of the same report, and several boards at once.
  const two = saveFailureCopy('以下画布的本地目录尚未更新：“甲”：目录写入失败。；“乙”：画布目录未授权，请通过“打开本机画布”重新选择。');
  assert.equal(two.message, '最新修改已留在本机，还没写进 2 块画布的文件夹（“甲”“乙”）。文件夹可能被移动、改名，或所在磁盘没有连接。');
});

test('other save failures keep their own sentence, with “本机”; an empty one gets the plain default', () => {
  assert.equal(saveFailureCopy('本地数据库被其他窗口占用，请关闭旧版本的画布窗口后重试。').message, '本机数据库被其他窗口占用，请关闭旧版本的画布窗口后重试。');
  assert.equal(saveFailureCopy('').message, '最新修改还没有写入本机。');
});

const board = { id: 'b', title: '城中村的夜晚', category: 'writing', nodes: [], edges: [], createdAt: '', updatedAt: '', storage: { id: 's', directory: 'D:\\原野\\城中村' } } as unknown as Board;
const noop = () => {};

test('one main action for a failed save: the banner retries, the top bar only reports “保存失败” (K3)', () => {
  const banner = renderToStaticMarkup(createElement(StatusBanners, { saveStatus: 'error', saveError: '以下画布的本机文件夹尚未更新：“城中村的夜晚”：目录写入失败。', readOnly: false, busy: false, canReconnect: true, onRetrySave: noop, onReconnect: noop, onExportBackup: noop }));
  assert.equal(queryAll(banner, { role: 'button' }).length, 3);
  getByRole(banner, 'button', '重试保存');
  getByRole(banner, 'button', '重新连接文件夹');
  getByRole(banner, 'button', '导出备份');
  const top = renderToStaticMarkup(createElement(TopBar, { board, readOnly: false, saveStatus: 'error', saveError: '以下画布的本机文件夹尚未更新：“城中村的夜晚”：目录写入失败。', sidebarOpen: true, onToggleSidebar: noop, onRename: noop, onRevealStorage: noop, view: 'canvas', onViewChange: noop, canUndo: false, canRedo: false, onUndo: noop, onRedo: noop, importTaskCount: 0, activeImportCount: 0, onOpenImports: noop, onOpenExport: noop }));
  const status = getByTestId(top, 'save-status');
  assert.match(textContent(status), /保存失败/);
  assert.equal(queryAll(status, { role: 'button' }).length, 0, 'no second “重试” in the top bar');
  assert.match(attr(status, 'title') ?? '', /^最新修改已留在本机，还没写进“城中村的夜晚”的画布文件夹/);
});

// §3.4 “不允许孤字成行”: the last words of each paragraph (≥ 4 visible characters) stay on one line.
test('Words keep: the last words of every paragraph sit in a keep-together span, line breaks stay outside it', () => {
  const html = renderToStaticMarkup(createElement(Words, { text: '开头不要讲大道理，先讲一个具体的人。\n\n只留三个细节：四点的灯、铁锅的白汽、头班车。', keep: 4 }));
  const kept = [...html.matchAll(/<span class="keep-together">([^<]*)<\/span>/g)].map(match => match[1]);
  assert.equal(kept.length, 2, 'one kept tail per paragraph');
  for (const tail of kept) { assert.ok([...tail.replace(/\s/g, '')].length >= 4, tail); assert.doesNotMatch(tail, /\n/); }
  assert.match(html, /<\/span>\n\n/, 'the paragraph break follows the span');
  assert.equal(withKeptTails(['短。'], 4).length, 1, 'a paragraph shorter than the count is kept whole');
  assert.doesNotMatch(renderToStaticMarkup(createElement(Words, { text: '没有 keep 时照旧' })), /keep-together/);
});

test('card meta says “本机视频 / 本机图片” for files from this computer (§8.1)', () => {
  assert.equal(platformLabel({ kind: 'video', title: '', body: '', mediaId: 'm' }), '本机视频');
  assert.equal(platformLabel({ kind: 'image', title: '', body: '', mediaId: 'm' }), '本机图片');
});
