import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../src/templates';
import { createNode } from '../src/board-utils';
import { prepareVideoImportUpdate } from '../src/App';
import { mergeXVideoSource } from '../src/x-video-source-merge';
import { prepareXImport, getXImportDuplicate } from '../src/x-import';
import type { XImportResult } from '../shared/x-import';

const url='https://x.com/akokoi1/status/2104200939095904322';
function fixture(){
  const board=createBoard('blank'),node=createNode('video');
  node.data={...node.data,body:'我的观看笔记',sourceUrl:url,sourceOriginalText:url,nativeProjectId:'p1',nativeAssetId:'a1',mediaId:'cached-video',transcript:[],videoImport:{attemptId:'attempt',url,originalText:url,status:'completed',message:'完成',mediaReady:true,createdAt:'2026-10-04T00:00:00Z',updatedAt:'2026-10-04T00:00:00Z'}};
  board.nodes=[node];return {board,node};
}
const capture={sourceUrl:url,sourceOriginalText:'公开原帖的实际正文',sourceAuthor:'WY · @akokoi1',sourceTitle:'原帖',sourceStatus:'已保存完整原帖正文；由公开内容服务获取。'};

test('completed legacy video hydrates post text once without changing notes, cached media or empty ASR',()=>{
  const {board,node}=fixture();
  const result=prepareVideoImportUpdate(board,node.id,'attempt',capture);
  assert.ok(result.board);
  const data=result.board.nodes[0].data;
  assert.equal(data.sourceOriginalText,capture.sourceOriginalText);
  assert.equal(data.sourceAuthor,capture.sourceAuthor);
  assert.equal(data.body,node.data.body);assert.equal(data.mediaId,'cached-video');assert.deepEqual(data.transcript,[]);
  assert.equal(data.videoImport?.originalText,url);assert.equal(data.nativeAssetId,'a1');
  assert.equal(prepareVideoImportUpdate(result.board,node.id,'attempt',capture).board,undefined);
  assert.equal(prepareVideoImportUpdate(board,node.id,'stale',capture).board,undefined);
});

test('partial captures improve to full; late errors and alternate posts preserve the full snapshot',()=>{
  const {node}=fixture();node.data.sourceOriginalText='仅有开头';node.data.sourceStatus='仅取得原帖正文预览';
  const patch=mergeXVideoSource(node,capture);assert.equal(patch.sourceOriginalText,capture.sourceOriginalText);
  node.data={...node.data,...patch};
  assert.deepEqual(mergeXVideoSource(node,{sourceUrl:url,sourceStatus:'原帖正文尚未取得；网络错误。'}),{});
  assert.deepEqual(mergeXVideoSource(node,{...capture,sourceUrl:'https://x.com/user/status/1848831595014459513',sourceOriginalText:'另一条帖'}),{});
});

test('confirmed text-free post has a durable empty capture, while ordinary imports retain share provenance',()=>{
  const {board,node}=fixture();
  const result=prepareVideoImportUpdate(board,node.id,'attempt',{sourceUrl:url,sourceOriginalText:'',sourceStatus:'原帖没有文字正文；由公开内容服务获取。'});
  assert.ok(result.board);assert.equal(result.board.nodes[0].data.sourceOriginalText,'');
  const nonX={...node,data:{...node.data,sourceUrl:'https://example.com/video'}};
  assert.deepEqual(mergeXVideoSource(nonX,capture),{});
});

