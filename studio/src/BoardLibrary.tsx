import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, DragEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowDownUp, ArrowUp, Check, ChevronDown, ChevronRight, Copy, Download, Folder, FolderPlus, GripVertical, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { Workspace, Board } from './model';
import { addGroup, emptyTrash, moveBoard, purgeTrashedBoard, removeGroup, restoreBoard, sortBoards, trashBoard, TRASH_LIMIT } from './workspace-organization';
import { isNative } from './native';
import { showToast } from './shell/Toasts';
import InspectorDialog from './InspectorDialog';

interface Props {
  workspace: Workspace;
  disabled: boolean;
  onSwitch(id: string): void;
  onNew(): void;
  onChange(change: (workspace: Workspace) => Workspace): void;
  /** Renames a board. The active board should go through the board history (one undo step); without it the workspace is changed directly. */
  onRename?(id: string, title: string): void;
  /** Duplicates a board (media, ids and folder storage are App concerns). The menu item appears only when provided. */
  onDuplicate?(id: string): void;
  /** Opens the export flow for a board. The menu item appears only when provided. */
  onExport?(id: string): void;
}
type Menu = { kind: 'board' | 'group' | 'sort'; id?: string; x: number; y: number };
type Dialog = { kind: 'group'; id?: string } | { kind: 'rename'; board: Board } | { kind: 'delete'; board: Board } | { kind: 'trash' } | { kind: 'purge'; board: Board } | { kind: 'empty-trash' } | null;
type DropTarget = { id: string; position: 'before' | 'after' | 'inside' } | null;

const untitled = (board: Board) => board.title || '未命名画布';
const cardCount = (board: Board) => board.nodes.filter(node => node.data.kind !== 'frame').length;
const cardSummary = (board: Board) => { const count = cardCount(board); return count ? `${count} 张卡片` : '空画布'; };

/** Unresolved native media and failed covers keep the same manuscript silhouette. */
function BoardCover({ cover }: { cover?: string }) {
  const [failed, setFailed] = useState<string>();
  const readable = cover && !/^(?:media|field-media):/i.test(cover) && cover !== failed;
  return <span className="board-nav__icon" aria-hidden="true">{readable
    ? <img className="board-cover" src={cover} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(cover)} />
    : <svg className="board-cover-fallback" width="24" height="16" viewBox="0 0 20 16" fill="none"><rect className="library-glyph__manuscript" x="4.5" y=".5" width="11" height="15"/><path className="library-glyph__line" d="M4.5 3.6h11M8 6.5h5.5M8 8.8h5.5M8 11.1h4"/></svg>}</span>;
}

