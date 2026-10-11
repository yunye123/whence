import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, LoaderCircle, X } from 'lucide-react';
import ProvenanceTag from '../components/ProvenanceTag';

/* ------------------------------------------------------------------------------------------------
 * Toast queue (DESIGN_SYSTEM §6.22, CV-M1, M-05)
 *
 * - At most 3 at once, newest at the bottom, in one stack above the rail and centred on the visible viewport;
 *   when the canvas is not visible the stack moves to the left of the panel footer (§5.3).
 * - 4s normal, 8s with “撤销”, errors stay until closed; hovering or focusing the stack pauses timers.
 * - One step's feedback at a time (round 4): a new toast takes over from the ordinary toasts that have been up for a
 *   second or more — they fade out, their undo stays on Ctrl+Z — so the next step of a flow (摘到画布 → 插入原文) never
 *   stacks under the last one. Errors never leave this way and never push others out; toasts raised together still stack.
 * - role="status" (errors role="alert"); layered at --z-toast: above the panel, below dialogs.
 *
 * Anyone can raise a toast with `showToast(message, options)`; App's legacy `toast` string prop is
 * bridged into the same queue until App adopts the API (docs/redesign/integration/selection.md).
 * ---------------------------------------------------------------------------------------------- */

export type ToastTone = 'info' | 'success' | 'error';
export interface ToastAction { label: string; ariaLabel?: string; onAction: () => void }
export interface ToastOptions {
  tone?: ToastTone;
  /** Location shown as a mini provenance tag: “已摘到画布，系在 [第 3 段]”. */
  tag?: string;
  /** Adds “撤销” and extends the duration to 8s. */
  undo?: () => void;
  /** One extra action before “撤销” (“查看”, “前往”, “查看全部”). */
  action?: ToastAction;
  /** Milliseconds; null keeps the toast until it is closed. Defaults follow §6.22. */
  duration?: number | null;
  /** Same key replaces the visible toast instead of stacking a duplicate. Defaults to the message. */
  key?: string;
  /**
   * The toast comes with new cards the camera is about to follow (an import, pasted links): it appears once the canvas
   * has moved and rested, in its final place. Inferred for App's “已导入 N 个…” / “已加入 N 个链接” until App passes it.
   */
  settle?: boolean;
}
export interface ToastItem extends ToastOptions { id: string; message: string; leaving?: boolean; /** Date.now() when raised. */ at?: number }

export const TOAST_LIMIT = 3;
const EXIT_MS = 140;
/** An ordinary toast up this long gives way to a newer one (a toast that waits for the camera, `settle`, gets 1.5s more). */
export const TOAST_TAKEOVER_MS = 1000;
const SETTLE_GRACE_MS = 1500;

