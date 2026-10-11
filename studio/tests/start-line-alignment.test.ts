import assert from 'node:assert/strict';
import test from 'node:test';
import { startLineOffset } from '../src/canvas/start-line-alignment';

test('first-open moves a clipped annotation into the gap before its next line', () => {
  const ink = [{top:90,bottom:112},{top:641.88,bottom:659.08},{top:660.8,bottom:678}];
  assert.equal(startLineOffset(ink,{top:52,bottom:652},24),-8);
});
test('first-open keeps an already complete screen in place', () => {
  assert.equal(startLineOffset([{top:90,bottom:112},{top:600,bottom:620}],{top:52,bottom:652},24),0);
});
test('first-open never shifts a card header across the top edge', () => {
  assert.equal(startLineOffset([{top:52,bottom:72},{top:641,bottom:659}],{top:52,bottom:652},0),12);
});
test('first-open does not chase whitespace beyond its 24px correction budget', () => {
  assert.equal(startLineOffset([{top:610,bottom:700}],{top:52,bottom:652},24),0);
});
