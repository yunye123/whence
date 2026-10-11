import assert from 'node:assert/strict';
import test from 'node:test';
import { createNode } from '../src/board-utils';
import { latestEditedDraft } from '../src/app/useRecentDraftEdits';
import { defaultScriptDraft } from '../src/dialogs/export-format';

test('export follows the latest text edit after leaving its editor, while an open draft keeps priority', () => {
  const first = createNode('draft', { x: 0, y: 0 });
  const second = createNode('draft', { x: 500, y: 0 });
  const before = [first, second];
  const edited = { ...first, data: { ...first.data, body: '保留原话😀\n\n[出处](field://node/source?quote=q)' } };
  const after = [edited, second];
  const snapshot = JSON.stringify(after);
  const latest = latestEditedDraft(before, after);
  assert.equal(latest, first.id);
  assert.equal(defaultScriptDraft(after, null, latest)?.id, first.id);
  assert.equal(defaultScriptDraft(after, second.id, latest)?.id, second.id);
  assert.equal(JSON.stringify(after), snapshot, 'selection never writes draft fields');
});

test('moving cards does not change the export draft; new drafts and undoing text count as edits', () => {
  const first = createNode('draft', { x: 0, y: 0 });
  const moved = { ...first, position: { x: 150, y: 90 } };
  assert.equal(latestEditedDraft([first], [moved]), undefined);
  const second = createNode('draft', { x: 500, y: 0 });
  assert.equal(latestEditedDraft([first], [first, second]), second.id);
  const edited = { ...first, data: { ...first.data, body: '新的正文' } };
  assert.equal(latestEditedDraft([edited], [first]), first.id);
  assert.equal(latestEditedDraft([first], []), undefined);
  assert.equal(defaultScriptDraft([second], null, first.id)?.id, second.id, 'removed recent draft falls back safely');
});
