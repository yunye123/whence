import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftNavigationSession, type DraftEditorState } from '../src/draft-navigation';
import type { Board, BoardNode } from '../src/model';

function node(id: string, kind: BoardNode['data']['kind'], body = ''): BoardNode {
  return { id, type: 'card', position: { x: 0, y: 0 }, data: { kind, title: `标题 ${id}`, body } };
}
function fixture() {
  const draft = node('draft', 'draft', '一二三四五六七八九十');
  const sources = [node('first', 'video'), node('second', 'note'), node('third', 'video')];
  const board: Board = {
    id: 'board', title: '创作', description: '', category: 'writing', createdAt: '', updatedAt: '',
    nodes: [draft, ...sources], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  };
  const editor: DraftEditorState = {
    selectionStart: 2, selectionEnd: 8, selectionDirection: 'backward',
    editorScrollTop: 251.5, editorScrollLeft: 0, inspectorScrollTop: 619,
    referencesOpen: true, versionsOpen: false, writingExpanded: true,
  };
  const viewport = { x: -392.5, y: 144, zoom: 0.72 };
  return { session: new DraftNavigationSession(), board, draft, sources, editor, viewport };
}

test('opens the exact requested third source and preserves both a precise time and zero', () => {
  const { session, board, draft, sources, editor, viewport } = fixture();
  assert.deepEqual(session.open(board, { draftId: draft.id, sourceId: sources[2].id, time: 42.375, editor }, 'canvas', viewport),
    { nodeId: 'third', time: 42.375 });
  assert.deepEqual(session.info(board), { draftId: 'draft', title: '标题 draft' });
  assert.deepEqual(session.open(board, { draftId: draft.id, sourceId: sources[2].id, time: 0, editor }, 'canvas', viewport),
    { nodeId: 'third', time: 0 });
  assert.deepEqual(session.open(board, { draftId: draft.id, sourceId: sources[1].id, editor }, 'canvas', viewport),
    { nodeId: 'second' });
});

test('a quote-aware trip carries the verified excerpt ID and optional video time to the source', () => {
  const { session, board, draft, editor, viewport } = fixture();
  const quote = node('excerpt', 'quote');
  quote.data.citation = { nodeId: 'third', title: '第三段', text: '快照', start: 12 };
  board.nodes.push(quote);
  assert.deepEqual(session.open(board, { draftId: draft.id, sourceId: 'third', quoteNodeId: quote.id, time: 12, editor }, 'canvas', viewport),
    { nodeId: 'third', quoteNodeId: quote.id, time: 12 });
  assert.equal(session.returnToDraft(board)?.draftId, draft.id);
});

test('missing, forged and wrong-source quote IDs cannot replace the return route or a pending restore', () => {
  for (const pending of [false, true]) {
    const { session, board, draft, editor, viewport } = fixture();
    const quote = node('wrong-source', 'quote'), legacy = node('no-citation', 'quote');
    quote.data.citation = { nodeId: 'first', title: '', text: '快照' };
    board.nodes.push(quote, legacy);
    session.open(board, { draftId: draft.id, sourceId: 'first', editor }, 'outline', viewport);
    const restore = pending ? session.returnToDraft(board)!.restore : null;
    const before = structuredClone(board);
    for (const quoteNodeId of ['missing-quote', 'second', 'wrong-source', 'no-citation', '']) {
      assert.throws(() => session.open(board, { draftId: draft.id, sourceId: 'third', quoteNodeId, editor }, 'canvas', { x: 9, y: 9, zoom: 1 }), /摘录与来源/);
      assert.deepEqual(board, before);
      if (pending) assert.deepEqual(session.restoreInfo(board), restore);
      else assert.equal(session.info(board)?.draftId, draft.id);
    }
    if (!pending) assert.equal(session.returnToDraft(board)?.view, 'outline');
  }
});

