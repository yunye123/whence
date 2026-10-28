import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { CardData, VideoImportState, Workspace } from '../model';
import { uid } from '../model';
import { mergeXVideoSource } from '../x-video-source-merge';
import { copyNativeCardMedia } from '../native';
import { importVideoLink, isVideoImportAvailable, listVideoImports, subscribeVideoImports, cancelVideoImport as cancelNativeVideoImport, retryVideoImport as retryNativeVideoImport, type VideoImportTask } from '../video-import';
import type { ToastOptions } from '../shell/Toasts';
import { pendingImport, importStageStatus } from './video-links';
import { differentNativeAsset, keepCachedImportMedia, needsImportPosterRestore, placeImageNote, prepareVideoImportUpdate } from './import-merge';
import { toolGapToast } from './transcription-gap';
import { clone, errorMessage } from './utils';
import { translateFreshAttempt } from './fresh-translation';

type Notify=(message:string,options?:ToastOptions)=>void;

/**
 * Video link imports that run in the background (desktop): each task addresses its original board and card, never
 * enters undo history, and follows the native task list. CORE-32: moved out of App.tsx unchanged.
 */
export function useVideoTasks({workspaceRef,readOnlyRef,notify,setNext,persist,saveVersion}:{
  workspaceRef:RefObject<Workspace|null>;
  readOnlyRef:RefObject<boolean>;
  notify:Notify;
  setNext:(next:Workspace)=>void;
  persist:(value:Workspace,version:number,silent?:boolean)=>Promise<void>;
  saveVersion:RefObject<number>;
}) {
  const [videoActionIds,setVideoActionIds]=useState<string[]>([]);
  const videoActions=useRef(new Set<string>());
  const videoRuns=useRef(new Map<string,{boardId:string;attemptId:string;controller:AbortController}>());
  const pendingVideoSubmissions=useRef(new Set<string>());
  const nativeTasks=useRef(new Map<string,VideoImportTask>());
  const expectedAttempts=useRef(new Map<string,number>());
  const rejectedNativeResults=useRef(new Map<string,string>());
  const restoredNativePosters=useRef(new Map<string,Promise<Partial<CardData>>>());
  const recoveredImports=useRef(false);
  const placedNotes=useRef(new Set<string>());
  const placeNote=useCallback((task:VideoImportTask)=>{
    if(task.card?.kind!=='note'||importStageStatus(task.status)!=='completed')return;
    const key=`${task.id}:${task.attempt}`;
    if(placedNotes.current.has(key))return;
    const current=workspaceRef.current;const board=current?.boards.find(item=>item.id===task.boardId);
    if(!current||!board)return;
    const result=placeImageNote(board,task.nodeId,task.card,task.companions);
    if(!result.valid){notify(result.error||'图文笔记没有放进画布');return;}
    placedNotes.current.add(key);
    if(!result.board)return;
    setNext({...current,boards:current.boards.map(item=>item.id===board.id?result.board!:item)});
    notify('图文笔记已放进画布');
  },[notify,setNext]);
  // Background imports always address their original board and card. They never enter undo history.
  const updateImportCard=useCallback((boardId:string,nodeId:string,attemptId:string,material:Partial<CardData>={},taskPatch:Partial<VideoImportState>={})=>{
    const current=workspaceRef.current;if(!current||readOnlyRef.current)return false;
    const target=current.boards.find(item=>item.id===boardId);if(!target)return false;
    const result=prepareVideoImportUpdate(target,nodeId,attemptId,material,taskPatch);
    if(!result.board)return result.valid;
    if(result.error)notify(result.error);
    setNext({...current,boards:current.boards.map(item=>item.id===boardId?result.board!:item)});return result.valid;
  },[notify,setNext]);
  const applyNativeImport=useCallback((task:VideoImportTask)=>{
    if(task.card?.kind==='note'&&importStageStatus(task.status)==='completed'){placeNote(task);return;}
    if(task.attempt<(expectedAttempts.current.get(task.id)??0))return;
    expectedAttempts.current.set(task.id,task.attempt);nativeTasks.current.set(task.id,task);
    const revision=JSON.stringify([task.attempt,task.updatedAt,task.card?.mediaId,task.card?.poster,task.card?.nativeMediaWarning,task.card?.sourceOriginalText,task.card?.sourceStatus]);
    if(rejectedNativeResults.current.get(task.id)===revision)return;
    const target=workspaceRef.current?.boards.find(item=>item.id===task.boardId);const node=target?.nodes.find(item=>item.id===task.nodeId);
    if(!node?.data.videoImport)return;
    if(node.data.nativeImportJobId&&node.data.nativeImportJobId!==task.id)return;
    const activeRun=videoRuns.current.get(node.id);
    if(!node.data.nativeImportJobId&&(!activeRun||activeRun.attemptId!==node.data.videoImport.attemptId))return;
    const wasCompleted=node.data.videoImport.status==='completed';
    const materialChanged=!node.data.videoImport.mediaReady||(task.status==='completed'&&!wasCompleted)||differentNativeAsset(node.data,task.card??{});
    const lateMedia:Partial<CardData>={};
    for(const key of ['mediaId','poster','nativeMediaWarning'] as const){const value=task.card?.[key];if(value!==undefined&&value!==node.data[key]&&!keepCachedImportMedia(node.data,task.card??{},key))lateMedia[key]=value as string;}
    const accepted=updateImportCard(task.boardId,task.nodeId,node.data.videoImport.attemptId,{...(materialChanged?task.card:{}),...lateMedia,...mergeXVideoSource(node,task.card??{}),sourceUrl:task.card?.sourceUrl??node.data.sourceUrl,nativeImportJobId:task.id},{
      status:importStageStatus(task.status),progress:Number.isFinite(task.progress)?Math.max(0,Math.min(100,task.progress)):undefined,
      message:task.message.slice(0,4096),error:task.error?.slice(0,4096),mediaReady:node.data.videoImport.mediaReady||!!(task.card?.url||task.card?.mediaId),updatedAt:task.updatedAt,
    });
    if(!accepted)rejectedNativeResults.current.set(task.id,revision);
    else if(!wasCompleted&&importStageStatus(task.status)==='completed')translateFreshAttempt(task.boardId,task.nodeId,node.data.videoImport.attemptId);
  },[notify,placeNote,setNext,updateImportCard]);
  const setVideoAction=useCallback((id:string,pending:boolean)=>{if(pending)videoActions.current.add(id);else videoActions.current.delete(id);setVideoActionIds([...videoActions.current]);},[]);
  const launchVideoImport=useCallback((boardId:string,nodeId:string,attemptId:string)=>{
    const node=workspaceRef.current?.boards.find(item=>item.id===boardId)?.nodes.find(item=>item.id===nodeId);
    if(!node?.data.videoImport||node.data.videoImport.attemptId!==attemptId||!pendingImport(node.data.videoImport.status))return;
    const task=node.data.videoImport;const controller=new AbortController();
    videoRuns.current.set(nodeId,{boardId,attemptId,controller});
    void importVideoLink({url:task.url,originalText:task.originalText,boardId,nodeId,existingNode:task.mediaReady?clone(node):undefined},{
      signal:controller.signal,
      onProgress:event=>{
        if(event.attempt<(expectedAttempts.current.get(event.jobId)??0))return;
        expectedAttempts.current.set(event.jobId,event.attempt);
        updateImportCard(boardId,nodeId,attemptId,{nativeImportJobId:event.jobId},{status:importStageStatus(event.stage),progress:Number.isFinite(event.progress)?Math.max(0,Math.min(100,event.progress)):undefined,message:event.message.slice(0,4096),...(event.stage==='media-ready'?{mediaReady:true}:{})});
      },
      onMediaReady:patch=>{if(patch.kind==='note')return;updateImportCard(boardId,nodeId,attemptId,patch,{mediaReady:true,status:'transcribing',message:'视频已就绪，正在提取逐字稿'});},
      onComplete:task=>{if(task.card?.kind==='note')placeNote(task);},
    }).then(patch=>{
      if(patch.kind==='note')return;
      const saved=updateImportCard(boardId,nodeId,attemptId,patch,{mediaReady:true,status:'completed',progress:100,message:patch.transcript?.length?`逐字稿已就绪，共 ${patch.transcript.length} 句`:'视频已就绪',error:undefined});
      if(saved){notify('视频已加入原画布，可播放与阅读逐字稿');translateFreshAttempt(boardId,nodeId,attemptId);}
    }).catch(error=>{
      const cancelled=controller.signal.aborted||(error instanceof Error&&error.name==='AbortError');
      const detail=errorMessage(error).slice(0,4096);
      const toast=!cancelled?toolGapToast(detail,`tool-gap:${nodeId}`):null;
      updateImportCard(boardId,nodeId,attemptId,{},cancelled?{status:'cancelled',message:'已取消，下载好的视频会保留',error:undefined}:toast?{status:'failed',message:detail,error:detail}:{status:'failed',message:'导入未完成，可重试',error:detail});
      if(toast)notify(detail,toast);
    }).finally(()=>{if(videoRuns.current.get(nodeId)?.attemptId===attemptId)videoRuns.current.delete(nodeId);});
  },[notify,placeNote,updateImportCard]);
  const cancelVideoImportAction=useCallback((id:string)=>{
    if(videoActions.current.has(id)||readOnlyRef.current)return;
    const target=workspaceRef.current?.boards.find(item=>item.nodes.some(node=>node.id===id));const node=target?.nodes.find(item=>item.id===id);const task=node?.data.videoImport;
    if(!target||!node||!task||!pendingImport(task.status))return;
    setVideoAction(id,true);updateImportCard(target.id,id,task.attemptId,{}, {message:'正在取消，请稍候…'});
    void (async()=>{
      try{
        if(node.data.nativeImportJobId){
          const result=await cancelNativeVideoImport(node.data.nativeImportJobId,expectedAttempts.current.get(node.data.nativeImportJobId));applyNativeImport(result);
          if(result.status!=='cancelled'){if(result.status==='completed')notify('这个视频任务刚刚完成。');return;}
        }
        videoRuns.current.get(id)?.controller.abort();
        updateImportCard(target.id,id,task.attemptId,{}, {status:'cancelled',message:task.mediaReady?'逐字稿提取已取消，视频仍可播放':'已取消，可随时重试',error:undefined});
      }catch(error){updateImportCard(target.id,id,task.attemptId,{}, {message:'取消未完成，可再次尝试',error:errorMessage(error).slice(0,4096)});notify(`取消未完成：${errorMessage(error)}`);}
      finally{setVideoAction(id,false);}
    })();
  },[applyNativeImport,notify,setVideoAction,updateImportCard]);
  const retryVideoImportAction=useCallback((id:string)=>{
    if(videoActions.current.has(id)||readOnlyRef.current)return;
    const target=workspaceRef.current?.boards.find(item=>item.nodes.some(node=>node.id===id));const node=target?.nodes.find(item=>item.id===id);const task=node?.data.videoImport;
    if(!target||!node||!task||pendingImport(task.status)||task.status==='completed')return;
    if(!isVideoImportAvailable()){notify('请使用来处桌面版继续下载或提取逐字稿。已下载的视频可以正常播放。');return;}
    const attemptId=uid();setVideoAction(id,true);
    const nativeId=node.data.nativeImportJobId;
    if(nativeId)expectedAttempts.current.set(nativeId,(nativeTasks.current.get(nativeId)?.attempt??expectedAttempts.current.get(nativeId)??0)+1);
    updateImportCard(target.id,id,task.attemptId,{}, {attemptId,status:'queued',message:task.mediaReady?'等待继续提取逐字稿':'等待重新下载',error:undefined,progress:0});
    void (async()=>{
      try{
        const current=workspaceRef.current;if(!current)return;await persist(current,saveVersion.current);
        const latest=workspaceRef.current?.boards.find(item=>item.id===target.id)?.nodes.find(item=>item.id===id);
        if(latest?.data.videoImport?.attemptId!==attemptId)return;
        if(nativeId)applyNativeImport(await retryNativeVideoImport(nativeId));else launchVideoImport(target.id,id,attemptId);
      }catch(error){updateImportCard(target.id,id,attemptId,{}, {status:'failed',message:'暂时无法重新开始',error:errorMessage(error).slice(0,4096)});notify(`重试未开始：${errorMessage(error)}`);}
      finally{setVideoAction(id,false);}
    })();
  },[applyNativeImport,launchVideoImport,notify,persist,setVideoAction,updateImportCard]);
  return {videoActionIds,videoActions,videoRuns,pendingVideoSubmissions,nativeTasks,expectedAttempts,restoredNativePosters,recoveredImports,updateImportCard,applyNativeImport,setVideoAction,launchVideoImport,cancelVideoImportAction,retryVideoImportAction};
}

