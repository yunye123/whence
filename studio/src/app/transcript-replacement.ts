import type { Board, BoardNode, CardData, TranscriptLine } from '../model';
import { validateBoard } from '../storage';
import { replaceTranscript, transcriptRevision } from '../transcript-tools';
import { mergePastedVideoMedia } from '../media-source';
import { pendingImport } from './video-links';

export function videoIdentity(data:CardData):string {
  return data.nativeProjectId&&data.nativeAssetId?JSON.stringify([data.nativeProjectId,data.nativeAssetId]):data.mediaId??data.url??'';
}
export interface TranscriptReplacementTarget { boardId:string; nodeId:string; asset:string; revision:string }
export function transcriptTarget(board:Board,node:BoardNode):TranscriptReplacementTarget {
  return {boardId:board.id,nodeId:node.id,asset:videoIdentity(node.data),revision:transcriptRevision(node.data)};
}
/** An asynchronous manual replacement belongs to its captured board, asset and revision. */
export function prepareTranscriptReplacement(board:Board,target:TranscriptReplacementTarget,lines:TranscriptLine[],media?:Partial<CardData>):Board {
  const node=board.nodes.find(item=>item.id===target.nodeId);
  if(board.id!==target.boardId||!node)throw new Error('来源画布或视频已移除，本次字幕未覆盖其他卡片。');
  if(videoIdentity(node.data)!==target.asset)throw new Error('视频素材已更换，请对新素材重新导入字幕。');
  if(transcriptRevision(node.data)!==target.revision)throw new Error('逐字稿已在处理期间修改，请检查当前版本后再替换。');
  if(pendingImport(node.data.videoImport?.status))throw new Error('这条视频正在自动提取，请先取消后替换逐字稿。');
  const patch=replaceTranscript(node.data,lines);
  const next={...board,nodes:board.nodes.map(item=>item.id===node.id?{...item,data:media?mergePastedVideoMedia({...item.data,...patch},media):{...item.data,...patch}}:item)};
  validateBoard(next);
  return next;
}
