import type { Board, CardData, VideoImportState } from '../model';
import { validateBoard } from '../storage';
import { mergeAutomaticTranscript } from '../transcript-tools';
import { mergeXVideoSource } from '../x-video-source-merge';
import { isXUrl, taskTitle } from './video-links';
import { errorMessage } from './utils';

export function differentNativeAsset(current:CardData,incoming:Partial<CardData>):boolean {
  return !!current.nativeProjectId&&!!current.nativeAssetId&&!!incoming.nativeProjectId&&!!incoming.nativeAssetId&&(current.nativeProjectId!==incoming.nativeProjectId||current.nativeAssetId!==incoming.nativeAssetId);
}
export function keepCachedImportMedia(current:CardData,incoming:Partial<CardData>,key:'mediaId'|'poster'|'nativeMediaWarning'):boolean {
  const sameAsset=!!current.nativeProjectId&&!!current.nativeAssetId&&(incoming.nativeProjectId??current.nativeProjectId)===current.nativeProjectId&&(incoming.nativeAssetId??current.nativeAssetId)===current.nativeAssetId;
  if(!sameAsset)return false;
  if(key==='mediaId')return !!current.mediaId;
  if(key==='poster')return !!current.poster?.startsWith('data:image/')&&!!incoming.poster?.startsWith('media:');
  return !!current.mediaId;
}
export function needsImportPosterRestore(data:CardData):boolean {
  return data.kind==='video'&&!!data.mediaId&&!!data.nativeProjectId&&!!data.nativeAssetId&&!!data.nativeImportJobId&&!!data.videoImport?.mediaReady&&!!data.url?.startsWith('media:')&&!!data.poster?.startsWith('media:');
}

/** A rejected native result becomes one visible failure, never a repeated save/render cycle. */
export function prepareVideoImportUpdate(target:Board,nodeId:string,attemptId:string,material:Partial<CardData>={},taskPatch:Partial<VideoImportState>={}):{board?:Board;valid:boolean;error?:string} {
  const node=target.nodes.find(item=>item.id===nodeId);
  if(!node?.data.videoImport||node.data.videoImport.attemptId!==attemptId)return {valid:false};
  const old=node.data.videoImport;
  const {body:_body,title:materialTitle,videoImport:_task,sourceUrl:_sourceUrl,sourceOriginalText:_sourceText,sourceStatus:_sourceStatus,sourceAuthor:_sourceAuthor,sourceTitle:_sourceTitle,sourceDescription:_sourceDescription,tags:_tags,...providedMedia}=material;
  let media:Partial<CardData>=Object.fromEntries(Object.entries(providedMedia).filter(([key,value])=>value!==undefined||key==='nativeImportJobId'));
  if(!isXUrl(old.url)){
    if(_sourceAuthor!==undefined)media.sourceAuthor=_sourceAuthor;
    if(_sourceTitle!==undefined)media.sourceTitle=_sourceTitle;
    if(_sourceStatus!==undefined)media.sourceStatus=_sourceStatus;
    if(_sourceDescription!==undefined)media.sourceDescription=_sourceDescription;
  }
  for(const key of ['mediaId','poster','nativeMediaWarning'] as const)if(keepCachedImportMedia(node.data,material,key))delete media[key];
  if(differentNativeAsset(node.data,material)){media.mediaId=material.mediaId;media.poster=material.poster;media.transcript=material.transcript;}
  const nextTask:VideoImportState={...old,...taskPatch,updatedAt:taskPatch.updatedAt??new Date().toISOString()};
  const title=materialTitle&&node.data.title===taskTitle(old.url)?materialTitle:node.data.title;
  let data:CardData=node.data;
  const comparable=(value:CardData)=>JSON.stringify({...value,videoImport:value.videoImport?{...value.videoImport,updatedAt:''}:undefined});
  const changed=()=>({...target,nodes:target.nodes.map(item=>item.id===nodeId?{...item,data}:item),updatedAt:new Date().toISOString()});
  try{
    media=mergeAutomaticTranscript(node.data,media,differentNativeAsset(node.data,material));
    data={...node.data,...media,...mergeXVideoSource(node,material),title,body:node.data.body,videoImport:nextTask};
    if(comparable(data)===comparable(node.data))return {valid:true};
    const next=changed();validateBoard(next);return {board:next,valid:true};
  }catch(error){
    const reason=`导入结果暂未保存：${errorMessage(error)}`;
    data={...node.data,videoImport:{...old,status:'failed',message:'请检查素材后重试',error:reason,updatedAt:new Date().toISOString()}};
    if(comparable(data)===comparable(node.data))return {valid:false};
    return {board:changed(),valid:false,error:reason};
  }
}