let items: ToastItem[] = [];
let sequence = 0;
const listeners = new Set<() => void>();
const exitTimers = new Map<string, ReturnType<typeof setTimeout>>();
function emit() { for (const listener of [...listeners]) listener(); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function snapshot() { return items; }
const serverSnapshot: ToastItem[] = [];

/** Duration of a toast in ms (null: stays until closed). */
export function toastDuration(item: Pick<ToastItem, 'tone' | 'undo' | 'duration'>): number | null {
  if (item.duration !== undefined) return item.duration;
  if (item.tone === 'error') return null;
  return item.undo ? 8000 : 4000;
}

/** Legacy plain-text messages: failures become persistent alerts. */
export function inferToastTone(message: string): ToastTone {
  return /失败|无法|未完成|未保存|未开始|未导入|错误|暂时无法|出错/.test(message) ? 'error' : 'info';
}

/** App's import results (K11 prefix “已导入 N 个素材”), whose cards land and are followed by the camera. */
export function settlesOnCanvas(message: string): boolean {
  return /^已导入 \d+ 个|^已加入 \d+ 个链接/.test(message);
}

/** Legacy “…，可撤销” suffix → the plain message plus an undo flag. */
export function splitUndoHint(message: string): { message: string; undoable: boolean } {
  const match = /^(.*?)[，,]\s*可撤销[。.]?$/.exec(message.trim());
  return match ? { message: match[1], undoable: true } : { message, undoable: false };
}

/** Raise a toast; returns its id. The oldest toasts leave when more than 3 are visible. */
export function showToast(message: string, options: ToastOptions = {}): string {
  const key = options.key ?? message;
  const existing = items.find(item => !item.leaving && (item.key ?? item.message) === key);
  const id = `toast-${++sequence}`;
  const now = Date.now();
  const next: ToastItem = { ...options, id, message, key, at: now };
  let list = existing ? items.filter(item => item !== existing) : items;
  // The newest step takes over: older ordinary toasts that have been read (up ≥ 1s) fade out.
  const takenOver = options.tone === 'error' ? [] : list.filter(item => !item.leaving && item.tone !== 'error'
    && now - (item.at ?? now) >= TOAST_TAKEOVER_MS + ((item.settle ?? settlesOnCanvas(item.message)) ? SETTLE_GRACE_MS : 0));
  if (takenOver.length) list = list.map(item => takenOver.includes(item) ? { ...item, leaving: true } : item);
  list = [...list, next];
  const visible = list.filter(item => !item.leaving);
  for (const extra of visible.slice(0, Math.max(0, visible.length - TOAST_LIMIT))) list = list.filter(item => item !== extra);
  items = list;
  for (const item of takenOver) exitTimers.set(item.id, setTimeout(() => { exitTimers.delete(item.id); items = items.filter(entry => entry.id !== item.id); emit(); }, EXIT_MS));
  emit();
  return id;
}

/** Close a toast (fades out first). */
export function dismissToast(id: string): void {
  const item = items.find(entry => entry.id === id);
  if (!item || item.leaving) return;
  items = items.map(entry => entry.id === id ? { ...entry, leaving: true } : entry);
  emit();
  exitTimers.set(id, setTimeout(() => { exitTimers.delete(id); items = items.filter(entry => entry.id !== id); emit(); }, EXIT_MS));
}

export function clearToasts(): void {
  for (const timer of exitTimers.values()) clearTimeout(timer);
  exitTimers.clear();
  items = [];
  emit();
}

/** Current queue (tests and diagnostics). */
export function getToasts(): readonly ToastItem[] { return items; }

/**
 * Interim undo for legacy “可撤销” toasts: asks App for the same canvas undo as Ctrl+Z / the top-bar “撤销”.
 * Replaced by a precise `undo` callback once App passes one (integration request).
 */
export function requestCanvasUndo(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }));
}

/* ------------------------------------------------------------------------------------------------
 * Anchor: above the rail, at the visible viewport centre; otherwise the bottom of the visible canvas strip;
 * otherwise left of the panel footer; otherwise the window bottom. The writing
 * paper stays clear (the stack sits at the right of the status band), as does the transcript column of the watching
 * workbench (the stack sits at the bottom of the stage column).
 * ---------------------------------------------------------------------------------------------- */

export interface ToastAnchor { mode: 'toolbar' | 'canvas' | 'panel' | 'window'; x: number; bottom: number; align: 'center' | 'start' | 'end'; maxWidth: number; compact?: boolean; band?: boolean }

/** A canvas strip narrower than this keeps each toast on one line (the location tag never drops to a second line). */
const COMPACT_STRIP = 360;
/** A toast seated in the writing status band is this tall (toast.css `.toast-stack--band`). */
const BAND_TOAST_H = 32;

/** Laid out and visible. `faded` counts a transparent element as shown: a panel fading in is already there. */
function shown(element: Element | null, faded = false): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected || !element.getClientRects().length) return false;
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none' && (faded || Number(style.opacity) > 0.01);
}