test('returns original view, viewport, selection direction, scroll positions, folding and expanded writing state', () => {
  const { session, board, draft, editor, viewport } = fixture();
  session.open(board, { draftId: draft.id, sourceId: 'third', editor }, 'outline', viewport);
  draft.data.title = '离开后改过标题';
  assert.equal(session.info(board)?.title, '离开后改过标题');
  const result = session.returnToDraft(board)!;
  assert.deepEqual(result, { draftId: draft.id, view: 'outline', viewport, restore: { draftId: draft.id, token: 1, editor } });
  assert.equal(session.info(board), null);
  assert.equal(session.returnToDraft(board), null);
  assert.deepEqual(session.restoreInfo(board), result.restore);
  session.complete(result.restore.token);
  assert.equal(session.restoreInfo(board), null);
});

test('missing source or draft, self source and invalid time do not replace an existing return route or mutate board', () => {
  const { session, board, draft, editor, viewport } = fixture();
  session.open(board, { draftId: draft.id, sourceId: 'first', editor }, 'outline', viewport);
  const before = structuredClone(board);
  for (const [patch, message] of [
    [{ sourceId: 'missing' }, /来源已不存在/],
    [{ sourceId: draft.id }, /自己的来源/],
    [{ draftId: 'missing' }, /当前文稿已不存在/],
    [{ draftId: 'first' }, /当前文稿已不存在/],
    [{ time: -1 }, /来源时间无效/],
    [{ time: Infinity }, /来源时间无效/],
    [{ time: NaN }, /来源时间无效/],
    [{ time: 604801 }, /来源时间无效/],
  ] as const) {
    assert.throws(() => session.open(board, { draftId: draft.id, sourceId: 'third', editor, ...patch }, 'canvas', { x: 1, y: 2, zoom: 1 }), message);
    assert.deepEqual(session.info(board), { draftId: draft.id, title: draft.data.title });
    assert.deepEqual(board, before);
  }
  assert.deepEqual(session.returnToDraft(board), {
    draftId: draft.id, view: 'outline', viewport, restore: { draftId: draft.id, token: 1, editor },
  });
});

test('a deleted source still allows return to the draft', () => {
  const { session, board, draft, editor, viewport } = fixture();
  session.open(board, { draftId: draft.id, sourceId: 'third', editor }, 'canvas', viewport);
  board.nodes = board.nodes.filter(source => source.id !== 'third');
  session.reconcile(board);
  assert.equal(session.info(board)?.draftId, draft.id);
  assert.equal(session.returnToDraft(board)?.draftId, draft.id);
});

test('board switches, deleted drafts, changed draft kinds and closing the board clear return and pending restore state', () => {
  for (const pending of [false, true]) {
    for (const change of ['switch', 'delete', 'kind', 'close'] as const) {
      const { session, board, draft, editor, viewport } = fixture();
      session.open(board, { draftId: draft.id, sourceId: 'third', editor }, 'canvas', viewport);
      if (pending) session.returnToDraft(board);
      let current: Board | null = board;
      if (change === 'switch') current = { ...board, id: 'other-board' };
      if (change === 'delete') board.nodes = board.nodes.filter(source => source.id !== draft.id);
      if (change === 'kind') draft.data.kind = 'note';
      if (change === 'close') current = null;
      session.reconcile(current);
      assert.equal(session.info(board), null, `${change}, pending=${pending}`);
      assert.equal(session.restoreInfo(board), null, `${change}, pending=${pending}`);
      assert.equal(session.returnToDraft(board), null);
    }
  }
});

test('a new trip replaces the single return route instead of stacking it', () => {
  const { session, board, draft, editor, viewport } = fixture();
  session.open(board, { draftId: draft.id, sourceId: 'first', editor }, 'outline', viewport);
  const nextDraft = node('next-draft', 'draft', '另一个文稿');
  board.nodes.push(nextDraft);
  session.open(board, { draftId: nextDraft.id, sourceId: 'third', editor: { ...editor, selectionStart: 0, selectionEnd: 0 } }, 'canvas', board.viewport);
  assert.equal(session.info(board)?.draftId, nextDraft.id);
  const result = session.returnToDraft(board)!;
  assert.equal(result.draftId, nextDraft.id);
  assert.equal(result.view, 'canvas');
  assert.deepEqual(result.viewport, board.viewport);
  assert.equal(session.returnToDraft(board), null);
});