test('native post hydration preserves Article video ordinals so reimport starts no new downloads',async()=>{
  const {board}=fixture();board.nodes=[];
  const result:XImportResult={post:{id:'2104200939095904322',url,author:{name:'WY',handle:'akokoi1',url:'https://x.com/akokoi1'},text:'文章原文',title:'文章',contentKind:'article',completeness:'complete',provider:'fxtwitter',media:[{kind:'video',url:'https://video.twimg.com/first.mp4'},{kind:'video',url:'https://video.twimg.com/second.mp4'}],warnings:[]},images:[]};
  const first=await prepareXImport(result,board,{position:{x:0,y:0}});
  let current=first.board;
  for(const id of first.videoNodeIds){const node=current.nodes.find(item=>item.id===id)!;current=prepareVideoImportUpdate(current,id,node.data.videoImport!.attemptId,{...capture,sourceOriginalText:result.post.text}) .board??current;}
  assert.deepEqual(getXImportDuplicate(current,url).videoNumbers,[1,2]);
  const second=await prepareXImport(result,current,{position:{x:0,y:0}});
  assert.deepEqual(second.videoNodeIds,[]);assert.equal(second.duplicate,true);
});

test('ordinary video platforms still save source authors and titles through native completion',()=>{
  const {board,node}=fixture();const other='https://www.bilibili.com/video/BV1xx';
  node.data.sourceUrl=other;node.data.videoImport!.url=other;
  const next=prepareVideoImportUpdate(board,node.id,'attempt',{sourceAuthor:'原作者',sourceTitle:'平台原标题',sourceStatus:'原平台取得'});
  assert.ok(next.board);assert.equal(next.board.nodes[0].data.sourceAuthor,'原作者');assert.equal(next.board.nodes[0].data.sourceTitle,'平台原标题');assert.equal(next.board.nodes[0].data.sourceStatus,'原平台取得');assert.equal(next.board.nodes[0].data.body,'我的观看笔记');
});

test('an older genuine snapshot without a completeness label survives newer post edits',()=>{
  const {node}=fixture();node.data.sourceOriginalText='当时保存的真实原文';node.data.sourceStatus='文章视频 2；视频源：https://video.twimg.com/second.mp4';
  const patch=mergeXVideoSource(node,{...capture,sourceOriginalText:'原帖后来编辑的新文字'});
  assert.equal(patch.sourceOriginalText,undefined);assert.equal(patch.sourceStatus,undefined);
  assert.equal(node.data.sourceOriginalText,'当时保存的真实原文');
  const confirmation=mergeXVideoSource(node,{...capture,sourceOriginalText:node.data.sourceOriginalText});
  assert.equal(confirmation.sourceOriginalText,undefined);assert.match(confirmation.sourceStatus??'',/^文章视频 2；视频源：.*；已保存完整原帖正文/);
});

test('a cached source patch retains post identity through the native completion merge',()=>{
  const {board,node}=fixture();node.data.sourceOriginalText=capture.sourceOriginalText;
  const patch=mergeXVideoSource(node,capture);
  assert.equal(patch.sourceUrl,undefined);
  const next=prepareVideoImportUpdate(board,node.id,'attempt',{...patch,sourceUrl:node.data.sourceUrl});
  assert.ok(next.board);
  const updated=next.board.nodes[0].data;
  assert.equal(updated.sourceOriginalText,capture.sourceOriginalText);
  assert.equal(updated.sourceStatus,capture.sourceStatus);assert.equal(updated.sourceAuthor,capture.sourceAuthor);
  assert.equal(updated.body,node.data.body);assert.equal(updated.mediaId,node.data.mediaId);assert.deepEqual(updated.transcript,[]);
  assert.equal(prepareVideoImportUpdate(next.board,node.id,'attempt',{...patch,sourceUrl:node.data.sourceUrl}).board,undefined);
});

test('cached Article provenance is not duplicated when the protected patch passes through completion',()=>{
  const {board,node}=fixture();node.data.sourceOriginalText=capture.sourceOriginalText;
  const prefix='文章视频 2；视频源：https://video.twimg.com/second.mp4';
  node.data.sourceStatus=prefix;
  const patch=mergeXVideoSource(node,capture);
  const next=prepareVideoImportUpdate(board,node.id,'attempt',{...patch,sourceUrl:url});
  assert.ok(next.board);
  assert.equal(next.board.nodes[0].data.sourceStatus,`${prefix}；${capture.sourceStatus}`);
  assert.equal(next.board.nodes[0].data.body,node.data.body);
});
