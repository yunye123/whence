import type { CardData } from '../model';
import { kindDisplayName } from '../cards/card-utils';
import { quoteDisplayTitle } from '../source-location';
import { editableTarget } from './utils';

// DOM helpers and constants of the studio shell (CORE-32: moved out of App.tsx unchanged). They act on the rendered
// page only: focus moves, waiting for a lazy surface to mount, the canvas Tab order.

export const nodeSelector = (id: string) => `.react-flow__node[data-id="${CSS.escape(id)}"]`;
/** Run `step` on the next frames until it returns true (at most `limit` frames): for elements a lazy panel mounts later. */
export function untilReady(step: () => boolean, limit = 60) { let frames = 0; const tick = () => { if (!step() && ++frames < limit) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
/**
 * CORE-16: a panel opened from the keyboard takes the focus — the reading text, the draft, else its first field — so the
 * next Tab works inside it instead of walking every card first. Esc still returns to the card (closeInspector).
 */
export function focusPanelWhenReady() {
  untilReady(() => {
    const panel = document.querySelector<HTMLElement>('aside.inspector:not([aria-busy="true"])');
    if (!panel) return false;
    if (panel.contains(document.activeElement)) return true;
    // CORE-32: a draft whose editor chunk is still on its way shows a read-only stand-in; wait for the editor itself.
    if (panel.querySelector('.draft-editor__fallback')) return false;
    const target = panel.querySelector<HTMLElement>('.inspector-reading-body, .cm-content, textarea:not([readonly]), input:not([type="hidden"]):not([readonly]), button');
    target?.focus({ preventScroll: true });
    return true;
  });
}
/** CORE-19: after opening an example or a new board, focus its first card (reading order) or the empty state's first action. */
export function focusCanvasStart() {
  let settled = 0;
  untilReady(() => {
    // Wait until the welcome or the dialog that started it has closed (they hand the focus back as they go).
    if (document.querySelector('section.welcome, .modal, dialog[open]')) return false;
    if (settled++ < 2) return false;
    const action = document.querySelector<HTMLElement>('.empty-canvas button:not([disabled])');
    if (action) { action.focus({ preventScroll: true }); return true; }
    const cards = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].filter(node => !node.querySelector('.field-card--frame'));
    if (!cards.length) return false;
    const first = cards.map(node => ({ node, box: node.getBoundingClientRect() })).sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)[0].node;
    first.focus({ preventScroll: true });
    return true;
  }, 90);
}
/**
 * CORE-16: the Tab order inside the canvas. React Flow renders the lines before the cards, so every line used to come
 * before the first card. Here the cards (and the buttons on them) come first in reading order, then the lines and
 * their labels, then the canvas tools (operation bar, toolbar, navigator) — the DOM order of everything else.
 */
export function canvasTabOrder(shell: HTMLElement): HTMLElement[] {
  const all = [...shell.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')].filter(element => element !== shell
    && element.tabIndex >= 0 && !(element as HTMLButtonElement).disabled && !element.closest('[inert], [aria-hidden="true"]')
    && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
  const inLines = (element: HTMLElement) => !!element.closest('.react-flow__edges, .react-flow__edgelabel-renderer');
  const inCards = (element: HTMLElement) => !!element.closest('.react-flow__nodes');
  return [...all.filter(inCards), ...all.filter(inLines), ...all.filter(element => !inCards(element) && !inLines(element))];
}
export const EMPTY_IDS: ReadonlySet<string> = new Set();
/**
 * React Flow lifts a selected node by this much (elevateNodesOnSelect). A tray is a background under its cards (K7,
 * zIndex −1); lifted, it covered them — invisible while trays were transparent, but the light tray is opaque since
 * round 3 (CANVAS-08), so a selected tray hid its own pictures. A selected tray subtracts the lift and stays −1.
 */
export const SELECTED_NODE_Z = 1000;
/** Height a tray label takes above the tray (26) plus a hair of air, in screen pixels at or below 100%. */
export const TRAY_LABEL_BAND = 30;
/** Room a revealed batch leaves above itself for the selection bar (§6.6): 40 + 7 tip + 10 gap + 8, less the 24 of the safe area. */
export const SELECTION_BAR_BAND = 41;
/** CORE-17: a card's accessible name uses the interface terms (§8.1) and the title people see (an excerpt by its sentence). */
export const nodeAriaLabel = (data: CardData) => `${kindDisplayName(data)}：${(data.kind === 'quote' ? quoteDisplayTitle(data) : data.title.trim()) || '未命名'}`;
export const NO_MARKS: readonly never[] = [];
/** First-run welcome (§6.24): shown until an entry or Esc is chosen once on this machine (per-viewer convenience). */
export const WELCOME_KEY = 'field-welcome-v1';

export function focusCanvasNode(id:string) {
  let frames=0;
  const tick=()=>{const element=document.querySelector<HTMLElement>(nodeSelector(id));if(element){element.focus({preventScroll:true});return;}if(++frames<60)requestAnimationFrame(tick);};
  tick();
}
/** Focus a field once it mounts (lazy inspector); never steals focus from a field the person is typing in. */
export function focusWhenReady(selector:string) {
  let frames=0;
  const tick=()=>{
    const active=document.activeElement;
    if(active instanceof HTMLElement&&editableTarget(active)&&!active.matches(selector))return;
    const target=document.querySelector<HTMLElement>(selector);
    // CORE-32: the draft body's read-only stand-in (its editor chunk still loading) carries the same name: wait for the editor.
    if(target&&!target.classList.contains('draft-editor__fallback')){target.focus({preventScroll:true});return;}
    if(++frames<120)requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
/** A new note opens in place for typing (CV-B1): the card's own "编辑笔记" action, as soon as the node mounts. */
export function beginNoteEdit(id:string) {
  let frames=0;
  const editor=()=>document.querySelector(nodeSelector(id))?.querySelector<HTMLTextAreaElement>('textarea')??null;
  const attempt=()=>{
    if(editor())return true;
    const button=document.querySelector(nodeSelector(id))?.querySelector<HTMLButtonElement>('button[aria-label^="编辑笔记："]');
    if(button&&!button.disabled){button.click();return true;}
    return false;
  };
  // The editor mounts a render later and React Flow keeps a new node visibility:hidden until it is measured,
  // which silently rejects focus(); retry until the caret is in it, unless the person moved to another field.
  const settle=()=>{
    const textarea=editor();const active=document.activeElement;
    if(active===textarea||(active instanceof HTMLElement&&active!==textarea&&editableTarget(active)))return;
    if(textarea&&getComputedStyle(textarea).visibility!=='hidden'){textarea.focus({preventScroll:true});if(document.activeElement===textarea)return;}
    if(++frames<45)requestAnimationFrame(settle);
  };
  // React commits the new node in the same task; a microtask edits before the next input event, frames are the fallback.
  queueMicrotask(()=>{
    if(attempt()){requestAnimationFrame(settle);return;}
    const tick=()=>{if(attempt())requestAnimationFrame(settle);else if(++frames<30)requestAnimationFrame(tick);};
    requestAnimationFrame(tick);
  });
}
/** Click a control once the (lazy) panel has mounted it: enter focus writing, open a draft's export menu. */
export function clickWhenReady(selector:string) {let frames=0;const tick=()=>{const target=document.querySelector<HTMLElement>(selector);if(target){target.click();return;}if(++frames<90)requestAnimationFrame(tick);};requestAnimationFrame(tick);}
