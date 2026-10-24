import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDraft, dismissEscape, emptyPanels, escapeCloses, placeOpenedCard, releaseIds } from '../src/app/panel-slots';

test('a draft stays on the right; notes replace only the left column; video covers both', () => {
  let slots = placeOpenedCard(emptyPanels(), { id: 'draft', kind: 'draft' });
  assert.deepEqual(slots, { pinned: 'draft', companion: null, solo: null, watch: null, focused: 'draft' });
  assert.equal(escapeCloses(slots), false, 'Esc does not close a pinned draft by itself');
  slots = placeOpenedCard(slots, { id: 'note', kind: 'note' });
  slots = placeOpenedCard(slots, { id: 'link', kind: 'link' });
  assert.equal(slots.pinned, 'draft');
  assert.equal(slots.companion, 'link');
  assert.equal(slots.watch, null);
  slots = dismissEscape(slots);
  assert.equal(slots.companion, null);
  assert.equal(slots.pinned, 'draft');
  slots = placeOpenedCard(slots, { id: 'video', kind: 'video' });
  assert.equal(slots.watch, 'video');
  assert.equal(slots.pinned, 'draft');
  assert.equal(slots.companion, null);
  slots = dismissEscape(slots);
  assert.equal(slots.watch, null);
  assert.equal(slots.pinned, 'draft', 'closing the watch page leaves the draft');
  slots = placeOpenedCard(slots, { id: 'quote', kind: 'quote' });
  slots = closeDraft(slots);
  assert.equal(slots.pinned, null);
  assert.equal(slots.solo, 'quote', 'the left card becomes the single right panel');
});

test('opening a draft keeps a note that was already the only panel, and drops a video from that place', () => {
  const note = placeOpenedCard(emptyPanels(), { id: 'note', kind: 'note' });
  const kept = placeOpenedCard(note, { id: 'draft', kind: 'draft' }, 'note');
  assert.equal(kept.pinned, 'draft');
  assert.equal(kept.companion, 'note');
  assert.equal(kept.watch, null);
  const video = placeOpenedCard(emptyPanels(), { id: 'video', kind: 'video' });
  const covered = placeOpenedCard(video, { id: 'draft', kind: 'draft' }, 'video');
  assert.equal(covered.pinned, 'draft');
  assert.equal(covered.companion, null);
  assert.equal(covered.solo, null);
});

test('closing a draft under a watch page leaves the video as the single panel', () => {
  const open = placeOpenedCard(placeOpenedCard(emptyPanels(), { id: 'draft', kind: 'draft' }), { id: 'video', kind: 'video' });
  const next = closeDraft({ ...open, companion: 'note' });
  assert.equal(next.solo, 'video');
  assert.equal(next.pinned, null);
  assert.equal(next.companion, null);
  assert.equal(next.watch, null);
});

test('deleting the draft promotes the left column; deleting the left card leaves the draft', () => {
  const open = placeOpenedCard(placeOpenedCard(emptyPanels(), { id: 'draft', kind: 'draft' }), { id: 'note', kind: 'note' });
  const promoted = releaseIds(open, ['draft'], false);
  assert.equal(promoted.solo, 'note');
  assert.equal(promoted.pinned, null);
  const kept = releaseIds(open, ['note'], true);
  assert.equal(kept.pinned, 'draft');
  assert.equal(kept.companion, null);
  assert.equal(kept.focused, 'draft');
});
