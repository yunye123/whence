import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Node, ReactFlowInstance } from '@xyflow/react';
import type { Board, BoardNode, CardData, Workspace } from '../model';
import type { BoardActions } from '../board-context';
import { isSampleAsset } from '../templates';
import { DraftNavigationSession, type DraftSourceRequest } from '../draft-navigation';
import type { VideoPlaybackSession, VideoPlaybackSnapshot } from '../video-playback';
import type { TraceOrigin } from '../canvas/trace';
import type { useFieldTrace } from '../canvas/useFieldTrace';
import { preloadInspector } from '../shell/InspectorPanel';
import { preloadDraftEditor } from '../inspector/draft-editor/editor-loader';
import { dismissToast, getToasts, settlesOnCanvas, type ToastOptions } from '../shell/Toasts';
import type { CanvasRevealRequest, CanvasView } from './types';
import { errorMessage } from './utils';
import { focusPanelWhenReady, nodeSelector } from './studio-dom';

/**
 * Opening and closing a card’s panel, the way back to a source (FIELD trace, §6.17) and the draft round trip (C12):
 * open a source from a draft, return to the draft with its caret and viewport. CORE-32: moved out of App.tsx unchanged.
 */
export function useSourceNavigation({board,boardRef,workspaceRef,inspectedId,setInspectedId,selectedIdsRef,setSelectedIds,setSelectedEdgeIds,view,setView,setCanvasReveal,setImagePreviewToken,keyboardInput,flow,notify,fieldTrace,activeVideo,setActiveVideo,setVideoPlaybackVersion,playbackSession,playbackRequest,getVideoPlayback,playVideo}:{
  board:Board|null;
  boardRef:RefObject<Board|null>;
  workspaceRef:RefObject<Workspace|null>;
  inspectedId:string|null;
  setInspectedId:Dispatch<SetStateAction<string|null>>;
  selectedIdsRef:RefObject<string[]>;
  setSelectedIds:Dispatch<SetStateAction<string[]>>;
  setSelectedEdgeIds:Dispatch<SetStateAction<string[]>>;
  view:CanvasView;
  setView:Dispatch<SetStateAction<CanvasView>>;
  setCanvasReveal:Dispatch<SetStateAction<CanvasRevealRequest|null>>;
  setImagePreviewToken:Dispatch<SetStateAction<number>>;
  keyboardInput:RefObject<boolean>;
  flow:ReactFlowInstance<Node<CardData>>;
  notify:(message:string,options?:ToastOptions)=>void;
  fieldTrace:ReturnType<typeof useFieldTrace>;
  activeVideo:string|null;
  setActiveVideo:Dispatch<SetStateAction<string|null>>;
  setVideoPlaybackVersion:Dispatch<SetStateAction<number>>;
  playbackSession:RefObject<VideoPlaybackSession>;
  playbackRequest:RefObject<number>;
  getVideoPlayback:(id:string)=>VideoPlaybackSnapshot;
  playVideo:(id:string|null,time?:number)=>void;
}) {
  const draftNavigation=useRef(new DraftNavigationSession());
  const [draftNavigationVersion,setDraftNavigationVersion]=useState(0);
  const [sourceTextReveal,setSourceTextReveal]=useState<BoardActions['sourceTextReveal']>(null);
  const sourceTextToken=useRef(0);
  const draftReturn=useMemo(()=>board?draftNavigation.current.info(board):null,[board,draftNavigationVersion]);
  const draftRestore=useMemo(()=>board?draftNavigation.current.restoreInfo(board):null,[board,draftNavigationVersion]);
  const closeInspectorRef=useRef<()=>void>(()=>{});
  const clearDraftNavigation=useCallback(()=>{draftNavigation.current.clear();setSourceTextReveal(null);setDraftNavigationVersion(value=>value+1);},[]);
  // Shared inspection changes preserve media ownership; only public independent opens discard a return point.
  // `known`: a card created in this same event, before boardRef has caught up with the commit (FV-M2).
  const showCard=useCallback((id:string,known?:BoardNode)=>{
    const node=known?.id===id?known:boardRef.current?.nodes.find(item=>item.id===id);
    if(!node)return;
    // Example films shipped under /assets/samples/ play like any film; older demo cards only open their details.
    const opensPlayer=node?.data.kind==='video'&&(!node.data.demo||isSampleAsset(node.data.url));
    const changesPlayer=opensPlayer?(inspectedId!==id||activeVideo!==id):!!activeVideo&&inspectedId===activeVideo;
    if(changesPlayer){
      playbackRequest.current++;playbackSession.current.handoff();
      // The watch page is opening for this film: its playing intent waits for the (lazy) panel instead of settling (FV-M4).
      if(opensPlayer)playbackSession.current.expect(JSON.stringify([boardRef.current?.id,id]));
      setVideoPlaybackVersion(value=>value+1);
    }
    setInspectedId(id);setSelectedIds([id]);
    if(opensPlayer){
      setActiveVideo(id);
      // An import result (“已导入 1 个素材 [查看]”) is about the canvas: the watching workbench covering it takes it down
      // instead of leaving it over the notes and tags (fix-panels round 4 §2.2).
      for(const item of getToasts())if(!item.leaving&&item.tone!=='error'&&(item.settle??settlesOnCanvas(item.message)))dismissToast(item.id);
    }
  },[activeVideo,inspectedId]);
  const openCard=useCallback((id:string)=>{
    const current=boardRef.current;const node=current?.nodes.find(node=>node.id===id);if(!node||!current)return;
    playbackRequest.current++;clearDraftNavigation();showCard(id);
    // PS-M1: once the panel has narrowed the canvas, the opened card moves into the remaining visible area.
    setCanvasReveal({boardId:current.id,ids:[id],instant:false,whenInspected:id});
    if(node.data.kind==='image')setImagePreviewToken(value=>value+1);
    else if(keyboardInput.current&&node.data.kind!=='video')focusPanelWhenReady();
  },[clearDraftNavigation,showCard]);
  const closeInspector=useCallback(()=>{
    const closing=inspectedId;
    setCanvasReveal(current=>current?.whenInspected?null:current);playbackRequest.current++;clearDraftNavigation();
    // CORE-10: only a film that is playing continues on its card; a paused or never-played one goes back to its poster
    // (the position is kept, the next play resumes there) instead of leaving a bare native player on the canvas.
    if(activeVideo&&inspectedId===activeVideo){playbackRequest.current++;playbackSession.current.handoff();if(getVideoPlayback(activeVideo).paused)setActiveVideo(null);setVideoPlaybackVersion(value=>value+1);}
    setInspectedId(null);
    // KB-M1: focus returns to the card on the canvas instead of falling to <body>.
    // CORE-19: the card may have left the DOM (virtualised after the camera followed a new excerpt): then the selected
    // card (that excerpt), else the canvas itself.
    if(closing)requestAnimationFrame(()=>{const active=document.activeElement;if(active&&active!==document.body&&active.isConnected)return;const selected=selectedIdsRef.current.map(id=>document.querySelector<HTMLElement>(nodeSelector(id))).find(Boolean);(document.querySelector<HTMLElement>(nodeSelector(closing))??selected??document.querySelector<HTMLElement>('.canvas-shell'))?.focus({preventScroll:true});});
  },[activeVideo,clearDraftNavigation,getVideoPlayback,inspectedId]);
  closeInspectorRef.current=closeInspector;
  const focusSource=useCallback((id:string,time?:number,keepDraftReturn=false,quoteNodeId?:string,origin?:TraceOrigin,quoteText?:string)=>{
    const n=boardRef.current?.nodes.find(n=>n.id===id);if(!n){notify('来源卡片已被移除，摘录原文仍保留。可撤销删除来恢复来源。');return;}
    const quote=quoteNodeId?boardRef.current?.nodes.find(node=>node.id===quoteNodeId):undefined;
    if(quoteNodeId&&(!quote||quote.data.kind!=='quote'||quote.data.citation?.nodeId!==id)){notify('这条摘录与来源不一致，请重新打开原摘录。');return;}
    if(!keepDraftReturn)clearDraftNavigation();
    // FV-M4: a film opens on the watch page at the excerpt's second; the card stops first, so the trace never plays
    // (or, scrolling the card back into view, restarts) the old part on the way there.
    if(n.data.kind==='video'&&activeVideo&&inspectedId!==activeVideo)playbackSession.current.stop();
    // FIELD trace (§6.17): light walks the thread back to the source, then the source opens. A hidden canvas, a
    // missing thread or a plain jump (search) opens at once; any new input skips to the end state.
    const boardId=boardRef.current?.id;
    void preloadInspector().catch(()=>{});
    // A search hit on a draft opens its writing panel: the editor chunk starts during the trace (CORE-32).
    if(n.data.kind==='draft')void preloadDraftEditor().catch(()=>{});
    fieldTrace.toSource({sourceId:id,quoteId:quoteNodeId,...origin},()=>{
      const current=boardRef.current;
      if(!current||current.id!==boardId||!current.nodes.some(node=>node.id===id))return;
      setView('canvas');showCard(id);playVideo(n.data.kind==='video'?id:null,time??0);
      // A search hit (CORE-05) opens the reading view at the matched sentence, marked like a located excerpt.
      const isText=n.data.kind==='note'||n.data.kind==='link';
      setSourceTextReveal(isText&&quoteNodeId?{nodeId:id,quoteNodeId,token:++sourceTextToken.current}:isText&&quoteText?{nodeId:id,quoteText,token:++sourceTextToken.current}:null);
      setCanvasReveal({boardId:current.id,ids:[id],instant:!!draftNavigation.current.info(current),whenInspected:id});
    });
  },[activeVideo,clearDraftNavigation,fieldTrace,inspectedId,notify,playVideo,showCard]);
  const openDraftSource=useCallback((request:DraftSourceRequest)=>{
    const current=workspaceRef.current;const target=current?.boards.find(item=>item.id===current.activeBoardId);
    if(!target||inspectedId!==request.draftId){notify('请先打开要回查来源的文稿。');return false;}
    try{
      const destination=draftNavigation.current.open(target,request,view,flow.getViewport());
      setDraftNavigationVersion(value=>value+1);
      focusSource(destination.nodeId,destination.time,true,destination.quoteNodeId,{draftId:request.draftId});
      return true;
    }catch(error){notify(errorMessage(error));return false;}
  },[flow,focusSource,inspectedId,notify,view]);
  const returnToDraft=useCallback(()=>{
    const current=workspaceRef.current;const target=current?.boards.find(item=>item.id===current.activeBoardId);
    if(!target)return false;
    const destination=draftNavigation.current.returnToDraft(target);
    setDraftNavigationVersion(value=>value+1);
    if(!destination){notify('原文稿已不在当前画布，无法返回。');return false;}
    // Invalidate a pending native connection even before it has mounted a player.
    setCanvasReveal(null);setSourceTextReveal(null);playbackRequest.current++;setView(destination.view);showCard(destination.draftId);setSelectedEdgeIds([]);
    // A zero-duration transform interrupts any outstanding source-fit animation.
    void flow.setViewport(destination.viewport,{duration:0});
    return true;
  },[flow,notify,showCard]);
  const completeDraftRestore=useCallback((token:number)=>{
    draftNavigation.current.complete(token);setDraftNavigationVersion(value=>value+1);
  },[]);
  const completeSourceTextReveal=useCallback((token:number)=>setSourceTextReveal(previous=>previous?.token===token?null:previous),[]);
  useEffect(()=>{
    draftNavigation.current.reconcile(board);
    if(board&&draftNavigation.current.info(board)&&(!inspectedId||!board.nodes.some(node=>node.id===inspectedId)))returnToDraft();
  },[board,inspectedId,returnToDraft]);
  return {draftNavigation,draftReturn,draftRestore,clearDraftNavigation,sourceTextReveal,showCard,openCard,closeInspector,closeInspectorRef,focusSource,openDraftSource,returnToDraft,completeDraftRestore,completeSourceTextReveal};
}
