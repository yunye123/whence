import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Shared popover primitives for the canvas chrome (DESIGN_SYSTEM.md §6.21, §6.1 `.tip`, §6.28).
 *
 * - `Menu` / `MenuItem` / `MenuSection` / `MenuSeparator`: a role="menu" mounted on document.body, fixed
 *   14px type that never follows the canvas zoom, focus moves into the first item, ArrowUp/Down, Home/End,
 *   type-ahead, Tab and Escape close it and focus goes back to the trigger, an outside pointerdown closes it.
 *   Unavailable items stay focusable (`aria-disabled`) and say why on the right.
 * - `useHudTooltip`: one tooltip per HUD (toolbar, navigator) with the shortcut in a kbd. The buttons keep
 *   their native `title` (K5 locators); `TipHit` covers each button with an empty-`title` layer, so the
 *   native tooltip never stacks on top of the drawn one.
 * - `useRovingFocus`: a single Tab stop inside a toolbar, arrow keys move between its buttons.
 *
 * The menu renders in place (no portal) when there is no DOM, so render tests can read its markup.
 */

export interface MenuPoint { x: number; y: number }
export type MenuAnchor = HTMLElement | MenuPoint | null;
export type MenuPlacement = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
export type MenuCloseReason = 'escape' | 'outside' | 'tab' | 'select' | 'resize';
export interface MenuRect { left: number; top: number; width: number; height: number }

const VIEWPORT_MARGIN = 8;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, max), Math.max(min, value));

function isPoint(anchor: MenuAnchor): anchor is MenuPoint {
  return !!anchor && typeof (anchor as MenuPoint).x === 'number' && typeof (anchor as HTMLElement).getBoundingClientRect !== 'function';
}

/**
 * Pure: where a menu of `size` goes. A pointer anchor opens at the point and flips left / up when it would
 * leave the viewport; an element anchor opens on the requested side and flips when that side has no room.
 * The result always stays at least 8px inside the viewport.
 */
export function computeMenuPosition(
  anchor: MenuRect | MenuPoint,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  options: { placement?: MenuPlacement; offset?: number; alignOffset?: number } = {},
): { left: number; top: number; side: 'top' | 'bottom' } {
  const m = VIEWPORT_MARGIN;
  const maxLeft = viewport.width - size.width - m, maxTop = viewport.height - size.height - m;
  if (!('width' in anchor)) {
    let left = anchor.x, top = anchor.y;
    if (left + size.width > viewport.width - m && anchor.x - size.width >= m) left = anchor.x - size.width;
    let side: 'top' | 'bottom' = 'bottom';
    if (top + size.height > viewport.height - m && anchor.y - size.height >= m) { top = anchor.y - size.height; side = 'top'; }
    return { left: clamp(left, m, maxLeft), top: clamp(top, m, maxTop), side };
  }
  const placement = options.placement ?? 'bottom-start';
  const offset = options.offset ?? 6, align = options.alignOffset ?? 0;
  const roomAbove = anchor.top - offset - m, roomBelow = viewport.height - (anchor.top + anchor.height) - offset - m;
  let side: 'top' | 'bottom' = placement.startsWith('top') ? 'top' : 'bottom';
  if (side === 'top' && roomAbove < size.height && roomBelow > roomAbove) side = 'bottom';
  else if (side === 'bottom' && roomBelow < size.height && roomAbove > roomBelow) side = 'top';
  const top = side === 'top' ? anchor.top - offset - size.height : anchor.top + anchor.height + offset;
  const left = placement.endsWith('end') ? anchor.left + anchor.width - size.width - align : anchor.left + align;
  return { left: clamp(left, m, maxLeft), top: clamp(top, m, maxTop), side };
}