/** The optional stack argument remains for callers; the rail now determines its anchor. */
export function computeToastAnchor(_stack?: { width: number; height: number }): ToastAnchor {
  const width = innerWidth, height = innerHeight;
  const rail = document.querySelector('.canvas-rail');
  const flow = document.querySelector('.flow-container');
  const panel = document.querySelector('.inspector');
  const flowShown = shown(flow) && !flow.classList.contains('flow-hidden');
  const flowRect = flowShown ? flow.getBoundingClientRect() : null;
  // A panel that is still fading in (opening, or switching to writing) already decides where the stack goes;
  // without this the stack fell back to the window centre, on top of the writing paper (FW2-10).
  const panelRect = shown(panel, true) ? panel.getBoundingClientRect() : null;
  if (shown(rail) && flowRect) {
    const rect = rail.getBoundingClientRect();
    // Centre on the actual visible viewport, not on the tools at the left end of the rail.
    const right = panelRect && panelRect.left < flowRect.right && panelRect.right > flowRect.left ? Math.max(flowRect.left, panelRect.left) : flowRect.right;
    const visible = right - flowRect.left;
    return { mode: 'toolbar', x: flowRect.left + visible / 2, bottom: height - rect.top + 12,
      align: 'center', maxWidth: Math.max(0, Math.min(560, visible - 32)), compact: visible < COMPACT_STRIP };
  }  // Focus writing (§6.18.4): the paper and its margin notes are the work. The stack sits inside the status band, at
  // its empty right end (the band's own words are on the left); it never lands on the lines (FW2-10).
  if (panelRect && panel?.classList.contains('inspector--writing-expanded')) {
    const band = panel.querySelector('.draft-band, .inspector-footer');
    if (shown(band)) {
      const rect = band.getBoundingClientRect();
      const words = Array.from(band.children).filter(child => shown(child)).map(child => child.getBoundingClientRect().right);
      const used = words.length ? Math.max(...words) : rect.left;
      const x = rect.right - 16;
      return { mode: 'panel', x, bottom: height - rect.bottom + Math.max(0, (rect.height - BAND_TOAST_H) / 2), align: 'end', maxWidth: Math.max(240, Math.min(560, x - used - 24)), band: true };
    }
  }
  if (flowRect) {
    // The visible part of the canvas (an expanded panel can cover its right side).
    const right = panelRect && panelRect.left < flowRect.right && panelRect.right > flowRect.left ? Math.max(flowRect.left, panelRect.left) : flowRect.right;
    const visible = right - flowRect.left;
    if (visible >= 280) return { mode: 'canvas', x: flowRect.left + visible / 2, bottom: height - flowRect.bottom + 20, align: 'center', maxWidth: Math.min(560, visible - 32), compact: visible < COMPACT_STRIP };
  }
  // Watching workbench (§5.3): the transcript column is where the work is (proofreading, ticking lines), so the
  // stack sits at the bottom right of the stage column instead (FV2-10) — over the “写进文稿” status side of the
  // excerpt list, not over the sentences just taken.
  if (panelRect && panel?.classList.contains('inspector--video')) {
    const stage = panel.querySelector('.inspector-stage');
    if (shown(stage)) {
      const rect = stage.getBoundingClientRect();
      return { mode: 'panel', x: rect.right - 16, bottom: height - rect.bottom + 16, align: 'end', maxWidth: Math.min(560, rect.width - 32) };
    }
    const side = panel.querySelector('.inspector-side');
    if (shown(side)) {
      const rect = side.getBoundingClientRect();
      const foot = side.querySelector('.inspector-footer');
      const top = shown(foot) ? foot.getBoundingClientRect().top : rect.bottom;
      return { mode: 'panel', x: rect.left + 16, bottom: height - top + 12, align: 'start', maxWidth: Math.min(560, rect.width - 32) };
    }
  }
  if (panelRect) {
    const footer = panel?.querySelector('.inspector-footer, .inspector-writing-status, footer');
    const footerRect = shown(footer ?? null) ? (footer as HTMLElement).getBoundingClientRect() : null;
    const bottom = footerRect ? height - footerRect.top + 12 : height - panelRect.bottom + 24;
    return { mode: 'panel', x: panelRect.left + 24, bottom, align: 'start', maxWidth: Math.min(560, panelRect.width - 48) };
  }
  // Outline view: the canvas is hidden but its area is still the main column.
  const shell = document.querySelector('.canvas-shell');
  if (shown(shell)) {
    const rect = shell.getBoundingClientRect();
    return { mode: 'canvas', x: rect.left + rect.width / 2, bottom: height - rect.bottom + 24, align: 'center', maxWidth: Math.min(560, rect.width - 32) };
  }
  return { mode: 'window', x: width / 2, bottom: 24, align: 'center', maxWidth: Math.min(560, width - 32) };
}

