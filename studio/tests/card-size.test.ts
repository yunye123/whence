import assert from 'node:assert/strict';
import test from 'node:test';
import { createNode } from '../src/board-utils';
import { createBoard, validateBoard } from '../src/storage';
import { MAX_CARD_SIZE, getCardSizeLimits, resizeCard } from '../src/card-size';

test('keyboard resizing clamps oversized and undersized cards to persistent bounds without touching other content', () => {
  const note = createNode('note'), image = createNode('image');
  const board = { ...createBoard('blank'), nodes: [note, image] };
  const original = structuredClone(board);
  const resized = resizeCard(board, note.id, MAX_CARD_SIZE + 1, 0);
  assert.deepEqual(resized.nodes[0].style, { width: MAX_CARD_SIZE, height: 64 });
  assert.equal(resized.nodes[0].position, note.position);
  assert.equal(resized.nodes[0].data, note.data);
  assert.equal(resized.nodes[1], image);
  assert.deepEqual(board, original, 'the captured undo state remains unchanged');
  assert.doesNotThrow(() => validateBoard(resized));
  assert.deepEqual(resizeCard(board, image.id, 1, 1).nodes[1].style, { width: 80, height: 60 });
});

test('image limits admit picture rows at their own ratio (DESIGN_SYSTEM §6.15)', () => {
  const limits = getCardSizeLimits({ kind: 'image' });
  // A 3:4 picture in a 184px row and a 21:9 picture in a 72px strip are both valid card sizes.
  for (const [width, height] of [[138, 184], [168, 72], [120, 160]]) {
    assert.ok(width >= limits.minWidth && height >= limits.minHeight, `${width}×${height} fits the image limits`);
  }
  const image = createNode('image');
  const board = { ...createBoard('blank'), nodes: [image] };
  assert.deepEqual(resizeCard(board, image.id, 138, 184).nodes[0].style, { width: 138, height: 184 });
});

test('frame and pending-import minimums match pointer limits; invalid and unchanged commands are no-ops', () => {
  const frame = createNode('frame');
  const board = { ...createBoard('blank'), nodes: [frame] };
  assert.deepEqual(getCardSizeLimits(frame.data), { minWidth: 240, minHeight: 160, maxWidth: 10_000, maxHeight: 10_000 });
  // The redesigned import state is a progress edge on the media area, so a pending import no longer forces a tall card.
  const pending = { kind: 'video' as const, videoImport: { status: 'queued' } as NonNullable<typeof frame.data.videoImport> };
  assert.deepEqual(getCardSizeLimits(pending), getCardSizeLimits({ kind: 'video' }));
  for (const [width, height] of [[NaN, 300], [300, Infinity], [660, 450]]) assert.equal(resizeCard(board, frame.id, width, height), board);
  for (const kind of ['video', 'image', 'note', 'quote', 'draft', 'link', 'frame'] as const) {
    const limits = getCardSizeLimits({ kind });
    assert.ok(limits.minWidth > 0 && limits.minHeight > 0 && limits.maxWidth === MAX_CARD_SIZE && limits.maxHeight === MAX_CARD_SIZE, kind);
  }
  assert.equal(resizeCard(board, 'missing', 300, 300), board);
  assert.doesNotThrow(() => validateBoard(resizeCard(board, frame.id, 10_001, 10_001)));
});
