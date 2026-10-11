import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SAFE_GAP, computeSafeInsets, getCanvasSafeInsets, getVisibleFlowRect, registerCanvasOverlay,
  registeredCanvasOverlayCount, visibleFlowRect, visibleScreenRect, type Rect,
} from '../src/canvas/safe-area';

// Canvas container of a 1440×900 window with the sidebar open (screen coordinates).
const area: Rect = { x: 254, y: 78, width: 1186, height: 822 };
const bottomOf = (rect: Rect) => rect.y + rect.height;

test('48px rail is outside the measured viewport; the bottom gap stays 24px without subtracting the rail twice', () => {
  const viewport = { ...area, height: area.height - 48 };
  const rail: Rect = { x: area.x, y: bottomOf(viewport), width: area.width, height: 48 };
  const insets = computeSafeInsets(viewport, [{ edge: 'bottom', rect: rail }]);
  assert.deepEqual(insets, { top: 24, right: 24, bottom: 24, left: 24 });
  assert.equal(visibleScreenRect(viewport, insets).height, area.height - 48 - 48);
});

test('only the popped minimap registers a bottom overlay, including its 12px distance above the rail', () => {
  const viewport = { ...area, height: area.height - 48 };
  const map: Rect = { x: area.x + area.width - 232, y: bottomOf(viewport) - 12 - 144, width: 220, height: 144 };
  assert.equal(computeSafeInsets(viewport, [{ edge: 'bottom', rect: map }]).bottom, 144 + 12 + 24);
});

test('the deepest overlay of an edge wins and edges without overlays keep only the gap', () => {
  const toolbar: Rect = { x: 600, y: bottomOf(area) - 80, width: 466, height: 60 };
  const navigator: Rect = { x: 1281, y: bottomOf(area) - 130, width: 140, height: 36 };
  const banner: Rect = { x: 500, y: area.y + 12, width: 560, height: 36 };
  const insets = computeSafeInsets(area, [{ edge: 'bottom', rect: toolbar }, { edge: 'bottom', rect: navigator }, { edge: 'top', rect: banner }]);
  assert.deepEqual(insets, { top: 12 + 36 + 24, right: 24, bottom: 130 + 24, left: 24 });
});

test('overlays outside the canvas container, hidden (zero-size) or larger than it never produce bogus insets', () => {
  const aboveCanvas: Rect = { x: 254, y: 40, width: 1186, height: 30 }; // e.g. a banner still rendered under the top bar
  const hidden: Rect = { x: 600, y: 800, width: 0, height: 0 };
  const huge: Rect = { x: 0, y: 0, width: 4000, height: 4000 };
  assert.deepEqual(computeSafeInsets(area, [{ edge: 'top', rect: aboveCanvas }, { edge: 'bottom', rect: hidden }]), { top: 24, right: 24, bottom: 24, left: 24 });
  assert.equal(computeSafeInsets(area, [{ edge: 'left', rect: huge }]).left, area.width + 24, 'depth is clamped to the container size');
  assert.equal(computeSafeInsets(area, [], Number.NaN).top, DEFAULT_SAFE_GAP, 'an unreadable --safe-gap falls back to 24px');
});

test('the visible screen rect subtracts insets and always keeps a usable share of a crowded canvas', () => {
  assert.deepEqual(visibleScreenRect({ width: 1186, height: 822 }, { top: 24, right: 24, bottom: 154, left: 24 }), { x: 24, y: 24, width: 1138, height: 644 });
  const crowded = visibleScreenRect({ width: 400, height: 300 }, { top: 200, right: 24, bottom: 200, left: 24 });
  assert.ok(crowded.height >= 300 * .25 - 1e-9 && crowded.y > 0 && crowded.y + crowded.height <= 300);
});

test('the visible flow rect maps the safe area through the React Flow viewport', () => {
  const rect = visibleFlowRect({ x: 100, y: 50, zoom: 2 }, { width: 1000, height: 800 }, { top: 24, right: 24, bottom: 88, left: 24 });
  assert.deepEqual(rect, { x: -38, y: -13, width: 476, height: 344 });
  // Zoom 1 at the origin: the flow rect equals the screen safe area.
  assert.deepEqual(visibleFlowRect({ x: 0, y: 0, zoom: 1 }, { width: 1000, height: 800 }, { top: 24, right: 24, bottom: 88, left: 24 }), { x: 24, y: 24, width: 952, height: 688 });
});

test('overlays register with a data-canvas-overlay marker and unregister exactly once', () => {
  const element = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
  const before = registeredCanvasOverlayCount();
  const release = registerCanvasOverlay(element, 'bottom');
  assert.equal(registeredCanvasOverlayCount(), before + 1);
  assert.equal(element.dataset.canvasOverlay, 'bottom');
  release(); release();
  assert.equal(registeredCanvasOverlayCount(), before);
});

test('without a mounted canvas the safe area degrades to the plain gap instead of throwing', () => {
  assert.deepEqual(getCanvasSafeInsets(), { top: 24, right: 24, bottom: 24, left: 24 });
  const rect = getVisibleFlowRect({ x: 0, y: 0, zoom: 1 });
  assert.ok([rect.x, rect.y, rect.width, rect.height].every(Number.isFinite));
});