const sameAnchor = (a: ToastAnchor, b: ToastAnchor) => a.mode === b.mode && a.align === b.align && a.compact === b.compact && a.band === b.band
  && Math.abs(a.x - b.x) < .5 && Math.abs(a.bottom - b.bottom) < .5 && a.maxWidth === b.maxWidth;
/** The canvas must rest this long (camera glide, pan, the selection bar settling) before the stack changes place. */
const QUIET_MS = 160;
/** A change of place fades out and back in (instead of a jump) over this time each way. */
const MOVE_FADE_MS = 120;
/** A `settle` toast waits this long for the canvas to start moving (its cards to mount, the camera to follow)… */
const SETTLE_PREROLL_MS = 600;
/** …and shows anyway after this long. */
const SETTLE_MAX_MS = 1500;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The anchor, kept steady. On the canvas a new place is taken only after the canvas has rested for QUIET_MS, and a
 * real change of place (canvas ↔ panel, or a resized viewport) fades out and in instead of jumping. A stack
 * that opens with a `settle` toast (an import: its cards mount, the camera follows them, the selection bar settles —
 * the toast used to hop centre → left → right meanwhile) stays hidden until the canvas has moved and rested, so it
 * appears once, in its final place. Returns the anchor and whether the stack is hidden (waiting or moving).
 */