/** Pure: the next index for ArrowUp/Down/Home/End in a list of `count` items (wraps around). */
export function nextMenuIndex(key: string, current: number, count: number): number {
  if (count <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown' || key === 'ArrowRight') return current < 0 ? 0 : (current + 1) % count;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return current < 0 ? count - 1 : (current - 1 + count) % count;
  return current;
}

/** Pure: type-ahead. The first item after `current` whose key or first character matches `char`. */
export function typeaheadIndex(keys: readonly string[], char: string, current: number): number {
  const wanted = char.toLocaleLowerCase();
  if (!wanted.trim()) return -1;
  for (let step = 1; step <= keys.length; step++) {
    const index = (current + step + keys.length) % keys.length;
    if (keys[index]?.toLocaleLowerCase().startsWith(wanted)) return index;
  }
  return -1;
}

interface MenuContextValue {
  close: (reason: MenuCloseReason) => void;
  restoreFocus: () => void;
}
const MenuContext = createContext<MenuContextValue | null>(null);

export interface MenuProps {
  /** Accessible name of the menu (role="menu"). */
  label: string;
  /** The trigger element, or a screen point for a context menu. */
  anchor: MenuAnchor;
  placement?: MenuPlacement;
  /** Gap between the anchor element and the menu (default 6). */
  offset?: number;
  /** Shift along the anchor edge; `-8` lines the menu up 8px left of a `*-start` trigger. */
  alignOffset?: number;
  /**
   * Called for Escape, Tab, an outside pointerdown, a window resize and a chosen item. When it is omitted
   * Escape bubbles to the page, so an owner with its own Escape handling can still close the menu.
   */
  onClose?: (reason: MenuCloseReason) => void;
  /** Which item takes the focus when the menu opens (default the first). */
  initialFocus?: 'first' | 'last';
  /** Where the focus goes back to; defaults to the anchor element or whatever had the focus before. */
  returnFocus?: HTMLElement | null;
  /** Minimum width in px (default 220). */
  minWidth?: number;
  className?: string;
  id?: string;
  children: ReactNode;
}

const ITEM_SELECTOR = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';

function focusableAfter(origin: HTMLElement | null, backwards: boolean, exclude: HTMLElement | null): HTMLElement | null {
  if (!origin?.isConnected) return null;
  const candidates = [...document.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [contenteditable="true"], [tabindex]')]
    .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && !exclude?.contains(element));
  const index = candidates.indexOf(origin);
  if (index < 0) return null;
  return candidates[index + (backwards ? -1 : 1)] ?? null;
}

export function Menu({ label, anchor, placement, offset, alignOffset, onClose, initialFocus = 'first', returnFocus, minWidth = 220, className, id, children }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; side: 'top' | 'bottom' } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Captured once: the element that gets the focus back when the menu closes.
  const returnTarget = useRef<HTMLElement | null>(null);
  if (returnTarget.current === null && typeof document !== 'undefined') {
    returnTarget.current = returnFocus ?? (anchor instanceof HTMLElement ? anchor : document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
  }
  const anchorKey = isPoint(anchor) ? `${anchor.x},${anchor.y}` : anchor;

  const restoreFocus = useCallback(() => {
    const target = returnTarget.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, []);
  const close = useCallback((reason: MenuCloseReason) => { onCloseRef.current?.(reason); }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !anchor) return;
    const box = isPoint(anchor) ? anchor : (() => { const rect = anchor.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; })();
    const next = computeMenuPosition(box, { width: element.offsetWidth, height: element.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, { placement, offset, alignOffset });
    setPosition(current => current && current.left === next.left && current.top === next.top && current.side === next.side ? current : next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, placement, offset, alignOffset]);

  // Focus enters the menu once it is visible (a visibility:hidden element cannot take focus).
  const placed = position !== null;
  useEffect(() => {
    if (!placed) return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];
    (initialFocus === 'last' ? items[items.length - 1] : items[0])?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || ref.current?.contains(target)) return;
      if (anchor instanceof HTMLElement && anchor.contains(target)) return; // The trigger toggles on its own.
      close('outside');
    };
    const resize = () => close('resize');
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', resize); };
  }, [anchor, close]);

  // Closing while the focus is still inside (or already dropped to <body>) hands it back to the trigger.
  useLayoutEffect(() => {
    const element = ref.current;
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body || element?.contains(active)) restoreFocus();
    };
  }, [restoreFocus]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      if (!onCloseRef.current) return; // Let the owner's page-level Escape close it.
      event.preventDefault(); event.stopPropagation();
      restoreFocus(); close('escape');
      return;
    }
    if (event.key === 'Tab') {
      if (!onCloseRef.current) return;
      event.preventDefault(); event.stopPropagation();
      const next = focusableAfter(returnTarget.current, event.shiftKey, ref.current);
      restoreFocus(); close('tab');
      if (next) requestAnimationFrame(() => { if (next.isConnected) next.focus(); });
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      items[nextMenuIndex(event.key, current, items.length)]?.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
      // Enter / Space activate the focused button natively; keep them (and arrows) away from canvas shortcuts.
      event.stopPropagation();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.stopPropagation();
      // A single-letter shortcut shown in the menu does what it says; other letters jump by first character.
      const direct = items.find(item => item.dataset.shortcut === event.key.toLocaleLowerCase() && item.getAttribute('aria-disabled') !== 'true');
      if (direct) { event.preventDefault(); direct.click(); return; }
      const index = typeaheadIndex(items.map(item => item.dataset.typeahead ?? ''), event.key, current);
      if (index >= 0) { event.preventDefault(); items[index].focus({ preventScroll: true }); }
    }
  };

  const content = (
    <MenuContext.Provider value={{ close, restoreFocus }}>
      <div
        ref={ref}
        id={id}
        role="menu"
        aria-label={label}
        aria-orientation="vertical"
        tabIndex={-1}
        className={`field-menu${className ? ` ${className}` : ''}`}
        data-side={position?.side ?? 'bottom'}
        style={{ left: position?.left ?? 0, top: position?.top ?? 0, minWidth, visibility: position ? undefined : 'hidden' }}
        onKeyDown={onKeyDown}
        onContextMenu={event => event.preventDefault()}
      >
        {children}
      </div>
    </MenuContext.Provider>
  );
  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
}

