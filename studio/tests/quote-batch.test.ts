import assert from 'node:assert/strict';
import test from 'node:test';
import { createNode, createQuoteBatch, estimateQuoteHeight } from '../src/board-utils';
import { createBoard } from '../src/templates';
import { STORAGE_LIMITS, validateBoard } from '../src/storage';
import type { BoardNode } from '../src/model';

function fixture() {
  const board=createBoard('blank');const source=createNode('video',{x:100,y:80});
  source.data.transcript=Array.from({length:9},(_,index)=>({id:`line-${index}`,start:index*3,end:index*3+2,text:`当前第 ${index+1} 句` }));
  source.data.transcriptRevision='manual-revision';board.nodes=[source];
  return {board,source,lines:source.data.transcript};
}
// A new excerpt stores no height (it follows its content, §6.11); its expected height is the code's estimate.
const height=(node:BoardNode)=>node.style?.height??(node.data.kind==='quote'?estimateQuoteHeight(node.data.citation?.text??''):500);
function overlap(a:BoardNode,b:BoardNode) {
  return a.position.x<b.position.x+(b.style?.width??290)&&a.position.x+(a.style?.width??290)>b.position.x
    &&a.position.y<b.position.y+height(b)&&a.position.y+height(a)>b.position.y;
}

test('five consecutive excerpts including disjoint runs avoid existing and newly-created cards',()=>{
  const {board,source,lines}=fixture();const blocker=createNode('note',{x:460,y:115});blocker.style={width:310,height:630};board.nodes.push(blocker);
  let current=board;const created:BoardNode[]=[];
  for(const selection of [[0],[1],[2,4],[5],[6]]){
    const before=current;const batch=createQuoteBatch(current,source.id,selection.map(index=>lines[index]),{limits:STORAGE_LIMITS});
    assert.equal(before.nodes.length,current.nodes.length);assert.notEqual(batch.board,before);
    current=batch.board;created.push(...batch.quotes);
    assert.deepEqual(current.viewport,board.viewport); // Adding cards never moves the reader.
    assert.doesNotThrow(()=>validateBoard(current));
  }
  assert.equal(created.length,6);assert.equal(current.edges.length,6);
  for(const [index,quote] of created.entries()){
    assert.equal(overlap(quote,blocker),false);assert.equal(overlap(quote,source),false);
    for(const other of created.slice(index+1))assert.equal(overlap(quote,other),false);
    assert.equal(quote.data.citation?.transcriptRevision,'manual-revision');
    assert.match(quote.data.title,/^摘录 · /);
  }
});

test('a measured tall existing card is avoided, while an explicit first drop point is preserved',()=>{
  const {board,source,lines}=fixture();const blocker=createNode('note',{x:460,y:115});board.nodes.push(blocker);
  const placed=createQuoteBatch(board,source.id,[lines[0]],{limits:STORAGE_LIMITS,measurements:{[blocker.id]:{width:290,height:780}}});
  assert.ok(placed.quotes[0].position.y>=895);
  const point={x:source.position.x,y:source.position.y};
  const dropped=createQuoteBatch(board,source.id,[lines[0],lines[2]],{limits:STORAGE_LIMITS,position:point});
  assert.deepEqual(dropped.quotes[0].position,point);assert.equal(overlap(dropped.quotes[0],dropped.quotes[1]),false);
});

test('excerpt uses current corrected text and initial revision fallback; selection is one immutable board change',()=>{
  const {board,source,lines}=fixture();delete source.data.transcriptRevision;
  const before=structuredClone(board);
  const batch=createQuoteBatch(board,source.id,[{...lines[0],text:'stale caller text'},lines[2]],{limits:STORAGE_LIMITS});
  assert.deepEqual(board,before);assert.equal(batch.quotes.length,2);
  assert.equal(batch.quotes[0].data.citation?.text,lines[0].text);assert.equal(batch.quotes[0].data.citation?.transcriptRevision,'initial');
  // The caller can restore exactly this previous board with a single history entry.
  assert.equal(batch.board.nodes.length-before.nodes.length,2);assert.equal(batch.board.edges.length-before.edges.length,2);
});

test('an excerpt prefers a saved Chinese line and keeps a line that has none',()=>{
  const {board,source,lines}=fixture();
  lines[0].translation='  第一句  ';
  lines[1].translation='   ';
  const batch=createQuoteBatch(board,source.id,[lines[0],lines[1]],{limits:STORAGE_LIMITS});
  assert.equal(batch.quotes.length,1);
  assert.equal(batch.quotes[0].data.citation?.text,`第一句\n${lines[1].text}`);
  const spoken=createQuoteBatch(board,source.id,[lines[0]],{limits:STORAGE_LIMITS,script:'source'});
  assert.equal(spoken.quotes[0].data.citation?.text,lines[0].text);
});

test('node and edge limits reject a whole batch without partial insertion',()=>{
  const {board,source,lines}=fixture();const before=structuredClone(board);
  assert.throws(()=>createQuoteBatch(board,source.id,[lines[0],lines[2]],{limits:{nodes:2,edges:1500}}),/2 张卡片/);
  assert.throws(()=>createQuoteBatch(board,source.id,[lines[0],lines[2]],{limits:{nodes:500,edges:1}}),/1 条连线/);
  assert.deepEqual(board,before);
});