/** Pick up the native task list once (interrupted tasks, late posters) and keep undo-restored task cards in step with it. */
export function useVideoTaskRecovery({video,workspace,workspaceRef,readOnlyRef,readOnly,notify}:{
  video:ReturnType<typeof useVideoTasks>;
  workspace:Workspace|null;
  workspaceRef:RefObject<Workspace|null>;
  readOnlyRef:RefObject<boolean>;
  readOnly:boolean;
  notify:Notify;
}) {
  const {videoActions,videoRuns,pendingVideoSubmissions,nativeTasks,restoredNativePosters,recoveredImports,updateImportCard,applyNativeImport}=video;
  const hasWorkspace=workspace!==null;
  useEffect(()=>{
    if(!hasWorkspace||readOnlyRef.current)return;
    let active=true;
    const markMissing=(tasks:VideoImportTask[])=>{
      const known=new Set(tasks.map(task=>task.id));
      for(const target of workspaceRef.current?.boards??[])for(const node of target.nodes){
        const task=node.data.videoImport;if(!task||!pendingImport(task.status)||videoRuns.current.has(node.id)||pendingVideoSubmissions.current.has(node.id)||videoActions.current.has(node.id))continue;
        if(node.data.nativeImportJobId&&known.has(node.data.nativeImportJobId))continue;
        updateImportCard(target.id,node.id,task.attemptId,{nativeImportJobId:undefined},{status:'interrupted',message:isVideoImportAvailable()?'上次导入已中断，可在原卡片继续':'请使用来处桌面版继续导入',error:undefined});
      }
    };
    if(!isVideoImportAvailable()){if(!recoveredImports.current){recoveredImports.current=true;markMissing([]);}return;}
    const off=subscribeVideoImports(task=>{if(active)applyNativeImport(task);});
    if(!recoveredImports.current){
      recoveredImports.current=true;
      void listVideoImports().then(tasks=>{
        if(!active)return;tasks.forEach(applyNativeImport);markMissing(tasks);
        // Earlier builds could save a native poster URL after the video itself was cached.
        // Repair only those existing cards; correct data posters and portable media remain untouched.
        for(const target of workspaceRef.current?.boards??[])for(const node of target.nodes){
          if(!needsImportPosterRestore(node.data))continue;
          const captured=node.data;const key=JSON.stringify([captured.nativeProjectId,captured.nativeAssetId]);
          let copy=restoredNativePosters.current.get(key);
          if(!copy){copy=copyNativeCardMedia({...captured});restoredNativePosters.current.set(key,copy);}
          void copy.then(patch=>{
            if(!active||typeof patch.poster!=='string'||!patch.poster.startsWith('data:image/'))return;
            const current=workspaceRef.current?.boards.find(item=>item.id===target.id)?.nodes.find(item=>item.id===node.id)?.data;
            if(!current||!needsImportPosterRestore(current)||current.nativeProjectId!==captured.nativeProjectId||current.nativeAssetId!==captured.nativeAssetId||current.poster!==captured.poster||current.videoImport?.attemptId!==captured.videoImport?.attemptId)return;
            updateImportCard(target.id,node.id,current.videoImport!.attemptId,{poster:patch.poster},{updatedAt:current.videoImport!.updatedAt});
          }).catch(error=>{if(active)notify(`本机封面暂未缓存，视频仍可播放：${errorMessage(error)}`);});
        }
      }).catch(error=>{if(active){recoveredImports.current=false;notify(`视频任务状态暂时无法读取：${errorMessage(error)}`);}});
    }
    return()=>{active=false;off();};
  },[applyNativeImport,hasWorkspace,notify,readOnly,updateImportCard]);
  useEffect(()=>{
    // Undo/redo restores user snapshots; bring any restored task card back to the actual background state.
    for(const target of workspace?.boards??[])for(const node of target.nodes){
      const state=node.data.videoImport;const nativeId=node.data.nativeImportJobId;if(!state||!nativeId)continue;
      const latest=nativeTasks.current.get(nativeId);if(!latest)continue;
      const pendingMedia=(['mediaId','poster','nativeMediaWarning'] as const).some(key=>latest.card?.[key]!==undefined&&latest.card[key]!==node.data[key]&&!keepCachedImportMedia(node.data,latest.card??{},key));
      const pendingSource=Object.keys(mergeXVideoSource(node,latest.card??{})).length>0;
      if(pendingMedia||pendingSource||state.status!==importStageStatus(latest.status)||(pendingImport(state.status)&&state.updatedAt!==latest.updatedAt))applyNativeImport(latest);
    }
  },[applyNativeImport,workspace]);
}
