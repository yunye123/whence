import assert from 'node:assert/strict';
import test from 'node:test';
import { needsImportPosterRestore, prepareTranscriptReplacement, prepareVideoImportUpdate } from '../src/App';
import { createNode } from '../src/board-utils';
import { createBoard } from '../src/templates';
import { validateBoard } from '../src/storage';
import type { CardData } from '../src/model';

function fixture() {
  const board=createBoard('blank');const node=createNode('video');
  node.data={...node.data,title:'我改过的标题',body:'我在等待时写的笔记',sourceUrl:'https://www.bilibili.com/video/BV1xx/?p=1',nativeImportJobId:'native-job-1',videoImport:{attemptId:'attempt-1',url:'https://www.bilibili.com/video/BV1xx/?p=1',originalText:'分享的原始文案',status:'transcribing',progress:70,message:'提取逐字稿',mediaReady:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}};
  board.nodes=[node];return {board,node};
}

test('invalid completed transcript creates one failure and identical native results cause no further save',()=>{
  const {board,node}=fixture();
  const invalid:Partial<CardData>={transcript:Array.from({length:10001},(_,index)=>({id:`line-${index}`,start:index,end:index+1,text:'原始语句'}))};
  const completed={status:'completed' as const,progress:100,message:'已完成'};
  const first=prepareVideoImportUpdate(board,node.id,'attempt-1',invalid,completed);
  assert.equal(first.valid,false);assert.ok(first.board);assert.match(first.error??'',/字幕|转写|记录|数量|最多|范围|不合法|10,?000/);
  assert.equal(first.board.nodes[0].data.videoImport?.status,'failed');
  assert.equal(first.board.nodes[0].data.body,'我在等待时写的笔记');
  assert.doesNotThrow(()=>validateBoard(first.board));
  let renderedOrSaved=1;let current=first.board;
  for(let count=0;count<4;count++){
    const replay=prepareVideoImportUpdate(current,node.id,'attempt-1',invalid,completed);
    assert.equal(replay.valid,false);assert.equal(replay.board,undefined);assert.equal(replay.error,undefined);
    if(replay.board){renderedOrSaved++;current=replay.board;}
  }
  assert.equal(renderedOrSaved,1);
});

test('stale attempts cannot revive a removed or retried card, and valid completion preserves user edits',()=>{
  const {board,node}=fixture();
  assert.equal(prepareVideoImportUpdate(board,node.id,'old-attempt',{duration:10}).board,undefined);
  assert.equal(prepareVideoImportUpdate({...board,nodes:[]},node.id,'attempt-1',{duration:10}).board,undefined);
  const result=prepareVideoImportUpdate(board,node.id,'attempt-1',{title:'平台标题',body:'',sourceUrl:'https://example.com/rewritten',transcript:[{id:'line-1',start:0,end:1,text:'完成的逐字稿'}]},{status:'completed',progress:100,message:'已完成'});
  assert.equal(result.valid,true);assert.ok(result.board);
  assert.equal(result.board.nodes[0].data.title,node.data.title);
  assert.equal(result.board.nodes[0].data.body,node.data.body);
  assert.equal(result.board.nodes[0].data.sourceUrl,node.data.sourceUrl);
  assert.equal(result.board.nodes[0].data.transcript?.[0].text,'完成的逐字稿');
});

test('restored native snapshots cannot downgrade a cached poster or replace the same asset media copy',()=>{
  const {board,node}=fixture();
  node.data.nativeProjectId='library-1';node.data.nativeAssetId='asset-1';node.data.mediaId='saved-copy';
  node.data.poster='data:image/png;base64,iVBORw0KGgo=';
  const before=structuredClone(board);
  const sameAsset={nativeProjectId:'library-1',nativeAssetId:'asset-1',poster:'media://library-1/posters/asset-1.png',mediaId:'redundant-copy'};
  const replay=prepareVideoImportUpdate(board,node.id,'attempt-1',sameAsset);
  assert.equal(replay.valid,true);assert.equal(replay.board,undefined);
  assert.deepEqual(board,before);
  // A late-media-only patch also belongs to the existing asset and must remain a no-op.
  assert.equal(prepareVideoImportUpdate(board,node.id,'attempt-1',{poster:sameAsset.poster,mediaId:'another-copy'}).board,undefined);
  const newPoster='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7fHAAAAAASUVORK5CYII=';
  const improved=prepareVideoImportUpdate(board,node.id,'attempt-1',{nativeProjectId:'library-1',nativeAssetId:'asset-1',poster:newPoster});
  assert.equal(improved.valid,true);assert.equal(improved.board?.nodes[0].data.poster,newPoster);
});

test('a new native asset can replace its poster and cannot keep the previous asset cached video',()=>{
  const {board,node}=fixture();
  node.data.nativeProjectId='library-1';node.data.nativeAssetId='asset-1';node.data.mediaId='old-copy';node.data.poster='data:image/png;base64,iVBORw0KGgo=';
  const replacement=prepareVideoImportUpdate(board,node.id,'attempt-1',{nativeProjectId:'library-1',nativeAssetId:'asset-2',url:'media://library-1/media/asset-2.mp4',poster:'media://library-1/posters/asset-2.png'});
  assert.equal(replacement.valid,true);assert.ok(replacement.board);
  assert.equal(replacement.board.nodes[0].data.mediaId,undefined);
  assert.equal(replacement.board.nodes[0].data.poster,'media://library-1/posters/asset-2.png');
  assert.equal(replacement.board.nodes[0].data.nativeAssetId,'asset-2');
});

