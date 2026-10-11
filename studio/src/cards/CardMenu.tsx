import {
  useEffect, useId, useLayoutEffect, useRef, useState,
  type Dispatch, type KeyboardEvent, type ReactNode, type RefObject, type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import { useStoreApi } from '@xyflow/react';
import { Copy, Focus, MoreHorizontal, Scaling, Trash2, Ungroup } from 'lucide-react';
import type { CardData } from '../model';
import { ThreadIcon } from '../icons/field-icons';
import { quoteDisplayTitle } from '../source-location';
import { kindDisplayName } from './card-utils';
import type { CardBodyProps } from './types';
import { keyOf } from '../components/shortcut-keys';

/* ------------------------------------------------------------------------------------------------
 * Action menu (DESIGN_SYSTEM §6.21, CD-M6, CV-m1)
 *
 * One menu primitive for the card “…”, the selection toolbar “更多 / 对齐 / 排列” and (after
 * integration) the card right-click menu. It is portalled to document.body, so its 13px type never
 * follows the canvas zoom; role="menu" with role="menuitem" rows; focus enters the first row; arrow
 * keys, Home/End and first-letter jumps move focus; Tab and Esc close it and give focus back to the
 * trigger; an outside pointerdown closes it. Placement flips and shifts by the measured size and keeps
 * 8px from the window edges. While open it follows its trigger (the canvas may pan under it).
 *
 * NOTE: when src/components/Menu.tsx (toolbar package) lands, both should converge on one primitive.
 * ---------------------------------------------------------------------------------------------- */

export interface ActionMenuItem {
  kind?: 'item';
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /** Disabled rows stay focusable (aria-disabled) so the reason can be read. */
  disabled?: boolean;
  /** Short reason shown on the right of a disabled row (“只读窗口”). */
  reason?: string;
  /** Longer tooltip (title); defaults to the reason. */
  title?: string;
  /** Second line under the label (“间隔 32 px”). */
  detail?: string;
  shortcut?: string;
}
export interface ActionMenuSeparator { kind: 'separator'; id: string }
export interface ActionMenuHeading { kind: 'heading'; id: string; label: string }
export type ActionMenuEntry = ActionMenuItem | ActionMenuSeparator | ActionMenuHeading;

export type ActionMenuCloseReason = 'select' | 'escape' | 'tab' | 'outside' | 'anchor-lost';
export type ActionMenuPlacement = 'bottom-start' | 'bottom-end' | 'bottom-center' | 'top-start' | 'top-end' | 'top-center';

export interface ActionMenuProps {
  open: boolean;
  /** The trigger; the menu is placed against it and focus returns to it. */
  anchor: RefObject<HTMLElement | null>;
  /** Accessible name of role="menu". */
  label: string;
  entries: ActionMenuEntry[];
  onClose: (reason: ActionMenuCloseReason) => void;
  placement?: ActionMenuPlacement;
  /** Open at a pointer position instead of next to the trigger (right-click). */
  point?: { x: number; y: number } | null;
  /** Where focus goes when the menu closes with Esc / Tab / a choice. Defaults to the trigger. */
  focusReturn?: () => HTMLElement | null;
  id?: string;
  className?: string;
}

const EDGE = 8;
const GAP = 6;

export interface MenuPosition { left: number; top: number; side: 'top' | 'bottom'; maxHeight: number }

/** Pure: where a menu of `size` goes next to `anchor` inside a `viewport` (all in client pixels). */
export function computeMenuPosition(
  anchor: { left: number; top: number; right: number; bottom: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: ActionMenuPlacement = 'bottom-start',
): MenuPosition {
  const maxHeight = Math.max(120, Math.floor(viewport.height * .7));
  const height = Math.min(size.height, maxHeight);
  const [preferredSide, align] = placement.split('-') as ['top' | 'bottom', 'start' | 'end' | 'center'];
  const below = anchor.bottom + GAP, above = anchor.top - GAP - height;
  const fitsBelow = below + height <= viewport.height - EDGE, fitsAbove = above >= EDGE;
  let side: 'top' | 'bottom' = preferredSide;
  if (side === 'bottom' && !fitsBelow && (fitsAbove || anchor.top > viewport.height - anchor.bottom)) side = 'top';
  else if (side === 'top' && !fitsAbove && (fitsBelow || viewport.height - anchor.bottom > anchor.top)) side = 'bottom';
  let top = side === 'bottom' ? below : above;
  top = Math.max(EDGE, Math.min(top, viewport.height - EDGE - height));
  let left = align === 'end' ? anchor.right - size.width : align === 'center' ? (anchor.left + anchor.right) / 2 - size.width / 2 : anchor.left;
  left = Math.max(EDGE, Math.min(left, viewport.width - EDGE - size.width));
  return { left: Math.round(left), top: Math.round(top), side, maxHeight };
}

function menuItems(menu: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
}

export function ActionMenu({ open, anchor, label, entries, onClose, placement = 'bottom-start', point, focusReturn, id, className }: ActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [side, setSide] = useState<'top' | 'bottom'>(placement.startsWith('top') ? 'top' : 'bottom');

  // Place before paint, then follow the trigger while open (the canvas can pan or zoom underneath).
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    let frame = 0;
    let last = '';
    const place = () => {
      const trigger = anchor.current;
      if (!point && !trigger?.isConnected) { onCloseRef.current('anchor-lost'); return; }
      // A pointer position opens 2px below and right of the pointer.
      const rect = point ? { left: point.x + 2, right: point.x + 2, top: point.y - GAP + 2, bottom: point.y - GAP + 2, width: 1, height: 1 } : trigger!.getBoundingClientRect();
      // A trigger hidden by display:none (overview, expanded layouts) takes the menu with it; one that is merely
      // panned out of the window keeps it, clamped inside the window.
      if (!rect.width && !rect.height) { onCloseRef.current('anchor-lost'); return; }
      const key = `${rect.left}|${rect.top}|${rect.right}|${rect.bottom}|${menu.offsetWidth}|${menu.offsetHeight}|${innerWidth}|${innerHeight}`;
      if (key !== last) {
        last = key;
        const position = computeMenuPosition(rect, { width: menu.offsetWidth, height: menu.scrollHeight }, { width: innerWidth, height: innerHeight }, placement);
        menu.style.left = `${position.left}px`;
        menu.style.top = `${position.top}px`;
        menu.style.maxHeight = `${position.maxHeight}px`;
        if (menu.dataset.side !== position.side) { menu.dataset.side = position.side; setSide(position.side); }
      }
      if (!point) frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [open, anchor, placement, point]);

  // Focus the first row once, when the menu opens.
  useEffect(() => {
    if (!open) return;
    const first = menuItems(menuRef.current)[0];
    first?.focus({ preventScroll: true });
  }, [open]);

  // Outside pointerdown closes (capture: runs even when the canvas stops propagation).
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    // Native stop at the menu root: owners that close on a document pointerdown (CanvasCard) never see
    // a press inside the portalled menu, so the row's click still arrives.
    const stop = (event: Event) => event.stopPropagation();
    menu?.addEventListener('pointerdown', stop);
    menu?.addEventListener('mousedown', stop);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || menu?.contains(target) || anchor.current?.contains(target)) return;
      onCloseRef.current('outside');
    };
    document.addEventListener('pointerdown', outside, true);
    const blur = () => onCloseRef.current('outside');
    window.addEventListener('blur', blur);
    return () => {
      menu?.removeEventListener('pointerdown', stop);
      menu?.removeEventListener('mousedown', stop);
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', blur);
    };
  }, [open, anchor]);

  if (!open || typeof document === 'undefined') return null;

  const close = (reason: ActionMenuCloseReason, restoreFocus: boolean) => {
    if (restoreFocus) (focusReturn?.() ?? anchor.current)?.focus({ preventScroll: true });
    onClose(reason);
  };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Keep keys away from React ancestors (the React Flow node moves on arrow keys).
    event.stopPropagation();
    const rows = menuItems(menuRef.current);
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const focusRow = (next: number) => rows[(next + rows.length) % rows.length]?.focus({ preventScroll: false });
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focusRow(index < 0 ? 0 : index + 1); return;
      case 'ArrowUp': event.preventDefault(); focusRow(index < 0 ? rows.length - 1 : index - 1); return;
      case 'Home': event.preventDefault(); focusRow(0); return;
      case 'End': event.preventDefault(); focusRow(rows.length - 1); return;
      case 'Escape': event.preventDefault(); close('escape', true); return;
      // Focus goes back to the trigger first; the browser's own Tab then moves on from there.
      case 'Tab': close('tab', true); return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.trim()) {
          const key = event.key.toLocaleLowerCase();
          const order = [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
          const match = order.find(row => (row.dataset.label ?? row.textContent ?? '').trim().toLocaleLowerCase().startsWith(key));
          if (match) { event.preventDefault(); match.focus(); }
        }
    }
  }

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      className={['action-menu', className].filter(Boolean).join(' ')}
      role="menu"
      aria-label={label}
      aria-orientation="vertical"
      data-side={side}
      onKeyDown={onKeyDown}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
    >
      {entries.map(entry => {
        if (entry.kind === 'separator') return <div key={entry.id} className="action-menu__sep" role="separator" />;
        if (entry.kind === 'heading') return <div key={entry.id} className="action-menu__heading" role="presentation">{entry.label}</div>;
        const disabled = !!entry.disabled;
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-label={entry.label}
            className={['action-menu__item', entry.danger && 'is-danger', entry.detail && 'has-detail'].filter(Boolean).join(' ')}
            aria-disabled={disabled || undefined}
            title={disabled ? entry.title ?? entry.reason : entry.title}
            onClick={() => {
              if (disabled) return;
              close('select', true);
              entry.onSelect();
            }}
          >
            {entry.icon && <span className="action-menu__icon" aria-hidden="true">{entry.icon}</span>}
            <span className="action-menu__label">
              {entry.label}
              {entry.detail && <small>{entry.detail}</small>}
            </span>
            {disabled && entry.reason ? <span className="action-menu__why">{entry.reason}</span>
              : entry.shortcut ? <kbd className="action-menu__kbd">{entry.shortcut}</kbd> : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------------------------------------
 * Card commands. The card “…” menu and the right-click menu offer the same five actions as the
 * selection toolbar's “更多” (§6.21, K4 names unchanged). The connect / resize dialogs and “view”
 * live with the selection toolbar, so card menus ask it through this tiny bus instead of growing
 * CardActions.
 * ---------------------------------------------------------------------------------------------- */

export type CardCommand = 'view' | 'connect' | 'resize';
type CardCommandHandler = (id: string, command: CardCommand) => boolean;
const cardCommandHandlers = new Set<CardCommandHandler>();

/** The selection toolbar registers while it is mounted. Returns the unregister function. */
export function onCardCommand(handler: CardCommandHandler): () => void {
  cardCommandHandlers.add(handler);
  return () => { cardCommandHandlers.delete(handler); };
}

/** Ask whoever owns the dialogs to run `command` for card `id`. True when it was handled. */
export function requestCardCommand(id: string, command: CardCommand): boolean {
  for (const handler of [...cardCommandHandlers]) if (handler(id, command)) return true;
  return false;
}

export interface CardMenuActions {
  readOnly?: boolean;
  tool?: 'select' | 'hand';
  canConnect?: boolean;
  onView?: () => void;
  onConnect?: () => void;
  onResize?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  /** Groups only: the cards lying in the tray, and removing the tray together with them (one undo step). */
  frameContents?: { count: number; pictures: boolean };
  onDeleteWithContents?: () => void;
}

const READ_ONLY_REASON = '只读窗口';
const READ_ONLY_TITLE = '当前窗口只读';

/**
 * The five card actions shared by the card “…”, the right-click menu and the toolbar “更多” (K4 names).
 * A group is not a card: its rows say what happens to the tray and to what lies in it (“解散分组” keeps the
 * cards; “删除分组和 5 张图片” removes them too and is the only destructive row).
 */
export function cardMenuEntries(data: Pick<CardData, 'kind'>, actions: CardMenuActions): ActionMenuEntry[] {
  const readOnly = !!actions.readOnly;
  const frame = data.kind === 'frame';
  const locked = (entry: ActionMenuItem): ActionMenuItem => readOnly ? { ...entry, disabled: true, reason: READ_ONLY_REASON, title: READ_ONLY_TITLE } : entry;
  const entries: ActionMenuEntry[] = [];
  if (actions.onView) entries.push({ id: 'view', label: frame ? '查看这个分组' : '查看这张卡片', icon: <Focus size={16} />, onSelect: actions.onView });
  if (!frame && actions.onConnect) {
    const connect: ActionMenuItem = { id: 'connect', label: '连接到卡片…', icon: <ThreadIcon size={16} />, onSelect: actions.onConnect };
    entries.push(readOnly ? locked(connect) : actions.canConnect === false ? { ...connect, disabled: true, reason: '没有可连接的卡片' } : connect);
  }
  if (actions.tool !== 'hand' && actions.onResize) entries.push(locked({ id: 'resize', label: frame ? '调整分组大小…' : '调整尺寸…', icon: <Scaling size={16} />, onSelect: actions.onResize }));
  if (actions.onDuplicate) entries.push(locked(frame
    ? { id: 'duplicate', label: '复制分组框', detail: '不含里面的卡片', icon: <Copy size={16} />, onSelect: actions.onDuplicate, shortcut: keyOf('duplicate', 'Ctrl D') }
    : { id: 'duplicate', label: '复制卡片', icon: <Copy size={16} />, onSelect: actions.onDuplicate, shortcut: keyOf('duplicate', 'Ctrl D') }));
  if (actions.onDelete) {
    if (entries.length) entries.push({ kind: 'separator', id: 'sep-delete' });
    if (frame) {
      entries.push(locked({ id: 'delete', label: '解散分组', detail: '里面的卡片留在画布上', icon: <Ungroup size={16} />, onSelect: actions.onDelete, shortcut: keyOf('delete', 'Delete') }));
      const contents = actions.frameContents;
      if (contents && contents.count > 0 && actions.onDeleteWithContents) {
        entries.push(locked({ id: 'delete-contents', label: `删除分组和 ${contents.count} 张${contents.pictures ? '图片' : '卡片'}`, icon: <Trash2 size={16} />, onSelect: actions.onDeleteWithContents, danger: true }));
      }
    } else entries.push(locked({ id: 'delete', label: '移除卡片', icon: <Trash2 size={16} />, onSelect: actions.onDelete, danger: true, shortcut: keyOf('delete', 'Delete') }));
  }
  return entries;
}

interface CardMenuProps extends CardBodyProps {
  menuOpen: boolean;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  menuRef: RefObject<HTMLDivElement | null>;
}

/**
 * The header's “…” menu. Open state lives in CanvasCard so outside clicks, overview and hand mode can
 * close it; the menu itself is portalled to the body (CD-M6) and never scales with the canvas.
 */
export function CardMenu({ id, data, board, activate, menuOpen, setMenuOpen, menuRef }: CardMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const store = useStoreApi();
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { if (!menuOpen) setPoint(null); }, [menuOpen]);

  // Right-click on the card opens the same menu at the pointer (§6.21, CV-m1). A right-button drag pans the
  // canvas instead, and text fields keep the system menu (copy / paste).
  useEffect(() => {
    const node = menuRef.current?.closest<HTMLElement>('.react-flow__node');
    if (!node) return;
    let pressed: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => { if (event.button === 2) pressed = { x: event.clientX, y: event.clientY }; };
    const open = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('input, textarea, select, video, [contenteditable="true"], [role="textbox"]')) return;
      event.preventDefault();
      const moved = pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 4;
      pressed = null;
      if (moved) return;
      event.stopPropagation();
      const state = store.getState();
      if (!state.nodeLookup.get(id)?.selected && state.elementsSelectable) state.addSelectedNodes([id]);
      setPoint({ x: event.clientX, y: event.clientY });
      setMenuOpen(true);
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('contextmenu', open);
    return () => { node.removeEventListener('pointerdown', down); node.removeEventListener('contextmenu', open); };
  }, [id, menuRef, setMenuOpen, store]);
  // Two quotes often share a stored default title; the name says which one (its sentence), like the card does.
  const title = (data.kind === 'quote' ? quoteDisplayTitle(data) : data.title.trim()) || kindDisplayName(data);
  const entries = cardMenuEntries(data, {
    readOnly: board.readOnly,
    tool: board.tool,
    onView: () => { requestCardCommand(id, 'view'); },
    onConnect: () => { requestCardCommand(id, 'connect'); },
    onResize: () => { requestCardCommand(id, 'resize'); },
    onDuplicate: () => board.duplicateCard(id),
    onDelete: () => board.deleteCard(id),
  });

  return (
    <div ref={menuRef} className="field-card__menu-wrap nodrag nowheel">
      <button
        ref={triggerRef}
        type="button"
        className="field-card__icon-button"
        aria-label={`更多操作：${title}`}
        title="更多操作"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={event => activate(event, () => setMenuOpen(value => !value))}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && !menuOpen) { event.preventDefault(); event.stopPropagation(); setMenuOpen(true); }
        }}
      >
        <MoreHorizontal size={17} />
      </button>
      <ActionMenu
        open={menuOpen}
        anchor={triggerRef}
        id={menuId}
        label="卡片操作"
        entries={entries}
        className={point ? 'action-menu--context' : undefined}
        placement={point ? 'bottom-start' : 'bottom-end'}
        point={point}
        focusReturn={point ? () => menuRef.current?.closest<HTMLElement>('.react-flow__node') ?? null : undefined}
        onClose={() => setMenuOpen(false)}
      />
    </div>
  );
}
