import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoard, validateWorkspace } from '../src/storage';
import { addGroup, emptyTrash, moveBoard, purgeTrashedBoard, removeGroup, restoreBoard, sortBoards, trashBoard } from '../src/workspace-organization';
import type { Board, Workspace } from '../src/model';

function board(id: string, title = id, groupId?: string): Board {
  return { ...createBoard('blank'), id, title, ...(groupId ? { groupId } : {}) };
}
function workspace(boards = [board('a'), board('b'), board('c')]): Workspace {
  return { schema: 1, activeBoardId: boards[0].id, boards };
}
const roundTrip = (value: Workspace) => validateWorkspace(JSON.parse(JSON.stringify(value)));

test('schema 1 workspaces without organization metadata keep their existing boards and active selection', () => {
  const original = workspace([board('old-video'), { ...board('old-writing'), category: 'writing' }]);
  original.activeBoardId = 'old-writing';
  assert.deepEqual(roundTrip(original), original);
  assert.equal(roundTrip(original).groups, undefined);
  assert.equal(roundTrip(original).trash, undefined);
});

test('group order, collapse state, board order and deleted contents survive the persisted contract', () => {
  const original = workspace([board('a', '文字资料', 'writing'), board('b', '影像参考', 'video')]);
  original.groups = [{ id: 'video', title: '视频', collapsed: true }, { id: 'writing', title: '文字', collapsed: false }];
  const deleted = trashBoard(original, 'a');
  const restored = roundTrip(deleted);
  assert.deepEqual(restored, deleted);
  assert.equal(restored.trash?.[0].board.title, '文字资料');
  assert.equal(restored.activeBoardId, 'b');
  assert.deepEqual(original.boards.map(item => item.id), ['a', 'b'], 'operations must not mutate their input');
});

test('invalid groups, duplicate live/deleted IDs and absent active boards reject before persistence', () => {
  const invalid: Workspace[] = [
    { ...workspace(), groups: [{ id: 'g', title: '组' }, { id: 'g', title: '重复' }] },
    { ...workspace(), groups: [{ id: 'g', title: '' }] },
    { ...workspace(), groups: [{ id: 'g', title: '组', collapsed: 'yes' as never }] },
    { ...workspace(), boards: [board('a', '孤立组', 'missing')] },
    { ...workspace(), boards: [board('a'), board('a')] },
    { ...workspace(), trash: [{ board: board('a'), deletedAt: new Date().toISOString() }] },
    { ...workspace(), activeBoardId: 'missing' },
  ];
  for (const value of invalid) assert.throws(() => roundTrip(value));
});

test('moving before/after a board joins its group without changing cards or active selection', () => {
  const original = workspace([board('a'), board('b', 'B', 'one'), board('c', 'C', 'one'), board('d', 'D', 'two')]);
  original.groups = [{ id: 'one', title: '一组' }, { id: 'two', title: '二组' }];
  const before = roundTrip(moveBoard(original, 'd', 'b'));
  assert.deepEqual(before.boards.map(item => item.id), ['a', 'd', 'b', 'c']);
  assert.equal(before.boards[1].groupId, 'one');
  assert.equal(before.activeBoardId, 'a');
  assert.deepEqual(before.boards[1].nodes, original.boards[3].nodes);
  const after = roundTrip(moveBoard(original, 'a', 'c', undefined, true));
  assert.deepEqual(after.boards.map(item => item.id), ['b', 'c', 'a', 'd']);
  assert.equal(after.boards[2].groupId, 'one');
  assert.equal(moveBoard(original, 'a', 'a'), original);
});

test('moving into an empty group and back to ungrouped keeps each board exactly once', () => {
  const original = workspace([board('a'), board('b', 'B', 'one'), board('c')]);
  original.groups = [{ id: 'one', title: '一组' }, { id: 'empty', title: '空组' }];
  const joined = roundTrip(moveBoard(original, 'a', undefined, 'empty'));
  assert.equal(joined.boards.find(item => item.id === 'a')?.groupId, 'empty');
  assert.deepEqual(joined.boards.map(item => item.id), ['b', 'c', 'a']);
  const ungrouped = roundTrip(moveBoard(joined, 'a'));
  assert.equal(ungrouped.boards.find(item => item.id === 'a')?.groupId, undefined);
  assert.equal(new Set(ungrouped.boards.map(item => item.id)).size, original.boards.length);
  assert.equal(moveBoard(original, 'a', undefined, 'unknown'), original);
  assert.equal(moveBoard(original, 'missing', 'b'), original);
});