function useToastAnchor(active: boolean, settle: boolean, stackRef: RefObject<HTMLDivElement | null>) {
  const [anchor, setAnchor] = useState<ToastAnchor | null>(null);
  const [moving, setMoving] = useState(false);
  const current = useRef<ToastAnchor | null>(null);
  const lastMotion = useRef(0);
  /** Last change of the viewport transform alone (the camera), for `settle` toasts. */
  const lastCamera = useRef(0);
  const shownAt = useRef(0);
  const holding = useRef(false);
  const settleRef = useRef(settle);
  settleRef.current = settle;
  const timers = useRef({ quiet: 0, fade: 0 });
  const update = useCallback(() => {
    const stack = stackRef.current?.getBoundingClientRect();
    const next = computeToastAnchor(stack && stack.height ? { width: stack.width, height: stack.height } : undefined);
    const previous = current.current;
    window.clearTimeout(timers.current.quiet);
    if (holding.current) {
      // Not shown yet: follow the place freely; show once the camera has followed the cards and the canvas rests
      // (when the camera does not move within SETTLE_PREROLL_MS, once the canvas rests after that).
      current.current = next;
      setAnchor(old => old && sameAnchor(old, next) ? old : next);
      const now = performance.now(), held = now - shownAt.current;
      const rest = now - Math.max(lastMotion.current, shownAt.current);
      const followed = lastCamera.current > shownAt.current;
      const due = Math.max(QUIET_MS - rest, followed ? 0 : SETTLE_PREROLL_MS - held);
      if (next.mode !== 'toolbar' || held >= SETTLE_MAX_MS || due <= 0) { holding.current = false; setMoving(false); }
      else timers.current.quiet = window.setTimeout(update, Math.max(16, Math.min(due, SETTLE_MAX_MS - held)) + 8);
      return;
    }
    if (previous && sameAnchor(previous, next)) return;
    if (previous && previous.mode === 'toolbar' && next.mode === 'toolbar') {
      const wait = lastMotion.current + QUIET_MS - performance.now();
      if (wait > 0) { timers.current.quiet = window.setTimeout(update, wait + 8); return; }
    }
    current.current = next;
    const relocate = !!previous && previous.mode === next.mode && (previous.align !== next.align || Math.abs(previous.bottom - next.bottom) > 24 || Math.abs(previous.x - next.x) > 160);
    if (!relocate || reducedMotion()) { window.clearTimeout(timers.current.fade); setMoving(false); setAnchor(next); return; }
    setMoving(true);
    window.clearTimeout(timers.current.fade);
    timers.current.fade = window.setTimeout(() => { setAnchor(current.current); setMoving(false); }, MOVE_FADE_MS);
  }, [stackRef]);
  useLayoutEffect(() => {
    if (active) {
      shownAt.current = performance.now();
      holding.current = settleRef.current && !reducedMotion();
      if (holding.current) setMoving(true);
      update();
      return;
    }
    // Gone: the next stack starts unplaced (hidden for its first frame, see `is-moving` below), never at an old place.
    current.current = null;
    holding.current = false;
    window.clearTimeout(timers.current.quiet); window.clearTimeout(timers.current.fade);
    setMoving(false);
    setAnchor(null);
  }, [active, update]);
  // A `settle` toast joining a stack that is already up (the import's busy line turns into its result): hold the same way.
  const wasSettle = useRef(settle);
  useLayoutEffect(() => {
    const rising = settle && !wasSettle.current;
    wasSettle.current = settle;
    if (!rising || !active || holding.current || reducedMotion()) return;
    shownAt.current = performance.now();
    holding.current = true;
    setMoving(true);
    update();
  }, [settle, active, update]);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); }); };
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    const mutation = typeof MutationObserver === 'function' ? new MutationObserver(() => { observe(); schedule(); }) : null;
    // The canvas is moving: pans, zooms and camera glides (the viewport transform), the selection bar following them,
    // cards mounting or leaving (a batch landing, which the camera follows once it is measured).
    const motion = typeof MutationObserver === 'function' ? new MutationObserver(records => {
      lastMotion.current = performance.now();
      if (records.some(record => (record.target as Element).classList?.contains('react-flow__viewport'))) lastCamera.current = lastMotion.current;
      schedule();
    }) : null;
    // Only the few shell elements whose size, presence or class decides the anchor (never the canvas subtree).
    function observe() {
      resize?.disconnect();
      mutation?.disconnect();
      motion?.disconnect();
      for (const selector of ['.canvas-shell', '.canvas-rail', '.flow-container', '.inspector', '.zoom-controls', '.selection-tools']) {
        const element = document.querySelector(selector);
        if (element) resize?.observe(element);
      }
      const watch = (selector: string, options: MutationObserverInit, observer = mutation) => { const element = document.querySelector(selector); if (element) observer?.observe(element, options); };
      watch('.studio', { attributes: true, attributeFilter: ['class'] });
      watch('.workspace-body', { childList: true });
      watch('.canvas-shell', { childList: true });
      watch('.inspector', { attributes: true, attributeFilter: ['class'] });
      watch('.flow-container', { attributes: true, attributeFilter: ['class'] });
      // The selection bar follows pans and zooms (it is written as a transform); the stack keeps clear of it.
      watch('.selection-tools', { attributes: true, attributeFilter: ['style', 'data-placement', 'data-gesture'] }, motion);
      watch('.react-flow__viewport', { attributes: true, attributeFilter: ['style'] }, motion);
      watch('.react-flow__nodes', { childList: true }, motion);
    }
    observe();
    // Panels slide in (transform, not size): place the stack again when their motion ends.
    const settled = (event: Event) => { if ((event.target as Element | null)?.closest?.('.inspector, .canvas-toolbar')) schedule(); };
    document.addEventListener('animationend', settled, true);
    document.addEventListener('transitionend', settled, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame); resize?.disconnect(); mutation?.disconnect(); motion?.disconnect(); window.removeEventListener('resize', schedule);
      document.removeEventListener('animationend', settled, true);
      document.removeEventListener('transitionend', settled, true);
    };
  }, [active, update]);
  useEffect(() => () => { window.clearTimeout(timers.current.quiet); window.clearTimeout(timers.current.fade); }, []);
  return { anchor, moving };
}

