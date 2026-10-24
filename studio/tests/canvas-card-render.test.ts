import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider, type Node, type NodeProps } from '@xyflow/react';
import CanvasCard from '../src/CanvasCard';
import { CardContext, type CardActions } from '../src/board-context';
import type { CardData, CardKind } from '../src/model';
import { assertNone, closest, getBy, getByLabel, hasAttr, hasClass, isButton, roleOf, textContent } from './helpers/markup';

// Behaviour contracts only (accessible names, roles, React Flow interaction classes, inert, no autoplay).
// Presentational details are intentionally not asserted so the card redesign can change them freely:
// - BEM class names and complete class strings (`field-card__poster-button`, `field-card__surface`, …),
//   JSX attribute order and wrapper element types were dropped (EN-M2, map-tests §3.1 "B+S").
// - `data-note-preview` (a styling hook, S) was dropped; the contract is that the preview shows the body
//   without any text field that could trap focus.
// - The `is-hand` state class (S) was dropped; the contract is that card controls sit inside an `inert` subtree.
// React Flow interaction classes (`nodrag`, `nowheel`, `nokey`, `card-drag-content`) are behaviour, not style.

const noop = () => {};
function render(kind: CardKind, overrides: Partial<CardActions> = {}) {
  const actions: CardActions = {
    updateCard: () => true, openCard: noop, deleteCard: noop, duplicateCard: noop, addQuote: () => false, focusSource: noop,
    getMediaUrl: id => id ? 'blob:isolated-media' : undefined, activeVideo: null, inspectedId: null, playVideo: noop,
    videoPlaybackVersion: 0, getVideoPlayback: () => ({ time: 0, paused: true }), bindVideoPlayer: noop,
    captureVideoPlayback: noop, restoreVideoPlayback: noop, cancelVideoImport: noop, retryVideoImport: noop,
    videoImportAvailable: true, videoImportActionPending: () => false, sourceNodeIds: new Set(), tool: 'select',
    ...overrides,
  };
  const props = { id: 'sample', selected: true, data: { kind, title: '公开样本', body: '保留这段正文。', mediaId: 'public-media' } } as NodeProps<Node<CardData>>;
  return renderToStaticMarkup(createElement(ReactFlowProvider, null,
    createElement(CardContext.Provider, { value: actions }, createElement(CanvasCard, props)),
  ));
}

test('note preview has no input focus trap and read-only cards expose reading without mutation', () => {
  const editable = render('note');
  assert.match(textContent(editable), /保留这段正文。/);
  assertNone(editable, { role: 'textbox' }, 'the note preview must not mount a text field');
  assertNone(editable, { attrs: { contenteditable: true } }, 'the note preview must not mount an editable region');
  const edit = getByLabel(editable, '编辑笔记：公开样本');
  assert.ok(isButton(edit), 'editing is an explicit labelled button');
  assertNone(editable, { className: 'nokey' }, 'preview and its action remain available for canvas multiselection');
  const readOnly = render('note', { readOnly: true });
  assert.ok(isButton(getByLabel(readOnly, '展开阅读：公开样本')), 'read-only cards offer reading');
  assertNone(readOnly, { label: /^编辑笔记：/ }, 'read-only cards must not offer editing (positive control: the editable render above)');
  assert.doesNotMatch(textContent(readOnly), /复制卡片|移除卡片/);
  assertNone(readOnly, { role: 'textbox' });
});

test('media previews are draggable surfaces with separate labelled actions', () => {
  const video = render('video');
  const play = getByLabel(video, '播放：公开样本');
  assert.ok(isButton(play));
  assert.ok(hasClass(play, 'nodrag') && hasClass(play, 'nowheel'), 'the play action does not start a card drag or capture the wheel');
  assert.ok(closest(play, { className: 'card-drag-content' }), 'the poster around the play action is a card drag surface');
  assertNone(video, { tag: 'video' }, 'the poster does not mount a player before the user asks for it');
  assertNone(video, { attrs: { autoplay: true } });
  assertNone(video, { className: 'nokey' }, 'the ordinary poster and play action do not bypass canvas multiselection');
  const playing = render('video', { activeVideo: 'sample' });
  const player = getBy(playing, { tag: 'video' });
  for (const token of ['nodrag', 'nowheel', 'nokey']) assert.ok(hasClass(player, token), `the active player carries ${token}`);
  // CANVAS-14 (K12): the card draws its own controls instead of the browser strip; they stay real, labelled,
  // keyboard-reachable controls that neither start a card drag nor capture the wheel.
  assert.ok(!hasAttr(player, 'controls'), 'the browser control strip (download, picture-in-picture) is not shown');
  const playPause = getByLabel(playing, /^(播放|暂停|重新播放)：公开样本$/);
  assert.ok(isButton(playPause) && hasClass(playPause, 'nodrag') && hasClass(playPause, 'nowheel'), 'play / pause is a labelled button');
  const position = getByLabel(playing, '播放位置：公开样本');
  assert.equal(roleOf(position), 'slider', 'the position is a native range slider (arrow keys, Home / End)');
  assert.ok(hasClass(position, 'nodrag') && hasClass(position, 'nowheel') && !hasClass(position, 'nokey'), 'only the video element bypasses canvas keys (K7)');
  assertNone(playing, { attrs: { autoplay: true } });
  const image = render('image');
  const expand = getByLabel(image, '查看原图：公开样本');
  assert.ok(isButton(expand));
  assert.ok(hasClass(expand, 'nodrag') && hasClass(expand, 'nowheel'));
  assert.ok(closest(expand, { className: 'card-drag-content' }), 'the image preview around the expand action is a card drag surface');
  const draft = render('draft');
  const openDraft = getByLabel(draft, '打开文稿编辑：公开样本');
  assert.ok(isButton(openDraft));
  assert.ok(closest(openDraft, { className: 'card-drag-content' }), 'the draft preview is a card drag surface');
});

test('the hand tool removes card controls from pointer and keyboard ownership', () => {
  const hand = render('video', { tool: 'hand' });
  assert.ok(closest(getByLabel(hand, '播放：公开样本'), { attrs: { inert: true } }), 'card controls sit inside an inert subtree');
  assert.ok(closest(getByLabel(hand, '更多操作：公开样本'), { attrs: { inert: true } }));
  const select = render('video');
  assert.equal(closest(getByLabel(select, '播放：公开样本'), { attrs: { inert: true } }), undefined, 'positive control: the select tool keeps controls reachable');
});
