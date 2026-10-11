import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Inspector from '../src/Inspector';
import { BoardContext } from '../src/board-context';
import type { BoardActions } from '../src/board-context';
import type { BoardNode } from '../src/model';
import ModalShell from '../src/shell/ModalShell';
import HelpDialog from '../src/dialogs/HelpDialog';
import { chordLabel, chordTitle, matchesShortcut, shortcutById, visibleShortcuts, withShortcut } from '../src/dialogs/shortcuts';
import { collectedLine } from '../src/inspector/TextSourceSection';
import TranscriptPanel from '../src/inspector/TranscriptPanel';
import type { TranscriptLine } from '../src/model';
import { getBy, isDisabled, textContent } from './helpers/markup';

// fix-panels round 3: one place per transcription state, the help table and titles read one shortcut list,
// and the reading meta's “收进这块画布” line.

const noop = () => {};
const video: BoardNode = {
  id: 'video-a', type: 'card', position: { x: 0, y: 0 },
  data: { kind: 'video', title: '样片', body: '', mediaId: 'media-a', sourceUrl: 'https://example.com/v' },
};

function renderInspector(node: BoardNode) {
  const actions: BoardActions = {
    updateCard: () => true, openCard: noop, deleteCard: noop, duplicateCard: noop, addQuote: () => true, addTextQuote: () => true, focusSource: noop,
    openDraftSource: () => true, draftReturn: null, returnToDraft: () => true, draftRestore: null, completeDraftRestore: noop,
    getMediaUrl: id => id ? 'blob:panels-test' : undefined, activeVideo: node.id, inspectedId: node.id, playVideo: noop,
    videoPlaybackVersion: 0, getVideoPlayback: () => ({ time: 0, paused: true }), bindVideoPlayer: noop, captureVideoPlayback: noop, restoreVideoPlayback: noop,
    setPendingTranscriptEdit: noop, cancelVideoImport: noop, retryVideoImport: noop, videoImportAvailable: true, videoImportActionPending: () => false, nodes: [node],
  };
  return renderToStaticMarkup(createElement(BoardContext.Provider, { value: actions }, createElement(Inspector, {
    node, onClose: noop, onImportSubtitles: noop, onNativeTranscribe: async () => {}, onNotify: noop,
  })));
}

const count = (text: string, phrase: string) => text.split(phrase).length - 1;

test('a transcription task is stated once: under the player, while the transcript column only says where it will appear', () => {
  const node: BoardNode = { ...video, data: { ...video.data, videoImport: { attemptId: 'a1', url: 'https://example.com/v', originalText: '', status: 'transcribing', progress: 40, message: '', mediaReady: true, createdAt: '2026-10-07T08:00:00Z', updatedAt: '2026-10-07T08:00:00Z' } } };
  const text = textContent(renderInspector(node));
  assert.equal(count(text, '正在生成逐字稿'), 1, 'the task heading appears once');
  assert.equal(count(text, '逐字稿正在准备中'), 0);
  assert.ok(text.includes('逐字稿会出现在这里'));
  assert.ok(!/你可以|你的发现/.test(text), 'panel copy speaks in the interface voice');
});

test('the help table lists the connect key and leaves desktop-only keys out of the browser', () => {
  const connect = shortcutById('tool-connect');
  assert.ok(connect && connect.chords.some(chord => chord.key === 'c' && !chord.mod));
  assert.ok(matchesShortcut({ key: 'c', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }, 'tool-connect'));
  assert.ok(!visibleShortcuts(false).some(item => item.id === 'new-board'));
  assert.ok(visibleShortcuts(true).some(item => item.id === 'new-board'));
  const html = renderToStaticMarkup(createElement(ModalShell, { kind: 'help', locked: false, closeDisabled: false, onClose: noop, children: createElement(HelpDialog) }));
  const text = textContent(html);
  assert.ok(text.includes('依次点两张卡片'), 'c is in the help table');
  assert.ok(!text.includes('新建画布'), 'Ctrl N is not offered where the browser keeps it');
});

test('titles use half-width brackets with + between keys, kbd text uses spaces, the space bar is 空格', () => {
  assert.equal(withShortcut('撤销', 'undo', false), '撤销 (Ctrl+Z)');
  assert.equal(withShortcut('重做', 'redo', false), '重做 (Ctrl+Shift+Z)');
  assert.equal(withShortcut('重做', 'redo', true), '重做 (⌘⇧Z)');
  assert.equal(chordTitle('上一句', { key: 'ArrowUp' }, false), '上一句 (↑)');
  assert.equal(withShortcut('暂停', 'play-pause', false), '暂停 (空格)');
  assert.equal(withShortcut('没有登记的', 'missing-id', false), '没有登记的');
  assert.equal(chordLabel({ key: 'k', mod: true }, false), 'Ctrl K');
});

test('收进时间 reads like the reading meta in §6.18.3, and old cards without it show nothing', () => {
  const now = new Date(2026, 9, 7, 12, 0);
  assert.equal(collectedLine(new Date(2026, 9, 2, 22, 15).toISOString(), now), '10 月 2 日 22:15 收进这块画布');
  assert.equal(collectedLine(new Date(2025, 0, 5, 8, 5).toISOString(), now), '2025 年 1 月 5 日 8:05 收进这块画布');
  assert.equal(collectedLine(undefined, now), undefined);
  assert.equal(collectedLine('not a date', now), undefined);
  assert.equal(collectedLine(42, now), undefined);
});

function renderColumn(transcript: TranscriptLine[], message: string) {
  const actions = {
    updateCard: () => true, openCard: noop, playVideo: noop, nodes: [video], readOnly: false,
    transcriptionMessage: () => message, getVideoPlayback: () => ({ time: 0, paused: true }), videoPlaybackVersion: 0,
  } as unknown as BoardActions;
  return renderToStaticMarkup(createElement(BoardContext.Provider, { value: actions }, createElement(TranscriptPanel, {
    nodeId: video.id, data: video.data, transcript, query: '', setQuery: noop, selectedLines: new Set<string>(), setSelectedLines: noop,
    lastSelected: null, setLastSelected: noop, currentTime: 0, setCurrentTime: noop, videoUrl: 'blob:panels-test', mediaError: false,
    transcriptBusy: true, transcriptProcessing: true, canRetryImport: false, exporting: false, setExporting: noop,
    onNativeTranscribe: async () => {}, runNativeTranscribe: async () => {}, onImportSubtitles: noop, setReplaceAction: noop, setEditingLine: noop, onNotify: noop,
  })));
}

test('a local transcription is reported in the transcript column, with its progress, and the K6 button stays disabled', () => {
  const empty = renderColumn([], '转写中 0:12 / 2:41');
  const group = getBy(empty, { role: 'group', label: '本机转写状态' });
  const text = textContent(group);
  assert.ok(text.includes('正在生成逐字稿') && text.includes('转写中 0:12 / 2:41'));
  assert.equal(count(textContent(empty), '正在生成逐字稿'), 1);
  assert.ok(isDisabled(getBy(empty, { role: 'button', name: '生成逐字稿' })));
  const again = renderColumn([{ id: 'l1', start: 0, end: 2, text: '第一句。' }], '转写中 0:40 / 2:41');
  const row = getBy(again, { role: 'group', label: '本机转写状态' });
  assert.ok(textContent(row).includes('正在重新生成逐字稿') && textContent(row).includes('转写中 0:40 / 2:41'), 'the old sentences stay readable under one progress row');
});
