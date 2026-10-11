/**
 * Where a card's focus came from (§3.10, K8), and whether the pointer has really moved over the cards.
 *
 * Focus. A mouse click focuses the React Flow node; the next key the browser sees — a lone Shift held for a
 * multiselection click, or a shortcut such as F — turns that node `:focus-visible`, and the 3px light ring
 * appeared on a card nobody was steering with the keyboard (P4: no glow at rest). The same happened to the
 * card the app focuses by itself after an example or a board opens (CORE-19). Such a node carries
 * `data-focus-source="pointer"` (clicked) or `"program"` (focused by the app while the person was using the
 * mouse), and the ring is hidden while it does. Keys that move focus or act on it (Tab, the arrows that move
 * the card, Enter, Space, Esc, Home/End, Page keys) mean the keyboard is in use: they remove the mark, and a
 * card focused by the app after such a key keeps its ring, so a keyboard user always sees where focus is.
 * Shortcut letters and Ctrl/⌘ combinations do not change who is steering.
 *
 * Hover. When a welcome or a dialog closes, the cards appear under a pointer that has not moved; the browser
 * still reports `:hover`, so the card under the cursor showed its hover controls as if pointed at. While the
 * app's own focus move is the latest event, the canvas carries `data-pointer-still`; the hover affordances are
 * held back (cards.css) until the pointer actually moves or presses.
 *
 * One set of document listeners serves every card (installed by the first card that mounts).
 */
const NODE = '.react-flow__node';
const CANVAS = '.react-flow';
const KEYBOARD_KEYS = new Set([
  'Tab', 'Enter', ' ', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'F6',
]);
let installed = false;
/** Who is steering: the keyboard after a navigation key, the pointer after a press. Starts with the pointer. */
let keyboard = false;
/** A press just happened: the focus that follows it is the pointer's, not the app's. */
let pressedAt = -Infinity;
let lastX = Number.NaN;
let lastY = Number.NaN;
let stillCanvas: HTMLElement | null = null;

function releaseStill() {
  if (!stillCanvas) return;
  delete stillCanvas.dataset.pointerStill;
  stillCanvas = null;
}

function onPointerDown(event: PointerEvent) {
  keyboard = false;
  pressedAt = event.timeStamp;
  lastX = event.clientX;
  lastY = event.clientY;
  releaseStill();
  const node = (event.target as Element | null)?.closest?.(NODE);
  if (node instanceof HTMLElement) node.dataset.focusSource = 'pointer';
}

function onPointerMove(event: PointerEvent) {
  // A layout change under a resting cursor may be reported as a move to the same spot: only a real move counts.
  const moved = event.clientX !== lastX || event.clientY !== lastY;
  lastX = event.clientX;
  lastY = event.clientY;
  if (moved) releaseStill();
}

function onKeyDown(event: KeyboardEvent) {
  if (!KEYBOARD_KEYS.has(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
  keyboard = true;
  releaseStill();
  for (const node of document.querySelectorAll<HTMLElement>(`${NODE}[data-focus-source]`)) delete node.dataset.focusSource;
}

function onFocusIn(event: FocusEvent) {
  const node = event.target instanceof HTMLElement && event.target.matches(NODE) ? event.target : null;
  if (!node || keyboard) return;
  // Focus right after a press belongs to that press (already marked “pointer” when it landed on a card).
  if (event.timeStamp - pressedAt < 400 && node.dataset.focusSource === 'pointer') return;
  node.dataset.focusSource = 'program';
  const canvas = node.closest<HTMLElement>(CANVAS);
  if (canvas && canvas !== stillCanvas) {
    releaseStill();
    canvas.dataset.pointerStill = '';
    stillCanvas = canvas;
  }
}

export function installFocusSource() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusin', onFocusIn, true);
}
