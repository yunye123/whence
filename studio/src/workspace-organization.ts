import { createBoard } from './templates';
import { uid, type Workspace } from './model';

export function moveBoard(workspace: Workspace, id: string, targetId?: string, groupId?: string, after = false): Workspace {
  const board = workspace.boards.find(item => item.id === id);
  if (!board || id === targetId) return workspace;
  const target = workspace.boards.find(item => item.id === targetId);
  const group = target ? target.groupId : groupId;
  if (group && !workspace.groups?.some(item => item.id === group)) return workspace;
  const boards = workspace.boards.filter(item => item.id !== id);
  const moved = { ...board, groupId: group };
  let index = target ? boards.findIndex(item => item.id === target.id) + (after ? 1 : 0) : boards.length - [...boards].reverse().findIndex(item => item.groupId === group);
  if (!target && !boards.some(item => item.groupId === group)) index = boards.length;
  if (index < 0) index = boards.length;
  boards.splice(index, 0, moved);
  return { ...workspace, boards };
}

export function sortBoards(workspace: Workspace, sort: 'name' | 'updated'): Workspace {
  return { ...workspace, boards: [...workspace.boards].sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'zh-CN', { numeric: true }) : b.updatedAt.localeCompare(a.updatedAt)) };
}

/** The trash keeps at most this many boards; it never discards one on its own. */
export const TRASH_LIMIT = 100;

export function trashBoard(workspace: Workspace, id: string): Workspace {
  const board = workspace.boards.find(item => item.id === id);
  if (!board) return workspace;
  if ((workspace.trash?.length ?? 0) >= TRASH_LIMIT) throw new Error('回收站已满（100 张）。请先在回收站里永久删除不再需要的画布。');
  let boards = workspace.boards.filter(item => item.id !== id);
  if (!boards.length) boards = [createBoard('blank')];
  const activeBoardId = workspace.activeBoardId === id ? boards[Math.min(workspace.boards.findIndex(item => item.id === id), boards.length - 1)].id : workspace.activeBoardId;
  return { ...workspace, boards, activeBoardId, trash: [...(workspace.trash ?? []), { board, deletedAt: new Date().toISOString() }] };
}

export function restoreBoard(workspace: Workspace, id: string): Workspace {
  const entry = workspace.trash?.find(item => item.board.id === id);
  if (!entry) return workspace;
  if (workspace.boards.length >= 100) throw new Error('已有 100 张画布，请先整理后恢复。');
  const board = { ...entry.board, groupId: workspace.groups?.some(group => group.id === entry.board.groupId) ? entry.board.groupId : undefined };
  return { ...workspace, boards: [...workspace.boards, board], activeBoardId: board.id, trash: workspace.trash?.filter(item => item !== entry) };
}

/** Permanently remove one board from the trash (asked for by the person, after a confirmation). */
export function purgeTrashedBoard(workspace: Workspace, id: string): Workspace {
  if (!workspace.trash?.some(entry => entry.board.id === id)) return workspace;
  return { ...workspace, trash: workspace.trash.filter(entry => entry.board.id !== id) };
}

/** Permanently remove every board in the trash. */
export function emptyTrash(workspace: Workspace): Workspace {
  return workspace.trash?.length ? { ...workspace, trash: [] } : workspace;
}

export function addGroup(workspace: Workspace, title: string): Workspace {
  const name = title.trim();
  if (!name) throw new Error('请为分组取一个名称。');
  if ((workspace.groups?.length ?? 0) >= 50) throw new Error('最多创建 50 个画布分组。');
  return { ...workspace, groups: [...(workspace.groups ?? []), { id: uid(), title: name.slice(0, 100) }] };
}

export function removeGroup(workspace: Workspace, id: string): Workspace {
  return { ...workspace, groups: workspace.groups?.filter(group => group.id !== id), boards: workspace.boards.map(board => board.groupId === id ? { ...board, groupId: undefined } : board), trash: workspace.trash?.map(entry => entry.board.groupId === id ? { ...entry, board: { ...entry.board, groupId: undefined } } : entry) };
}