function MenuItem({ icon, children, danger, ...rest }: { icon?: ReactNode; danger?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" role="menuitem" className={`board-menu-item${danger ? ' danger-action' : ''}`} {...rest}><span className="board-menu-icon" aria-hidden="true">{icon}</span><span className="board-menu-label">{children}</span></button>;
}

/** 画布树（§6.2 第 3–4 项）：分组、排序、拖动、画布“…”菜单与回收站。 */
export default function BoardLibrary({ workspace, disabled, onSwitch, onNew, onChange, onRename, onDuplicate, onExport }: Props) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState('');
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const dragging = useRef<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const isMenuOpen = (kind: Menu['kind'], id?: string) => menu?.kind === kind && menu.id === id;
  const restoreFocus = (trigger: HTMLButtonElement | null) => {
    if (trigger?.isConnected && !trigger.disabled) trigger.focus();
    else (document.querySelector<HTMLButtonElement>('.board-nav[aria-current="page"]:not(:disabled)') ?? document.querySelector<HTMLButtonElement>('.board-section-title button:not(:disabled)'))?.focus();
  };
  const closeMenu = (returnFocus = true) => {
    const trigger = menuTrigger.current;
    setMenu(null);
    if (returnFocus) requestAnimationFrame(() => restoreFocus(trigger));
  };
  const closeDialog = () => {
    const trigger = dialogTrigger.current;
    setDialog(null);
    requestAnimationFrame(() => restoreFocus(trigger));
  };
  const openDialog = (next: NonNullable<Dialog>, trigger = menuTrigger.current) => {
    dialogTrigger.current = trigger;
    if (trigger?.isConnected) trigger.focus();
    setMenu(null);
    setDialog(next);
  };
  const launchMenu = (kind: Menu['kind'], button: HTMLButtonElement, id?: string) => {
    if (isMenuOpen(kind, id)) { closeMenu(); return; }
    menuTrigger.current = button;
    const rect = button.getBoundingClientRect();
    setMenu({ kind, id, x: rect.left, y: rect.bottom + 6 });
  };
  useLayoutEffect(() => {
    if (!menu) return;
    const position = () => {
      const popover = menuRef.current;
      if (!popover) return;
      const rect = popover.getBoundingClientRect();
      const anchor = menuTrigger.current?.getBoundingClientRect();
      // Right-aligned to row-end triggers ("…"), left-aligned otherwise; flipped above when there is no room below.
      const preferred = anchor ? (menu.kind === 'sort' ? anchor.left : anchor.right - rect.width) : menu.x;
      const below = (anchor?.bottom ?? menu.y - 6) + 6;
      const top = below + rect.height > innerHeight - 8 && anchor && anchor.top - rect.height - 6 >= 8 ? anchor.top - rect.height - 6 : below;
      popover.style.left = `${Math.max(8, Math.min(preferred, innerWidth - rect.width - 8))}px`;
      popover.style.top = `${Math.max(8, Math.min(top, innerHeight - rect.height - 8))}px`;
    };
    position();
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); document.removeEventListener('scroll', position, true); };
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && !(event.target as Element)?.closest('[data-board-menu]')) setMenu(null); };
    document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  const commit = (action: (workspace: Workspace) => Workspace, returnFocus = true) => { closeMenu(returnFocus); onChange(action); };
  /** A change whose outcome decides the next message: true only when App applied it (a refused change, such as
   *  a full trash, is reported by App itself and must not be followed by a success toast). */
  const apply = (action: (workspace: Workspace) => Workspace) => {
    let applied = false;
    commit(current => { const next = action(current); applied = next !== current; return next; }, false);
    return applied;
  };
  const groupDialog = (id?: string, trigger?: HTMLButtonElement) => {
    setName(workspace.groups?.find(group => group.id === id)?.title ?? '');
    openDialog({ kind: 'group', id }, trigger ?? menuTrigger.current);
  };
  const renameDialog = (board: Board) => {
    setName(board.title);
    openDialog({ kind: 'rename', board });
  };
  const saveName = () => {
    const title = name.trim();
    if (!title || !dialog) return;
    if (dialog.kind === 'group') commit(current => dialog.id ? { ...current, groups: current.groups?.map(group => group.id === dialog.id ? { ...group, title: title.slice(0, 100) } : group) } : addGroup(current, title), false);
    else if (dialog.kind === 'rename') {
      closeMenu(false);
      if (onRename) onRename(dialog.board.id, title.slice(0, 100));
      else onChange(current => ({ ...current, boards: current.boards.map(board => board.id === dialog.board.id ? { ...board, title: title.slice(0, 100), updatedAt: new Date().toISOString() } : board) }));
    }
    closeDialog();
  };
  const drop = (event: DragEvent, targetId?: string, groupId?: string) => {
    event.preventDefault(); event.stopPropagation(); const id = dragging.current;
    if (id && !disabled) { const rect = event.currentTarget.getBoundingClientRect(); commit(current => moveBoard(current, id, targetId, groupId, !!targetId && event.clientY > rect.top + rect.height / 2), false); }
    dragging.current = null; setDraggedId(null); setDropTarget(null);
  };
  const dragOver = (event: DragEvent, id: string, row = false) => {
    if (!dragging.current || disabled) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
    if (dragging.current === id) { setDropTarget(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    setDropTarget({ id, position: row ? event.clientY > rect.top + rect.height / 2 ? 'after' : 'before' : 'inside' });
  };
  const dragLeave = (event: DragEvent, id: string) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(current => current?.id === id ? null : current);
  };
  const renderBoard = (board: Board, child = false) => {
    const active = workspace.activeBoardId === board.id;
    return <div key={board.id} className={`board-row${child ? ' is-child' : ''}${active ? ' active is-current' : ''}${draggedId === board.id ? ' is-dragging' : ''}${dropTarget?.id === board.id ? ` drop-${dropTarget.position}` : ''}`} onDragOver={event => dragOver(event, board.id, true)} onDragLeave={event => dragLeave(event, board.id)} onDrop={event => drop(event, board.id)}>
      <button type="button" className="board-nav" title={untitled(board)} aria-current={active ? 'page' : undefined} onClick={() => onSwitch(board.id)} disabled={disabled}>
        <BoardCover cover={board.cover} />
        <span className="board-nav__label">{untitled(board)}</span>
      </button>
      {/* Pointer-only reorder handle; keyboard users move boards from the "…" menu (上移 / 下移). */}
      <button type="button" className="board-grip" tabIndex={-1} draggable={!disabled} disabled={disabled} aria-label={`拖动排序：${untitled(board)}`} title="拖动排序；也可在“…”菜单中上移、下移" onDragStart={event => { closeMenu(false); dragging.current = board.id; setDraggedId(board.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-field-board', board.id); }} onDragEnd={() => { dragging.current = null; setDraggedId(null); setDropTarget(null); }}><GripVertical size={14} strokeWidth={1.75}/></button>
      <button type="button" className="board-row-more" data-board-menu aria-label={`画布操作：${untitled(board)}`} title="画布操作" aria-haspopup="menu" aria-expanded={isMenuOpen('board', board.id)} aria-controls={isMenuOpen('board', board.id) ? menuId : undefined} disabled={disabled} onClick={event => launchMenu('board', event.currentTarget, board.id)}><MoreHorizontal size={16} strokeWidth={1.75}/></button>
    </div>;
  };
  const menuBoard = workspace.boards.find(board => board.id === menu?.id);
  const peers = workspace.boards.filter(board => board.groupId === menuBoard?.groupId);
  const peerIndex = peers.findIndex(board => board.id === menu?.id);
  const ungrouped = workspace.boards.filter(board => !board.groupId || !workspace.groups?.some(group => group.id === board.groupId));
  const trashCount = workspace.trash?.length ?? 0;

  return <>
    <div className="board-section-title">
      <span className="sidebar-section-label">画布</span>
      <div className="board-section-actions">
        <button type="button" className="icon-btn icon-btn--xs is-quiet" data-board-menu aria-label="画布排序" title="画布排序" aria-haspopup="menu" aria-expanded={isMenuOpen('sort')} aria-controls={isMenuOpen('sort') ? menuId : undefined} disabled={disabled} onClick={event => launchMenu('sort', event.currentTarget)}><ArrowDownUp size={14} strokeWidth={1.75}/></button>
        <button type="button" className="icon-btn icon-btn--xs is-quiet" aria-label="新建画布分组" title="新建分组" disabled={disabled} onClick={event => groupDialog(undefined, event.currentTarget)}><FolderPlus size={14} strokeWidth={1.75}/></button>
        <button type="button" className="icon-btn icon-btn--xs new-board" title={isNative() ? '新建画布 (Ctrl+N)' : '新建画布'} aria-label="新建画布" disabled={disabled} onClick={onNew}><Plus size={16} strokeWidth={1.75}/></button>
      </div>
    </div>
    <nav className="board-list" aria-label="画布列表">
      {workspace.groups?.map(group => {
        const children = workspace.boards.filter(board => board.groupId === group.id);
        return <section className={`board-group${group.collapsed ? ' is-collapsed' : ''}${dropTarget?.id === group.id ? ' drop-target' : ''}`} key={group.id} onDragOver={event => dragOver(event, group.id)} onDragLeave={event => dragLeave(event, group.id)} onDrop={event => drop(event, undefined, group.id)}>
          <div className="board-group-heading">
            <button type="button" className="board-group-toggle" title={group.title} aria-label={`${group.collapsed ? '展开' : '收起'}分组：${group.title}`} aria-expanded={!group.collapsed} onClick={() => onChange(current => ({ ...current, groups: current.groups?.map(item => item.id === group.id ? { ...item, collapsed: !item.collapsed } : item) }))} disabled={disabled}>
              <span className="board-nav__icon" aria-hidden="true">{group.collapsed ? <ChevronRight className="board-group-chevron" size={12} strokeWidth={2}/> : <ChevronDown className="board-group-chevron" size={12} strokeWidth={2}/>}</span>
              <span className="board-nav__label">{group.title}</span>
              <small className="board-group-count">{children.length}</small>
            </button>
            <button type="button" className="board-row-more" data-board-menu title="分组操作" aria-label={`分组操作：${group.title}`} aria-haspopup="menu" aria-expanded={isMenuOpen('group', group.id)} aria-controls={isMenuOpen('group', group.id) ? menuId : undefined} disabled={disabled} onClick={event => launchMenu('group', event.currentTarget, group.id)}><MoreHorizontal size={16} strokeWidth={1.75}/></button>
          </div>
          {!group.collapsed && <div className="board-group-children">{children.map(board => renderBoard(board, true))}{!children.length && <p className="board-group-empty">拖入画布，或从画布菜单移入</p>}</div>}
        </section>;
      })}
      <div className={`board-ungrouped${dropTarget?.id === 'ungrouped' ? ' drop-target' : ''}${draggedId && workspace.groups?.length ? ' is-drop-zone' : ''}`} onDragOver={event => dragOver(event, 'ungrouped')} onDragLeave={event => dragLeave(event, 'ungrouped')} onDrop={event => drop(event)}>
        {ungrouped.map(board => renderBoard(board))}
        {!!draggedId && !!workspace.groups?.length && <p className="board-drop-hint">拖到这里移出分组</p>}
      </div>
    </nav>
    {trashCount > 0 && <button type="button" className="board-trash-trigger" aria-label={`画布回收站，${trashCount} 张画布`} title="画布回收站" disabled={disabled} onClick={event => openDialog({ kind: 'trash' }, event.currentTarget)}><span className="board-nav__icon" aria-hidden="true"><Trash2 size={16} strokeWidth={1.75}/></span><span className="board-nav__label">回收站</span><small>{trashCount}</small></button>}
    {menu && createPortal(<div id={menuId} ref={menuRef} className="board-popover" role="menu" aria-label={menu.kind === 'sort' ? '画布排序方式' : '画布管理'} style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
      if (event.key === 'Tab') {
        event.preventDefault();
        const trigger = menuTrigger.current;
        const focusable = [...document.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [contenteditable="true"], [tabindex]')].filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && !menuRef.current?.contains(element));
        const index = focusable.indexOf(trigger!);
        const next = focusable[index + (event.shiftKey ? -1 : 1)];
        closeMenu(false);
        requestAnimationFrame(() => next?.isConnected ? next.focus() : restoreFocus(trigger));
        return;
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
      {menu.kind === 'sort' ? <>
        <p className="board-menu-heading">排列各分组内的画布</p>
        <MenuItem onClick={() => commit(current => sortBoards(current, 'name'))}>按名称排序</MenuItem>
        <MenuItem onClick={() => commit(current => sortBoards(current, 'updated'))}>按最近更新排序</MenuItem>
        <small className="board-menu-note">也可以拖动画布左侧的手柄排序</small>
      </> : menu.kind === 'group' ? <>
        <MenuItem icon={<Pencil size={16} strokeWidth={1.75}/>} onClick={() => groupDialog(menu.id)}>重命名分组</MenuItem>
        <MenuItem icon={<Folder size={16} strokeWidth={1.75}/>} onClick={() => commit(current => removeGroup(current, menu.id!))}>移除分组，保留画布</MenuItem>
      </> : menuBoard ? <>
        <MenuItem icon={<Pencil size={16} strokeWidth={1.75}/>} onClick={() => renameDialog(menuBoard)}>重命名</MenuItem>
        {onDuplicate && <MenuItem icon={<Copy size={16} strokeWidth={1.75}/>} onClick={() => { closeMenu(false); onDuplicate(menuBoard.id); }}>复制画布</MenuItem>}
        {onExport && <MenuItem icon={<Download size={16} strokeWidth={1.75}/>} onClick={() => { closeMenu(false); onExport(menuBoard.id); }}>导出…</MenuItem>}
        <div className="board-menu-rule" role="separator"/>
        <MenuItem icon={<ArrowUp size={16} strokeWidth={1.75}/>} disabled={peerIndex <= 0} onClick={() => commit(current => moveBoard(current, menuBoard.id, peers[peerIndex - 1]?.id))}>上移画布</MenuItem>
        <MenuItem icon={<ArrowDown size={16} strokeWidth={1.75}/>} disabled={peerIndex >= peers.length - 1} onClick={() => commit(current => moveBoard(current, menuBoard.id, peers[peerIndex + 1]?.id, undefined, true))}>下移画布</MenuItem>
        <div className="board-menu-rule" role="separator"/>
        <p className="board-menu-heading">移到分组</p>
        <MenuItem icon={!menuBoard.groupId ? <Check size={16} strokeWidth={1.75}/> : null} disabled={!menuBoard.groupId} onClick={() => commit(current => moveBoard(current, menuBoard.id))}>未分组</MenuItem>
        {workspace.groups?.map(group => <MenuItem key={group.id} title={group.title} icon={menuBoard.groupId === group.id ? <Check size={16} strokeWidth={1.75}/> : <Folder size={16} strokeWidth={1.75}/>} disabled={menuBoard.groupId === group.id} onClick={() => commit(current => moveBoard(current, menuBoard.id, undefined, group.id))}>{group.title}</MenuItem>)}
        <div className="board-menu-rule" role="separator"/>
        <MenuItem danger icon={<Trash2 size={16} strokeWidth={1.75}/>} onClick={() => openDialog({ kind: 'delete', board: menuBoard })}>删除画布</MenuItem>
      </> : null}
    </div>, document.body)}
    {(dialog?.kind === 'group' || dialog?.kind === 'rename') && <InspectorDialog title={dialog.kind === 'rename' ? '重命名画布' : dialog.id ? '重命名分组' : '新建画布分组'} onCancel={closeDialog} className="board-management-dialog">
      <label className="field field-label"><span className="field__label">{dialog.kind === 'rename' ? '新名称' : '分组名称'}</span><input className="input" data-autofocus value={name} maxLength={100} placeholder={dialog.kind === 'rename' ? '给这块画布起个名字' : '例如：正在创作、参考资料'} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && name.trim()) { event.preventDefault(); saveName(); } }}/></label>
      <footer><button type="button" className="btn btn--line" onClick={closeDialog}>取消</button><button type="button" className="btn btn--primary" disabled={!name.trim()} onClick={saveName}>{dialog.kind === 'group' && !dialog.id ? '创建分组' : '保存名称'}</button></footer>
    </InspectorDialog>}
    {dialog?.kind === 'delete' && (trashCount >= TRASH_LIMIT
      ? <InspectorDialog title="回收站已满" onCancel={closeDialog} className="board-management-dialog">
        <p className="board-dialog-copy">回收站最多放 {TRASH_LIMIT} 张画布。先在回收站里永久删除不再需要的画布，再删除“{untitled(dialog.board)}”。</p>
        <footer><button type="button" className="btn btn--line" data-autofocus onClick={closeDialog}>取消</button><button type="button" className="btn btn--primary" onClick={() => setDialog({ kind: 'trash' })}>打开回收站</button></footer>
      </InspectorDialog>
      : <InspectorDialog title="删除这张画布？" onCancel={closeDialog} className="board-management-dialog">
        <p className="board-dialog-copy">{cardCount(dialog.board) ? `“${untitled(dialog.board)}”和其中 ${cardCount(dialog.board)} 张卡片将移入回收站，随时可以恢复。` : `“${untitled(dialog.board)}”是一张空画布，将移入回收站，随时可以恢复。`}</p>
        {dialog.board.storage && <p className="board-dialog-note">自定义文件夹里的文件会保留。</p>}
        <footer><button type="button" className="btn btn--line" data-autofocus onClick={closeDialog}>取消</button><button type="button" className="btn btn--danger" onClick={() => { const id = dialog.board.id; const moved = apply(current => trashBoard(current, id)); closeDialog(); if (moved) showToast('已移入回收站', { undo: () => onChange(current => restoreBoard(current, id)) }); }}>移入回收站</button></footer>
      </InspectorDialog>)}
    {dialog?.kind === 'trash' && <InspectorDialog title="画布回收站" onCancel={closeDialog} className="board-management-dialog board-trash-dialog">
      <p className="board-dialog-note">恢复后，卡片、素材和连线一起回到工作区。</p>
      {trashCount >= TRASH_LIMIT && <p className="board-dialog-note">回收站已满 {TRASH_LIMIT} 张。永久删除不再需要的画布后，才能再删除画布。</p>}
      <div className="board-trash-list">{workspace.trash?.length ? [...workspace.trash].reverse().map(entry => <article key={entry.board.id}>
        <div><strong title={untitled(entry.board)}>{untitled(entry.board)}</strong><small>{cardSummary(entry.board)}，删除于 {new Date(entry.deletedAt).toLocaleDateString('zh-CN')}</small></div>
        <button type="button" className="btn btn--line btn--sm" onClick={() => { const restored = apply(current => restoreBoard(current, entry.board.id)); closeDialog(); if (restored) showToast(`已恢复「${untitled(entry.board)}」`); }}><RotateCcw size={14} strokeWidth={1.75}/>恢复画布</button>
        <button type="button" className="icon-btn icon-btn--sm board-trash-purge" aria-label={`永久删除：${untitled(entry.board)}`} title="永久删除" onClick={() => setDialog({ kind: 'purge', board: entry.board })}><Trash2 size={16} strokeWidth={1.75}/></button>
      </article>) : <p className="board-empty-trash">回收站是空的。删除的画布会先放在这里。</p>}</div>
      {trashCount > 0 && <footer><button type="button" className="btn btn--danger btn--sm" onClick={() => setDialog({ kind: 'empty-trash' })}>清空回收站…</button></footer>}
    </InspectorDialog>}
    {dialog?.kind === 'purge' && <InspectorDialog title="永久删除这张画布？" onCancel={() => setDialog({ kind: 'trash' })} closeLabel="取消并回到回收站" className="board-management-dialog">
      <p className="board-dialog-copy">{cardCount(dialog.board) ? `“${untitled(dialog.board)}”和其中 ${cardCount(dialog.board)} 张卡片，连同它们的素材和连线，会被永久删除。` : `空画布“${untitled(dialog.board)}”会被永久删除。`}</p>
      <p className="board-dialog-note">永久删除后无法撤销，也不能从回收站恢复。{dialog.board.storage ? '自定义文件夹里的文件会保留。' : ''}</p>
      <footer><button type="button" className="btn btn--line" data-autofocus onClick={() => setDialog({ kind: 'trash' })}>取消</button><button type="button" className="btn btn--danger" onClick={() => { const board = dialog.board; const removed = apply(current => purgeTrashedBoard(current, board.id)); if (trashCount > 1) setDialog({ kind: 'trash' }); else closeDialog(); if (removed) showToast(`已永久删除「${untitled(board)}」`); }}>永久删除</button></footer>
    </InspectorDialog>}
    {dialog?.kind === 'empty-trash' && <InspectorDialog title="清空回收站？" onCancel={() => setDialog({ kind: 'trash' })} closeLabel="取消并回到回收站" className="board-management-dialog">
      <p className="board-dialog-copy">回收站里的 {trashCount} 张画布，连同其中的卡片、素材和连线，会被永久删除。</p>
      <p className="board-dialog-note">清空后无法撤销，也不能再恢复。</p>
      <footer><button type="button" className="btn btn--line" data-autofocus onClick={() => setDialog({ kind: 'trash' })}>取消</button><button type="button" className="btn btn--danger" onClick={() => { const count = trashCount; const removed = apply(emptyTrash); closeDialog(); if (removed) showToast(`已永久删除 ${count} 张画布`); }}>清空回收站</button></footer>
    </InspectorDialog>}
  </>;
}