test('legacy raw poster is promoted once while already cached cards need no restoration or save',()=>{
  const {board,node}=fixture();
  node.data.nativeProjectId='library-1';node.data.nativeAssetId='asset-1';node.data.mediaId='saved-copy';
  node.data.url='media://library-1/media/asset-1.mp4';node.data.poster='media://library-1/posters/asset-1.jpg';
  assert.equal(needsImportPosterRestore(node.data),true);
  assert.equal(needsImportPosterRestore({...node.data,mediaId:undefined}),false);
  assert.equal(needsImportPosterRestore({...node.data,nativeAssetId:undefined}),false);
  const poster='data:image/png;base64,iVBORw0KGgo=';
  const restored=prepareVideoImportUpdate(board,node.id,'attempt-1',{poster},{updatedAt:node.data.videoImport!.updatedAt});
  assert.equal(restored.valid,true);assert.ok(restored.board);
  const cached=restored.board.nodes[0].data;
  assert.equal(cached.mediaId,'saved-copy');assert.equal(cached.videoImport?.updatedAt,node.data.videoImport?.updatedAt);
  assert.equal(needsImportPosterRestore(cached),false);
  const reopened=prepareVideoImportUpdate(restored.board,node.id,'attempt-1',{nativeProjectId:'library-1',nativeAssetId:'asset-1',poster:node.data.poster});
  assert.equal(reopened.valid,true);assert.equal(reopened.board,undefined);
});

test('completed task replay cannot replace manually corrected text after reopening the same asset',()=>{
  const {board,node}=fixture();
  node.data.nativeProjectId='library-1';node.data.nativeAssetId='asset-1';
  node.data.transcript=[{id:'line-1',start:0,end:2,text:'我校对后的原句',originalText:'自动识别原句'}];node.data.transcriptRevision='manual-1';
  const reopened=validateBoard(JSON.parse(JSON.stringify(board)));
  const completed=prepareVideoImportUpdate(reopened,node.id,'attempt-1',{nativeProjectId:'library-1',nativeAssetId:'asset-1',transcript:[{id:'native-line-1',start:0,end:2,text:'自动识别原句'}]},{status:'completed',progress:100,message:'已完成'});
  assert.equal(completed.valid,true);assert.ok(completed.board);
  assert.deepEqual(completed.board.nodes[0].data.transcript,node.data.transcript);
  assert.equal(completed.board.nodes[0].data.transcriptRevision,'manual-1');
  assert.equal(prepareVideoImportUpdate(completed.board,node.id,'attempt-1',{transcript:[{id:'native-line-1',start:0,end:2,text:'又迟到的自动结果'}]},{status:'completed',progress:100,message:'已完成'}).board,undefined);
  const replacement=prepareVideoImportUpdate(completed.board,node.id,'attempt-1',{nativeProjectId:'library-1',nativeAssetId:'asset-2'});
  assert.ok(replacement.board);assert.deepEqual(replacement.board.nodes[0].data.transcript,[]);assert.equal(replacement.board.nodes[0].data.transcriptRevision,undefined);
});

test('explicit subtitle replacement addresses the captured board, asset and revision and survives old task replay',()=>{
  const {board,node}=fixture();node.data.nativeProjectId='library-1';node.data.nativeAssetId='asset-1';node.data.videoImport!.status='completed';
  const target={boardId:board.id,nodeId:node.id,asset:JSON.stringify(['library-1','asset-1']),revision:'initial'};
  const lines=[{id:'new-1',start:1,end:3,text:'新导入的完整字幕'}];
  const next=prepareTranscriptReplacement(board,target,lines);
  assert.deepEqual(next.nodes[0].data.transcript,lines);assert.ok(next.nodes[0].data.transcriptRevision);
  assert.equal(node.data.transcriptRevision,undefined);assert.deepEqual(board.nodes[0].data.transcript,[]);
  const replay=prepareVideoImportUpdate(next,node.id,'attempt-1',{nativeProjectId:'library-1',nativeAssetId:'asset-1',transcript:[{id:'old-1',start:0,end:2,text:'旧任务字幕'}]});
  assert.equal(replay.valid,true);assert.equal(replay.board,undefined);
  assert.throws(()=>prepareTranscriptReplacement({...board,id:'different-board'},target,lines),/画布或视频/);
  assert.throws(()=>prepareTranscriptReplacement(next,target,lines),/期间修改/);
  const swapped={...board,nodes:[{...node,data:{...node.data,nativeAssetId:'asset-2'}}]};
  assert.throws(()=>prepareTranscriptReplacement(swapped,target,lines),/素材已更换/);
  const pending={...board,nodes:[{...node,data:{...node.data,videoImport:{...node.data.videoImport!,status:'transcribing' as const}}}]};
  assert.throws(()=>prepareTranscriptReplacement(pending,target,lines),/自动提取/);
});