export interface MenuItemProps {
  /** Visible text. */
  label: ReactNode;
  /** Accessible name when it must differ from the visible text (contract names such as “导入素材”). */
  ariaLabel?: string;
  icon?: ReactNode;
  /** Keyboard shortcut shown in a kbd on the right (“N”, “Ctrl O”). A single letter also works inside the menu. */
  shortcut?: string;
  /** Short muted text on the right; with `disabled` it says why the item is unavailable. */
  reason?: string;
  /** Unavailable but still focusable and announced (`aria-disabled`). */
  disabled?: boolean;
  danger?: boolean;
  /** Keep the menu open after activation (the owner closes it, for example after an async step). */
  keepOpen?: boolean;
  busy?: boolean;
  title?: string;
  onSelect?: () => void;
}

export function MenuItem({ label, ariaLabel, icon, shortcut, reason, disabled = false, danger = false, keepOpen = false, busy = false, title, onSelect }: MenuItemProps) {
  const menu = useContext(MenuContext);
  const reasonId = useId();
  const typeahead = typeof label === 'string' ? label : ariaLabel ?? '';
  const single = shortcut && /^[a-z0-9?]$/i.test(shortcut) ? shortcut.toLocaleLowerCase() : undefined;
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={`field-menu__item${danger ? ' is-danger' : ''}`}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      aria-describedby={reason ? reasonId : undefined}
      aria-busy={busy || undefined}
      aria-keyshortcuts={shortcut ? shortcut.replace(/\s+/g, '+') : undefined}
      title={title}
      data-shortcut={single}
      data-typeahead={typeahead}
      onPointerMove={event => { if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true }); }}
      onClick={event => {
        event.stopPropagation();
        if (disabled || busy) return;
        if (!keepOpen) { menu?.restoreFocus(); menu?.close('select'); }
        onSelect?.();
      }}
    >
      {icon && <span className="field-menu__icon" aria-hidden="true">{icon}</span>}
      <span className="field-menu__label">{label}</span>
      {reason ? <span className="field-menu__reason" id={reasonId}>{reason}</span> : shortcut ? <kbd className="field-menu__kbd" aria-hidden="true">{shortcut}</kbd> : null}
    </button>
  );
}