/* ------------------------------------------------------------------------------------------------ */

export interface ToastsProps {
  /** Legacy single message from App; bridged into the queue. */
  toast?: string;
  /** Show “查看” (查看刚刚创建的摘录) on the latest toast. */
  canRevealQuotes?: boolean;
  onRevealQuotes?: () => void;
  onDismiss?: () => void;
  busy?: string;
  /** Undo for legacy “…，可撤销” messages. Defaults to the canvas undo (Ctrl+Z). */
  onUndo?: () => void;
}

interface ToastViewProps { item: ToastItem; paused: boolean; reveal?: ToastAction }

function ToastView({ item, paused, reveal }: ToastViewProps) {
  const duration = toastDuration(item);
  const remaining = useRef(duration ?? 0);
  useEffect(() => {
    if (duration === null || paused || item.leaving) return;
    const started = Date.now();
    const timer = setTimeout(() => dismissToast(item.id), Math.max(0, remaining.current));
    return () => { clearTimeout(timer); remaining.current -= Date.now() - started; };
  }, [duration, paused, item.leaving, item.id]);
  const error = item.tone === 'error';
  const action = item.action ?? reveal;
  return (
    <div
      className={['toast', error && 'toast--error', item.leaving && 'is-leaving'].filter(Boolean).join(' ')}
      role={error ? 'alert' : 'status'}
      data-toast-id={item.id}
    >
      {error && <CircleAlert size={16} className="toast__icon" aria-hidden="true" />}
      <p className="toast__message">
        <span className="toast__text">{item.message}</span>
        {item.tag && <ProvenanceTag label={item.tag} size="mini" variant="stamp-mini" />}
      </p>
      {(action || item.undo) && (
        <span className="toast__actions">
          {action && <button type="button" className="toast__btn" aria-label={action.ariaLabel} onClick={() => { action.onAction(); dismissToast(item.id); }}>{action.label}</button>}
          {item.undo && <button type="button" className="toast__btn" aria-label={`撤销：${item.message}${item.tag ? ` ${item.tag}` : ''}`} onClick={() => { item.undo?.(); dismissToast(item.id); }}>撤销</button>}
        </span>
      )}
      {duration === null && (
        <button type="button" className="toast__close" aria-label="关闭提示" onClick={() => dismissToast(item.id)}><X size={14} aria-hidden="true" /></button>
      )}
    </div>
  );
}

