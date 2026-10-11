import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import CanvasRail from '../src/shell/CanvasRail';
import CanvasLayers from '../src/shell/CanvasLayers';
import { START_MIN_ZOOM, startAreaZoom } from '../src/canvas/reveal';
import { assertNone, getBy, hasClass, textContent } from './helpers/markup';

test('rail owns the sole hint in a persistent middle slot; ReactFlow layers no longer draw a grid or hint', () => {
  const rail = renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(CanvasRail, {
    tools: createElement('span', null, 'tools'), navigation: createElement('span', null, 'navigation'),
  })));
  const middle = getBy(rail, { className: 'canvas-rail__hint' });
  assert.ok(hasClass(getBy(rail, { className: 'canvas-rail' }), 'canvas-rail'));
  assert.ok(textContent(getBy(middle, { className: 'canvas-hint' })).includes('按住空格拖动画布'));
  assertNone(rail, { attrs: { 'data-canvas-overlay': true } });
  const layers = renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(CanvasLayers, { guides: [] })));
  for (const className of ['canvas-hint', 'canvas-hint-panel', 'react-flow__background']) assertNone(layers, { className });
});

test('first-open full-tier zoom stops at 0.86 with the rail already outside the viewport', () => {
  assert.equal(START_MIN_ZOOM, .86);
  assert.equal(startAreaZoom({ x: 0, y: 0, width: 2200, height: 1600 }, { width: 1200, height: 800 }, { top: 24, right: 24, bottom: 24, left: 24 }), .86);
});
