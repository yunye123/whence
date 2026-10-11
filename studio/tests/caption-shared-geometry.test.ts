import test from 'node:test';
import assert from 'node:assert/strict';
import type { BoardNode } from '../src/model';
import { getCardBounds, frameContainsCard } from '../src/card-placement';
import { captionRules, getVisibleCardBounds } from '../src/app/caption-rules';
import { selectionGeometry } from '../src/CanvasSelectionTools';
import { snapCards } from '../src/card-snap';

const node = (id: string, kind: BoardNode['data']['kind'], x: number, y: number, width = 100, height = 100): BoardNode =>
  ({id, type:'card', position:{x,y}, style:{width,height}, data:{kind,title:id,body:'原始内容 🙂'}});

test('selection and obstacles include only constant full captions, with raw sizes and source data unchanged', () => {
  const photo=node('photo','image',0,0), note=node('note','note',200,0), nodes=[photo,note];
  const before=JSON.stringify(nodes), captions=captionRules(nodes).captionIds;
  assert.equal(selectionGeometry(nodes,['photo'],{},captions).selection?.height,124);
  assert.equal(selectionGeometry(nodes,['photo'],{},captions,'simple').selection?.height,100);
  assert.equal(selectionGeometry(nodes,['note'],{},captions).obstacles.find(box=>box.x===0)?.height,124);
  const tight=captionRules([photo,node('below','note',0,110)]).captionIds;
  assert.equal(selectionGeometry([photo],['photo'],{},tight).selection?.height,100);
  assert.equal(getCardBounds(photo).height,100);
  assert.equal(JSON.stringify(nodes),before);
});

test('a selected tray includes a member caption extending beyond its raw 16px bottom padding', () => {
  const frame=node('frame','frame',0,0,200,200), photo=node('photo','image',16,84,100,100), nodes=[frame,photo];
  const before=JSON.stringify(nodes), captions=captionRules(nodes).captionIds;
  assert.equal(frameContainsCard(frame,photo),true);
  const full=selectionGeometry(nodes,['frame'],{},captions).selection!;
  assert.equal(full.y,-26);
  assert.equal(full.y+full.height,208);
  const simple=selectionGeometry(nodes,['frame'],{},captions,'simple').selection!;
  assert.equal(simple.y+simple.height,200);
  assert.equal(getCardBounds(frame).height,200);
  assert.equal(JSON.stringify(nodes),before);
});

test('snap aligns the visible photo bottom while low detail and raw containment keep the original geometry', () => {
  const moving=node('moving','note',0,0), photo=node('photo','image',200,-24), nodes=[moving,photo];
  const before=JSON.stringify(nodes), captions=captionRules(nodes).captionIds;
  const raw=snapCards(nodes,['moving']);
  assert.equal(raw.guides.length,0);
  const full=snapCards(nodes,['moving'],{}, {getBounds:(item,sizes)=>getVisibleCardBounds(item,sizes,captions)});
  assert.equal(full.dy,0);
  assert.ok(full.guides.some(guide=>guide.axis==='y'&&guide.feature==='end'&&guide.position===100));
  const low=snapCards(nodes,['moving'],{}, {getBounds:(item,sizes)=>getVisibleCardBounds(item,sizes,captions,'far')});
  assert.deepEqual(low,raw);
  assert.equal(JSON.stringify(nodes),before);
});
