import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Inspector from '../src/Inspector';
import { BoardContext } from '../src/board-context';
import type { BoardActions } from '../src/board-context';
import { assertNone, getByRole, hasClass, isDisabled, textContent } from './helpers/markup';
import { DraftNavigationSession, insertDraftBlocks, resolveDraftInsertion, writeTripLine, type DraftEditorState } from '../src/draft-navigation';
import { formatDraftQuote, formatSourceLink } from '../src/draft-references';
import { buildScript, isPictureNote, isScriptLine, scriptTimeResolver, type ScriptLine } from '../src/inspector/script-view/script-model';
import { createExampleBoard } from '../src/templates';
import type { Board, BoardNode } from '../src/model';

// A trip from a script line's “补一个镜头” (§6.29) remembers where that line ends; the watching page gives the chosen
// sentences to that line as its picture (“配给这一行”, the default) or writes them in right after it (“另起一行写进原话”).

const editor: DraftEditorState = {
  selectionStart: 40, selectionEnd: 40, selectionDirection: 'none',
  editorScrollTop: 0, editorScrollLeft: 0, inspectorScrollTop: 120,
};
function videoExample(): { board: Board; draft: BoardNode; video: BoardNode } {
  const board = createExampleBoard('video');
  const draft = board.nodes.find(node => node.data.kind === 'draft' && node.data.title.includes('分镜脚本'))!;
  const video = board.nodes.find(node => node.data.kind === 'video' && (node.data.transcript?.length ?? 0) > 0)!;
  return { board, draft, video };
}

test('a 补一个镜头 trip keeps the line end and number; an ordinary trip has no insert point', () => {
  const { board, draft, video } = videoExample();
  const session = new DraftNavigationSession();
  const model = buildScript(draft.data.body, scriptTimeResolver(board.nodes));
  const line = model.scenes.flatMap(scene => scene.rows).find(row => 'number' in row && row.number === 2) as { to: number; number: number };
  session.open(board, { draftId: draft.id, sourceId: video.id, time: 0, editor, insertAfter: line.to, line: line.number }, 'canvas', board.viewport);
  assert.deepEqual(session.info(board), { draftId: draft.id, title: draft.data.title, insert: { line: 2 } });
  const point = session.insertPoint(board)!;
  assert.equal(point.at, line.to);
  assert.ok(draft.data.body.slice(0, line.to).endsWith(point.anchor) && point.anchor.endsWith('再交代时间。'));
  session.open(board, { draftId: draft.id, sourceId: video.id, time: 0, editor }, 'canvas', board.viewport);
  assert.equal(session.insertPoint(board), null);
  assert.deepEqual(session.info(board), { draftId: draft.id, title: draft.data.title });
  assert.throws(() => session.open(board, { draftId: draft.id, sourceId: video.id, editor, insertAfter: draft.data.body.length + 1 }, 'canvas', board.viewport), /位置已变化/);
});

const scriptLines = (body: string, nodes: BoardNode[]): ScriptLine[] => buildScript(body, scriptTimeResolver(nodes)).scenes.flatMap(scene => scene.rows.filter(isScriptLine));
const newQuote = (video: BoardNode): BoardNode => ({ id: 'q-new', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '摘录', body: '', citation: { nodeId: video.id, title: video.data.title, start: 6, end: 13, text: '灯下是老周的早餐摊，一口铁锅，两张折叠桌。' } } });
const words = (line: ScriptLine) => line.segments.flatMap(segment => 'text' in segment ? [segment.text] : []).join('');

test('配给这一行: only the source link is folded into the line — it shows the picture, its words and the line count stay', () => {
  const { board, draft, video } = videoExample();
  const body = draft.data.body;
  const before = scriptLines(body, board.nodes);
  const line2 = before.find(line => line.number === 2)!;
  assert.equal(line2.shots.length, 0);
  const quote = newQuote(video);
  const result = writeTripLine(body, { at: line2.to, anchor: body.slice(line2.to - 20, line2.to), line: 2 }, [quote], 'shot');
  assert.equal(result.mode, 'shot');
  assert.equal(result.followed, true);
  // K1 / K9: the body stays Markdown and the link is the usual source line (the sentence's start, the excerpt's id).
  const link = `[来源：${video.data.title} 00:06](${formatSourceLink(video.id, 6, quote.id)})`;
  assert.equal(result.body, `${body.slice(0, line2.to)}\n\n${link}${body.slice(line2.to)}`);
  assert.equal(result.body.slice(result.from, result.to), link);
  const after = scriptLines(result.body, [...board.nodes, quote]);
  assert.equal(after.length, before.length, 'no new line');
  const given = after.find(line => line.number === 2)!;
  assert.ok(given.from <= result.from && result.from < given.to, 'the link belongs to line 2');
  assert.deepEqual(given.shots.map(shot => ({ quote: shot.quoteNodeId, start: shot.start, end: shot.end })), [{ quote: 'q-new', start: 6, end: 13 }]);
  assert.equal(given.duration, 7);
  assert.equal(words(given), words(line2), 'its words are unchanged');
  assert.deepEqual(after.map(line => [line.number, words(line)]), before.map(line => [line.number, words(line)]), 'every line keeps its number and words');
});