/** The toast queue and the busy indicator, portalled to the body and anchored to the canvas toolbar. */
export default function Toasts({ toast = '', canRevealQuotes = false, onRevealQuotes, onDismiss, busy = '', onUndo }: ToastsProps) {
  const queue = useSyncExternalStore(subscribe, snapshot, () => serverSnapshot);
  const [paused, setPaused] = useState(false);
  const legacy = useRef<{ message: string; id: string; reveal: boolean } | null>(null);
  const callbacks = useRef({ onRevealQuotes, onDismiss, onUndo });
  callbacks.current = { onRevealQuotes, onDismiss, onUndo };

  // Bridge App's single `toast` string into the queue (each new message is one entry).
  useEffect(() => {
    if (!toast) { legacy.current = legacy.current && { ...legacy.current, message: '' }; return; }
    if (legacy.current?.message === toast) { if (canRevealQuotes) legacy.current.reveal = true; return; }
    const { message, undoable } = splitUndoHint(toast);
    const id = showToast(message, {
      tone: inferToastTone(message),
      undo: undoable ? () => (callbacks.current.onUndo ?? requestCanvasUndo)() : undefined,
    });
    legacy.current = { message: toast, id, reveal: canRevealQuotes };
  }, [toast, canRevealQuotes]);

  // Closing the latest legacy toast clears App's copy too.
  const legacyId = legacy.current?.id;
  useEffect(() => {
    if (!legacyId || queue.some(item => item.id === legacyId && !item.leaving)) return;
    if (legacy.current?.message) callbacks.current.onDismiss?.();
  }, [queue, legacyId]);

  const visible = queue.length > 0 || !!busy;
  // Queue shift (§7: 180ms): when a toast arrives or leaves, the others glide to their new place (FLIP).
  const stackRef = useRef<HTMLDivElement>(null);
  const settle = queue.some(item => !item.leaving && (item.settle ?? settlesOnCanvas(item.message)));
  const { anchor, moving } = useToastAnchor(visible, settle, stackRef);
  useEffect(() => { if (!visible) setPaused(false); }, [visible]);

  const positions = useRef(new Map<string, number>());
  const anchorKey = anchor ? `${anchor.mode}|${Math.round(anchor.x)}|${Math.round(anchor.bottom)}` : '';
  const lastAnchorKey = useRef('');
  // Only when the queue changes (App re-renders on every zoom frame; no layout reads there). A moved anchor
  // re-records positions without animating, so the next queue change measures from the right place.
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) { positions.current.clear(); return; }
    const moved = lastAnchorKey.current !== anchorKey;
    lastAnchorKey.current = anchorKey;
    const still = moved || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const next = new Map<string, number>();
    for (const element of stack.querySelectorAll<HTMLElement>('[data-toast-id]')) {
      const id = element.dataset.toastId!;
      const top = element.getBoundingClientRect().top;
      next.set(id, top);
      const previous = positions.current.get(id);
      if (!still && previous !== undefined && Math.abs(previous - top) > .5 && typeof element.animate === 'function') {
        element.animate([{ transform: `translateY(${previous - top}px)` }, { transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
    }
    positions.current = next;
  }, [queue, busy, anchorKey]);
  if (!visible || typeof document === 'undefined') return null;

  const revealAction: ToastAction | undefined = canRevealQuotes && onRevealQuotes ? { label: '查看', ariaLabel: '查看刚刚创建的摘录', onAction: () => callbacks.current.onRevealQuotes?.() } : undefined;
  const style = anchor ? {
    left: `${Math.round(anchor.x)}px`,
    bottom: `${Math.round(anchor.bottom)}px`,
    maxWidth: `${Math.round(anchor.maxWidth)}px`,
  } : undefined;

  return createPortal(
    <div
      ref={stackRef}
      className={`toast-stack toast-stack--${anchor?.align ?? 'center'}${anchor?.compact ? ' toast-stack--compact' : ''}${anchor?.band ? ' toast-stack--band' : ''}${moving || !anchor ? ' is-moving' : ''}`}
      data-anchor={anchor?.mode ?? 'window'}
      style={style}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false); }}
    >
      {busy && <div className="busy-toast" role="status"><LoaderCircle size={16} className="spin" aria-hidden="true" /><span>{busy}</span></div>}
      {queue.map(item => (
        // A held or moving stack is not on screen yet: its 4 s / 8 s only start counting once it shows.
        <ToastView key={item.id} item={item} paused={paused || moving || !anchor} reveal={item.id === legacyId && legacy.current?.reveal ? revealAction : undefined} />
      ))}
    </div>,
    document.body,
  );
}
