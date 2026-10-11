import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { referenceExtension, referenceField, referenceScope } from '../src/inspector/draft-editor/references';
import { referencedParagraphs } from '../src/inspector/draft-editor/markdown';
import { placeReferencePopover } from '../src/inspector/draft-editor/ReferencePopover';
import { history, undoDepth, redoDepth } from '@codemirror/commands';
import { draftSessionState, rememberDraftSession } from '../src/inspector/draft-editor/session';

test('source-line stamps preserve raw links, hoisting, atomics and whole-draft numbering', () => {
  const body = '第一段🙂。\n\n> 原话，保留。\n\n[来源：甲](field://node/source?quote=excerpt&t=06.250)\n\n正文“原话”[乙](field://node/other)。';
  const state = EditorState.create({ doc: body, extensions: [referenceExtension] });
  assert.equal(state.doc.toString(), body);
  const field = state.field(referenceField);
  assert.deepEqual(field.spans.map(span => [span.index, span.mode]), [[1, 'sup'], [2, 'sup']]);
  const widgets: boolean[] = [];
  field.decorations.between(0, body.length, (_from, _to, decoration) => {
    if (decoration.spec.widget) widgets.push(decoration.spec.widget.sourceLine);
  });
  assert.deepEqual(widgets, [true, false]);
  assert.deepEqual([...referencedParagraphs(state)], [2, 3]);
  const span = field.spans[0];
  const removed = state.update({ changes: { from: span.hideFrom, to: span.hideTo, insert: '' } }).state;
  assert.equal(removed.doc.toString(), body.slice(0, span.hideFrom) + body.slice(span.hideTo));
  assert.equal(removed.field(referenceField).spans.length, 1);
  const scoped = EditorState.create({ doc: '[甲](field://node/source)', extensions: [referenceExtension, referenceScope.of({ base: 7 })] });
  assert.equal(scoped.field(referenceField).spans[0].index, 8);
});

test('orphan source lines and multiline quotations mark their shared paragraph without inventing a paragraph', () => {
  const orphan = EditorState.create({ doc: '[甲](field://node/a)\n\n## 小标题\n\n> 第一行\n> 第二行\n\n[乙](field://node/b)\n\n后文', extensions: [referenceExtension] });
  assert.deepEqual([...referencedParagraphs(orphan)], [1]);
});

test('popover clamps the measured stamp bounds rather than the retired 14px tag overhang', () => {
  const nearLeft = placeReferencePopover({ panelLeft: 0, panelRight: 340, centre: 8, width: 300, stampInset: 0 });
  assert.deepEqual(nearLeft, { left: 12, arrow: 14 });
  const nearRight = placeReferencePopover({ panelLeft: 0, panelRight: 340, centre: 335, width: 300, stampInset: 0 });
  assert.deepEqual(nearRight, { left: 28, arrow: 286 });
  assert.deepEqual(placeReferencePopover({ panelLeft: 100, panelRight: 480, centre: 250, width: 300, stampInset: -6 }), { left: 168, arrow: 82 });
});

test('a source trip restores history only for the same draft and exact unchanged raw body', () => {
  const state = EditorState.create({ doc: '第一段🙂', extensions: [history(), referenceExtension] });
  const edited = state.update({ changes: { from: state.doc.length, insert: '\n\n[来源](field://node/a)' } }).state;
  rememberDraftSession('session-a', edited);
  const back = draftSessionState('session-a', edited.doc.toString(), [history(), referenceExtension]);
  assert.equal(undoDepth(back), 1); assert.equal(redoDepth(back), 0);
  assert.equal(back.doc.toString(), edited.doc.toString());
  assert.equal(undoDepth(draftSessionState('session-b', edited.doc.toString(), history())), 0);
  assert.equal(undoDepth(draftSessionState('session-a', '外部修改的正文', history())), 0);
});