test('natural title and recent-update sorting preserve ownership and leave original order intact', () => {
  const original = workspace([board('10', '资料 10'), board('2', '资料 2', 'g'), board('1', '资料 1')]);
  original.groups = [{ id: 'g', title: '组' }];
  original.boards.forEach((item, index) => { item.updatedAt = `2026-10-0${index + 1}T00:00:00.000Z`; });
  assert.deepEqual(roundTrip(sortBoards(original, 'name')).boards.map(item => item.id), ['1', '2', '10']);
  assert.deepEqual(roundTrip(sortBoards(original, 'updated')).boards.map(item => item.id), ['1', '2', '10']);
  assert.equal(sortBoards(original, 'name').boards.find(item => item.id === '2')?.groupId, 'g');
  assert.deepEqual(original.boards.map(item => item.id), ['10', '2', '1']);
});

test('deleting the last canvas creates a valid empty canvas and restores the exact deleted content', () => {
  const original = workspace([createBoard('demo')]);
  const deleted = roundTrip(trashBoard(original, original.boards[0].id));
  assert.equal(deleted.boards.length, 1);
  assert.notEqual(deleted.boards[0].id, original.boards[0].id);
  assert.equal(deleted.boards[0].nodes.length, 0);
  assert.equal(deleted.activeBoardId, deleted.boards[0].id);
  assert.deepEqual(deleted.trash?.[0].board, original.boards[0]);
  const restored = roundTrip(restoreBoard(deleted, original.boards[0].id));
  assert.equal(restored.activeBoardId, original.boards[0].id);
  assert.deepEqual(restored.boards[1], original.boards[0]);
  assert.equal(restored.trash?.length, 0);
});

test('deleting a group unassigns its live and deleted boards without deleting their content', () => {
  const original = workspace([board('a', 'A', 'g'), board('b')]);
  original.groups = [{ id: 'g', title: '组' }, { id: 'keep', title: '保留组' }];
  const withoutGroup = roundTrip(removeGroup(trashBoard(original, 'a'), 'g'));
  assert.deepEqual(withoutGroup.groups?.map(item => item.id), ['keep']);
  assert.equal(withoutGroup.trash?.[0].board.groupId, undefined);
  const restored = roundTrip(restoreBoard(withoutGroup, 'a'));
  assert.equal(restored.boards.find(item => item.id === 'a')?.groupId, undefined);
  assert.equal(restored.boards.find(item => item.id === 'a')?.title, 'A');
});

test('group creation rejects blank names and bounds groups and trash without silently discarding data', () => {
  const original = workspace();
  assert.throws(() => addGroup(original, '   '));
  const added = roundTrip(addGroup(original, '  新分组  '));
  assert.equal(added.groups?.[0].title, '新分组');
  assert.throws(() => addGroup({ ...original, groups: Array.from({ length: 50 }, (_, index) => ({ id: `g${index}`, title: '组' })) }, '超额'));
  const fullTrash = { ...original, trash: Array.from({ length: 100 }, (_, index) => ({ board: board(`deleted-${index}`), deletedAt: original.boards[0].createdAt })) };
  assert.throws(() => trashBoard(fullTrash, 'a'), /100/);
  assert.equal(fullTrash.trash.length, 100);
});

test('a full trash is emptied only on request: one board or all of them, live boards untouched', () => {
  const original = workspace();
  const full = { ...original, trash: Array.from({ length: 100 }, (_, index) => ({ board: board(`deleted-${index}`), deletedAt: original.boards[0].createdAt })) };
  const purged = roundTrip(purgeTrashedBoard(full, 'deleted-7'));
  assert.equal(purged.trash?.length, 99);
  assert.ok(!purged.trash?.some(entry => entry.board.id === 'deleted-7'));
  assert.deepEqual(purged.boards.map(item => item.id), ['a', 'b', 'c']);
  assert.equal(purgeTrashedBoard(full, 'a'), full, 'a live board is never purged');
  const room = trashBoard(purged, 'a');
  assert.equal(room.trash?.length, 100);
  const emptied = roundTrip(emptyTrash(full));
  assert.equal(emptied.trash?.length ?? 0, 0);
  assert.deepEqual(emptied.boards.map(item => item.id), ['a', 'b', 'c']);
  assert.equal(emptyTrash(original), original);
});