/** A titled group of items (“自己写”“收集”). The title is plain 12px text, not upper-cased. */
export function MenuSection({ title, children }: { title?: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <div className="field-menu__section" role="group" aria-labelledby={title ? titleId : undefined}>
      {title && <div className="field-menu__heading" id={titleId} role="presentation">{title}</div>}
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div className="field-menu__separator" role="separator" />;
}

/* ---------------------------------------------------------------- tooltip */

interface TipState { element: HTMLElement; label: string; kbd?: string; note?: string }

/**
 * Covers a HUD button with an empty-`title` layer: hovering it shows no native tooltip, while the button's
 * own `title` stays in the DOM for locators and as the accessible description. Clicks land on the layer
 * and bubble to the button.
 */
export function TipHit() {
  return <span className="hud-hit" title="" aria-hidden="true" />;
}

/**
 * One drawn tooltip for every `[data-tip]` element inside the returned ref's element. `data-tip` is the
 * label, `data-tip-kbd` the shortcut, `data-tip-note` a muted second phrase. Hover shows it after 500ms
 * (immediately while another tip was just visible), keyboard focus shows it at once, leaving hides it at
 * once, pressing hides it until the pointer leaves. Mounted on document.body above everything (z-tooltip).
 */
export function useHudTooltip<T extends HTMLElement = HTMLElement>(): { ref: (element: T | null) => void; tooltip: ReactNode } {
  const [root, setRoot] = useState<T | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root) return;
    let timer = 0;
    let warmUntil = 0;
    let suppressed: HTMLElement | null = null;
    const read = (element: HTMLElement): TipState => ({ element, label: element.dataset.tip ?? '', kbd: element.dataset.tipKbd || undefined, note: element.dataset.tipNote || undefined });
    const owner = (event: Event) => (event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tip]') : null);
    const hide = () => { window.clearTimeout(timer); setTip(current => { if (current) warmUntil = performance.now() + 400; return null; }); };
    const show = (element: HTMLElement, delay: number) => {
      window.clearTimeout(timer);
      if (element.getAttribute('aria-expanded') === 'true') return;
      if (delay <= 0) setTip(read(element));
      else timer = window.setTimeout(() => { if (element.isConnected && element.matches(':hover')) setTip(read(element)); }, delay);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const element = owner(event);
      if (!element || !root.contains(element) || element === suppressed) return;
      show(element, performance.now() < warmUntil ? 0 : 500);
    };
    const out = (event: PointerEvent) => {
      const element = owner(event);
      if (!element) return;
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (next && element.contains(next)) return;
      if (suppressed === element) suppressed = null;
      hide();
    };
    const down = (event: PointerEvent) => { suppressed = owner(event); window.clearTimeout(timer); setTip(null); };
    const focusIn = (event: FocusEvent) => {
      const element = owner(event);
      if (element && element.matches(':focus-visible')) show(element, 0);
    };
    const keyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    root.addEventListener('pointerover', over);
    root.addEventListener('pointerout', out);
    root.addEventListener('pointerdown', down);
    root.addEventListener('focusin', focusIn);
    root.addEventListener('focusout', hide);
    root.addEventListener('keydown', keyDown);
    return () => {
      window.clearTimeout(timer);
      root.removeEventListener('pointerover', over);
      root.removeEventListener('pointerout', out);
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('focusin', focusIn);
      root.removeEventListener('focusout', hide);
      root.removeEventListener('keydown', keyDown);
    };
  }, [root]);

  useLayoutEffect(() => {
    if (!tip || !tipRef.current) { setPlace(null); return; }
    const anchor = tip.element.getBoundingClientRect();
    const box = tipRef.current.getBoundingClientRect();
    let top = anchor.top - box.height - 8;
    if (top < VIEWPORT_MARGIN) top = anchor.bottom + 8;
    const left = clamp(anchor.left + anchor.width / 2 - box.width / 2, VIEWPORT_MARGIN, window.innerWidth - box.width - VIEWPORT_MARGIN);
    setPlace({ left, top });
  }, [tip]);

  const tooltip = tip && typeof document !== 'undefined' ? createPortal(
    <div ref={tipRef} className="hud-tip" role="tooltip" aria-hidden="true" style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? undefined : 'hidden' }}>
      <span className="hud-tip__label">{tip.label}</span>
      {tip.note && <span className="hud-tip__note">{tip.note}</span>}
      {tip.kbd && tip.kbd.split(' / ').map(key => <kbd key={key} className="hud-tip__kbd">{key}</kbd>)}
    </div>,
    document.body,
  ) : null;
  return { ref: setRoot, tooltip };
}

/* ---------------------------------------------------------------- roving focus */

/**
 * Roving tabindex for a toolbar (§6.28): the toolbar is one Tab stop; ArrowLeft/Right (and Up/Down when
 * `vertical`), Home and End move between its buttons. The last focused button keeps the Tab stop.
 * Returns the ref callback for the toolbar element.
 */
export function useRovingFocus<T extends HTMLElement = HTMLElement>(options: { vertical?: boolean } = {}): (element: T | null) => void {
  const [root, setRoot] = useState<T | null>(null);
  const vertical = !!options.vertical;
  useLayoutEffect(() => {
    if (!root) return;
    const buttons = () => [...root.querySelectorAll<HTMLElement>('button:not(:disabled)')].filter(button => button.getClientRects().length > 0);
    const sync = (current?: HTMLElement | null) => {
      const list = [...root.querySelectorAll<HTMLElement>('button')];
      const stop = current && list.includes(current) ? current : list.find(button => button.tabIndex === 0 && !(button as HTMLButtonElement).disabled) ?? list.find(button => !(button as HTMLButtonElement).disabled);
      for (const button of list) button.tabIndex = button === stop ? 0 : -1;
    };
    sync();
    const observer = new MutationObserver(() => sync());
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    const focusIn = (event: FocusEvent) => { if (event.target instanceof HTMLElement && event.target.matches('button')) sync(event.target); };
    const keyDown = (event: KeyboardEvent) => {
      const keys = vertical ? ['ArrowUp', 'ArrowDown', 'Home', 'End'] : ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key) || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const list = buttons();
      const index = list.indexOf(document.activeElement as HTMLElement);
      if (index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      const key = event.key === 'ArrowUp' ? 'ArrowLeft' : event.key === 'ArrowDown' ? 'ArrowRight' : event.key;
      const target = list[nextMenuIndex(key, index, list.length)];
      target?.focus();
    };
    root.addEventListener('focusin', focusIn);
    root.addEventListener('keydown', keyDown);
    return () => { observer.disconnect(); root.removeEventListener('focusin', focusIn); root.removeEventListener('keydown', keyDown); };
  }, [root, vertical]);
  return setRoot;
}