test('late completion cannot clear a newer restore, including after an explicit clear', () => {
  const { session, board, draft, editor, viewport } = fixture();
  const open = () => session.open(board, { draftId: draft.id, sourceId: 'third', editor }, 'canvas', viewport);
  open();
  const first = session.returnToDraft(board)!.restore;
  open();
  assert.equal(session.restoreInfo(board), null);
  const second = session.returnToDraft(board)!.restore;
  assert.ok(second.token > first.token);
  session.complete(first.token);
  assert.deepEqual(session.restoreInfo(board), second);
  session.clear();
  open();
  const third = session.returnToDraft(board)!.restore;
  assert.ok(third.token > second.token);
  session.complete(second.token);
  assert.deepEqual(session.restoreInfo(board), third);
  session.complete(third.token);
  assert.equal(session.restoreInfo(board), null);
});

test('invalid navigation leaves a pending restore intact', () => {
  const { session, board, draft, editor, viewport } = fixture();
  session.open(board, { draftId: draft.id, sourceId: 'third', editor }, 'canvas', viewport);
  const restore = session.returnToDraft(board)!.restore;
  assert.throws(() => session.open(board, { draftId: draft.id, sourceId: 'gone', editor }, 'outline', viewport));
  assert.deepEqual(session.restoreInfo(board), restore);
});

test('input and output snapshots are detached and current draft length clips the returned selection', () => {
  const { session, board, draft, editor, viewport } = fixture();
  const originalEditor = { ...editor };
  const originalViewport = { ...viewport };
  session.open(board, { draftId: draft.id, sourceId: 'third', editor }, 'canvas', viewport);
  editor.selectionStart = 9;
  editor.referencesOpen = false;
  editor.writingExpanded = false;
  viewport.x = 999;
  const info = session.info(board)!;
  info.title = '不应写回';
  assert.equal(draft.data.title, '标题 draft');
  draft.data.body = '缩短正文';
  const result = session.returnToDraft(board)!;
  assert.deepEqual(result.viewport, originalViewport);
  assert.deepEqual(result.restore.editor, { ...originalEditor, selectionEnd: 4 });
  result.restore.editor.selectionStart = 0;
  result.restore.editor.referencesOpen = false;
  result.viewport.x = 77;
  const firstRead = session.restoreInfo(board)!;
  assert.equal(firstRead.editor.selectionStart, 2);
  assert.equal(firstRead.editor.referencesOpen, true);
  assert.equal(firstRead.editor.writingExpanded, true);
  firstRead.editor.selectionEnd = 0;
  draft.data.body = '短';
  assert.deepEqual(session.restoreInfo(board)?.editor, { ...originalEditor, selectionStart: 1, selectionEnd: 1 });
  assert.equal(draft.data.body, '短');
});

test('invalid positions are safely normalized while valid zero and folding booleans survive exactly', () => {
  const { session, board, draft, editor } = fixture();
  session.open(board, {
    draftId: draft.id, sourceId: 'third', editor: {
      ...editor, selectionStart: -2.9, selectionEnd: Infinity,
      editorScrollTop: NaN, editorScrollLeft: -2, inspectorScrollTop: Infinity,
      referencesOpen: undefined, versionsOpen: true, writingExpanded: undefined,
    },
  }, 'canvas', { x: Infinity, y: -25, zoom: 0 });
  const result = session.returnToDraft(board)!;
  assert.deepEqual(result.viewport, { x: 0, y: -25, zoom: 1 });
  assert.deepEqual(result.restore.editor, {
    selectionStart: 0, selectionEnd: 0, selectionDirection: 'backward',
    editorScrollTop: 0, editorScrollLeft: 0, inspectorScrollTop: 0, referencesOpen: false, versionsOpen: true, writingExpanded: false,
  });
  session.open(board, {
    draftId: draft.id, sourceId: 'first', editor: {
      selectionStart: 0, selectionEnd: 0, selectionDirection: 'none',
      editorScrollTop: 0, editorScrollLeft: 0, inspectorScrollTop: 0,
    },
  }, 'outline', { x: 0, y: 0, zoom: 1 });
  assert.deepEqual(session.returnToDraft(board)!.restore.editor, {
    selectionStart: 0, selectionEnd: 0, selectionDirection: 'none',
    editorScrollTop: 0, editorScrollLeft: 0, inspectorScrollTop: 0, referencesOpen: false, versionsOpen: false, writingExpanded: false,
  });
});