test('配给这一行 on a 画面： note gives it the shot; several runs become several shots of the same line', () => {
  const { board, draft, video } = videoExample();
  const body = draft.data.body;
  const before = scriptLines(body, board.nodes);
  const note = before.find(line => line.number === 1)!;
  assert.ok(isPictureNote(note));
  const first = newQuote(video);
  const second: BoardNode = { ...first, id: 'q-two', data: { ...first.data, citation: { ...first.data.citation!, start: 25, end: 31, text: '蒸笼一掀开，整条街都是白汽。' } } };
  const result = writeTripLine(body, { at: note.to, anchor: body.slice(note.to - 20, note.to), line: 1 }, [first, second], 'shot');
  const after = scriptLines(result.body, [...board.nodes, first, second]);
  assert.equal(after.length, before.length);
  const given = after.find(line => line.number === 1)!;
  assert.equal(given.label, '画面');
  assert.equal(words(given), words(note));
  assert.equal(isPictureNote(given), false, 'no longer a shot to find');
  assert.deepEqual(given.shots.map(shot => shot.quoteNodeId), ['q-new', 'q-two']);
  assert.equal(given.duration, 13);
});

test('配给这一行 whose line is gone takes no picture: the quotation goes to the end as a new line', () => {
  const { video } = videoExample();
  const result = writeTripLine('全部重写了。\n', { at: 40, anchor: '第二行写完了。', line: 2 }, [newQuote(video)], 'shot');
  assert.equal(result.followed, false);
  assert.equal(result.mode, 'line');
  assert.match(result.body, /^全部重写了。\n\n> 灯下是老周的早餐摊，一口铁锅，两张折叠桌。\n\n\[来源：/);
});

test('另起一行写进原话: the excerpt is written as its own blocks right after the line, and becomes the next script line with its shot', () => {
  const { board, draft, video } = videoExample();
  const body = draft.data.body;
  const model = buildScript(body, scriptTimeResolver(board.nodes));
  const lines = model.scenes.flatMap(scene => scene.rows).filter(row => 'number' in row) as { to: number; number?: number }[];
  const line2 = lines.find(line => line.number === 2)!;
  const quote = newQuote(video);
  const result = writeTripLine(body, { at: line2.to, anchor: body.slice(line2.to - 20, line2.to), line: 2 }, [quote], 'line');
  assert.equal(result.mode, 'line');
  assert.equal(result.body, insertDraftBlocks(body, resolveDraftInsertion(body, { at: line2.to, anchor: body.slice(line2.to - 20, line2.to) }), formatDraftQuote(quote)).body);
  assert.equal(result.body.slice(0, line2.to), body.slice(0, line2.to));
  assert.equal(result.body.slice(result.to), body.slice(line2.to), 'the rest of the body is untouched, blank line included');
  assert.equal(result.body.slice(result.from - 2, result.from), '\n\n');
  const nodes = [...board.nodes, quote];
  const after = buildScript(result.body, scriptTimeResolver(nodes));
  const rows = after.scenes.flatMap(scene => scene.rows).filter(row => 'number' in row) as { from: number; number?: number; shots: { quoteNodeId?: string }[]; duration?: number }[];
  const next = rows.find(row => row.from >= result.from)!;
  assert.equal(next.number, 3);
  assert.equal(next.shots[0]?.quoteNodeId, 'q-new');
  assert.equal(next.duration, 7);
  assert.equal(after.lineCount, model.lineCount + 1);
});

test('a body changed during the trip is followed by the words before the line, else the excerpt goes to the end', () => {
  const body = '## 开场\n\n第一行。\n\n第二行写完了。\n\n第三行。\n';
  const at = body.indexOf('第二行写完了。') + '第二行写完了。'.length;
  const point = { at, anchor: body.slice(0, at) };
  assert.equal(resolveDraftInsertion(body, point), at);
  const edited = `前言。\n\n${body}`;
  assert.equal(resolveDraftInsertion(edited, { at, anchor: '第二行写完了。' }), edited.indexOf('第二行写完了。') + '第二行写完了。'.length);
  assert.equal(resolveDraftInsertion('全部重写了。\n', { at, anchor: '第二行写完了。' }), null);
  assert.equal(resolveDraftInsertion('第二行写完了。\n\n第二行写完了。\n', { at: 999, anchor: '第二行写完了。' }), null, 'ambiguous words are not guessed');
  const end = insertDraftBlocks('只有一行。', null, '\n\n> 引文\n\n[来源：片子](field://v?t=1)\n\n');
  assert.equal(end.body, '只有一行。\n\n> 引文\n\n[来源：片子](field://v?t=1)\n');
  assert.equal(insertDraftBlocks('', 0, '> 引文').body, '> 引文\n');
});

test('the caret kept for the way back moves with the words after the new lines', () => {
  const { board, draft, video } = videoExample();
  const session = new DraftNavigationSession();
  const at = draft.data.body.indexOf('再交代时间。') + '再交代时间。'.length;
  session.open(board, { draftId: draft.id, sourceId: video.id, editor: { ...editor, selectionStart: at, selectionEnd: at + 10 }, insertAfter: at, line: 2 }, 'canvas', board.viewport);
  session.shiftReturn(at, 50);
  const grown = { ...board, nodes: board.nodes.map(node => node.id === draft.id ? { ...node, data: { ...node.data, body: `${node.data.body}${'x'.repeat(50)}` } } : node) };
  const back = session.returnToDraft(grown)!;
  assert.equal(back.restore.editor.selectionStart, at, 'a caret at the end of the line stays');
  assert.equal(back.restore.editor.selectionEnd, at + 60);
});

// The watching page offers 配给这一行 / 另起一行写进原话 only on a “补一个镜头” trip, never in a read-only window.

function renderWatch(overrides: Partial<BoardActions>) {
  const noop = () => {};
  const video: BoardNode = { id: 'film', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'video', title: '片子', body: '', mediaId: 'm', transcript: [{ id: 'a', start: 0, end: 2, text: '第一句。' }, { id: 'b', start: 2, end: 5, text: '第二句。' }] } };
  // An excerpt not written into any draft yet: the 来历 list offers it to the trip's line too.
  const excerpt: BoardNode = { id: 'ex', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: '摘录', body: '', citation: { nodeId: video.id, title: '片子', start: 2, end: 5, text: '第二句。' } } };
  const actions: BoardActions = {
    updateCard: () => true, openCard: noop, deleteCard: noop, duplicateCard: noop, addQuote: () => true, addTextQuote: () => true, focusSource: noop,
    openDraftSource: () => true, draftReturn: null, returnToDraft: () => true, draftRestore: null, completeDraftRestore: noop,
    getMediaUrl: id => id ? 'blob:film' : undefined, activeVideo: video.id, inspectedId: video.id, playVideo: noop,
    videoPlaybackVersion: 0, getVideoPlayback: () => ({ time: 0, paused: true }), bindVideoPlayer: noop, captureVideoPlayback: noop, restoreVideoPlayback: noop,
    setPendingTranscriptEdit: noop, cancelVideoImport: noop, retryVideoImport: noop, videoImportAvailable: true, videoImportActionPending: () => false,
    nodes: [video, excerpt], writeLinesToDraft: () => true, writeToDraft: noop, ...overrides,
  };
  return renderToStaticMarkup(createElement(BoardContext.Provider, { value: actions }, createElement(Inspector, { node: video, onClose: noop, onImportSubtitles: noop, onNotify: noop })));
}

