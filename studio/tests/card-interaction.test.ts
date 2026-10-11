import test from 'node:test';
import assert from 'node:assert/strict';
import { canActivateCard, canKeepNoteEditing } from '../src/card-interaction';

test('selection modifiers and navigation never activate card controls', () => {
  assert.equal(canActivateCard('select'), true);
  assert.equal(canActivateCard(undefined, { shiftKey: false }), true);
  assert.equal(canActivateCard('select', { shiftKey: true }), false, 'Shift is reserved for multiselection, even on a media action');
  assert.equal(canActivateCard('hand'), false, 'panning cannot open, play or edit a card');
  assert.equal(canActivateCard('select', { defaultPrevented: true }), false, 'a consumed event cannot activate a second surface');
});

test('inline editing returns ownership to the canvas on deselection, hand navigation, overview or read-only state', () => {
  assert.equal(canKeepNoteEditing(true, false, 'select', false), true);
  assert.equal(canKeepNoteEditing(false, false, 'select', false), false);
  assert.equal(canKeepNoteEditing(true, false, 'hand', false), false);
  assert.equal(canKeepNoteEditing(true, false, 'select', true), false);
  assert.equal(canKeepNoteEditing(true, true, 'select', false), false);
});