test('配给这一行 (main) and 另起一行写进原话 appear on a 补一个镜头 trip only, with the line in their names', () => {
  const trip = renderWatch({ draftReturn: { draftId: 'draft', title: '分镜', insert: { line: 2 } } });
  const main = getByRole(trip, 'button', '把正在播放的这一句配给第 2 行');
  assert.equal(isDisabled(main), false);
  assert.equal(textContent(main).trim(), '配给这一行');
  assert.ok(hasClass(main, 'btn--soft'), 'the main action');
  const newline = getByRole(trip, 'button', '把正在播放的这一句另起一行写进原话，在第 2 行之后');
  assert.equal(isDisabled(newline), false);
  assert.ok(!hasClass(newline, 'btn--soft'));
  assert.match(textContent(trip), /为第 2 行挑一个镜头/);
  // The excerpt not written yet: the same two choices in the 来历 list, instead of 写进文稿.
  getByRole(trip, 'button', '配给第 2 行');
  getByRole(trip, 'button', '另起一行写进原话，在第 2 行之后');
  assertNone(trip, { role: 'button', name: '写进文稿' });
  const trips = /配给|另起一行写进原话/;
  const ordinary = renderWatch({ draftReturn: { draftId: 'draft', title: '分镜' } });
  assertNone(ordinary, { role: 'button', name: trips });
  const readOnly = renderWatch({ draftReturn: { draftId: 'draft', title: '分镜', insert: { line: 2 } }, readOnly: true });
  assertNone(readOnly, { role: 'button', name: trips });
});
