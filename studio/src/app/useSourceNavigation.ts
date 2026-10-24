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
import { closeDraft as closeDraftSlots, dismissEscape, emptyPanels, escapeCloses, placeOpenedCard, releaseIds, type PanelSlots } from './panel-slots';

/**
 * Opening and closing card panels. A draft, once opened, stays pinned on the right until its own close.
 * Notes, excerpts, pictures and links replace only the left column. A video covers the window and leaves
 * both columns mounted. The way back to a source (FIELD trace) and a video trip from a draft still restore
 * the caret; opening a note from a draft does not unmount the draft.
 */
export function useSourceNavigation({board,boardRef,workspaceRef,selectedIdsRef,setSelectedIds,setSelectedEdgeIds,view,setView,setCanvasReveal,setImagePreviewToken,keyboardInput,flow,notify,fieldTrace,activeVideo,setActiveVideo,setVideoPlaybackVersion,playbackSession,playbackRequest,getVideoPlayback,playVideo}:{
  board:Board|null;
  boardRef:RefObject<Board|null>;
  workspaceRef:RefObject<Workspace|null>;
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
  const tripSource=useRef<string|null>(null);
  const [slots,setSlots]=useState<PanelSlots>(emptyPanels);
  const slotsRef=useRef(slots);
  slotsRef.current=slots;
  const draftReturn=useMemo(()=>board?draftNavigation.current.info(board):null,[board,draftNavigationVersion]);
  const draftRestore=useMemo(()=>board?draftNavigation.current.restoreInfo(board):null,[board,draftNavigationVersion]);
  const closeInspectorRef=useRef<()=>void>(()=>{});
  const pinnedId=slots.pinned;
  const companionId=slots.companion;
  const soloId=slots.solo;
  const watchId=slots.watch;
  const focusedId=slots.focused;
  /** The card the canvas treats as open: the watch page, otherwise the card just focused. */
  const inspectedId=slots.watch??slots.focused;
  const panelDismissable=escapeCloses(slots);
  const commitSlots=useCallback((next:PanelSlots)=>{slotsRef.current=next;setSlots(next);},[]);
  const clearDraftNavigation=useCallback(()=>{tripSource.current=null;draftNavigation.current.clear();setSourceTextReveal(null);setDraftNavigationVersion(value=>value+1);},[]);
  const returnFocus=useCallback((closing:string|null)=>{
    if(!closing)return;
    requestAnimationFrame(()=>{
      const active=document.activeElement;
      if(active&&active!==document.body&&active.isConnected)return;
      const selected=selectedIdsRef.current.map(id=>document.querySelector<HTMLElement>(nodeSelector(id))).find(Boolean);
      (document.querySelector<HTMLElement>(nodeSelector(closing))??selected??document.querySelector<HTMLElement>('.canvas-shell'))?.focus({preventScroll:true});
    });
  },[selectedIdsRef]);
  const releaseVideo=(id:string|null)=>{
    if(!id||activeVideo!==id)return;
    playbackRequest.current++;playbackSession.current.handoff();
    if(getVideoPlayback(id).paused)setActiveVideo(null);
    setVideoPlaybackVersion(value=>value+1);
  };
  // `known`: a card created in this same event, before boardRef has caught up with the commit.
  const showCard=useCallback((id:string,known?:BoardNode,options?:{dismissWatch?:boolean})=>{
    const node=known?.id===id?known:boardRef.current?.nodes.find(item=>item.id===id);
    if(!node)return;
    const previous=slotsRef.current;
    const solo=previous.solo?boardRef.current?.nodes.find(item=>item.id===previous.solo):undefined;
    let next=placeOpenedCard(previous,{id,kind:node.data.kind},solo?.data.kind??null);
    const dismissWatch=!!options?.dismissWatch&&!!next.watch&&node.data.kind!=='video';
    if(dismissWatch)next={...next,watch:null,focused:id};
    const opensPlayer=node.data.kind==='video'&&(!node.data.demo||isSampleAsset(node.data.url));
    const showing=opensPlayer&&(next.watch===id||next.solo===id);
    const wasShowing=previous.watch===id||previous.solo===id;
    const videoStays=!!activeVideo&&(next.watch===activeVideo||next.solo===activeVideo);
    const changesPlayer=showing?(!wasShowing||activeVideo!==id):!!activeVideo&&!videoStays;
    if(changesPlayer){
      playbackRequest.current++;playbackSession.current.handoff();
      if(showing)playbackSession.current.expect(JSON.stringify([boardRef.current?.id,id]));
      setVideoPlaybackVersion(value=>value+1);
    }
    if(showing){
      setActiveVideo(id);
      for(const item of getToasts())if(!item.leaving&&item.tone!=='error'&&(item.settle??settlesOnCanvas(item.message)))dismissToast(item.id);
    }else if(activeVideo&&!videoStays&&(previous.watch===activeVideo||previous.solo===activeVideo)&&getVideoPlayback(activeVideo).paused)setActiveVideo(null);
    if(dismissWatch)clearDraftNavigation();
    commitSlots(next);setSelectedIds([id]);
  },[activeVideo,clearDraftNavigation,commitSlots,getVideoPlayback,setActiveVideo,setSelectedIds,setVideoPlaybackVersion]);
  const openCard=useCallback((id:string)=>{
    const current=boardRef.current;const node=current?.nodes.find(item=>item.id===id);if(!node||!current)return;
    // A video or a draft ends a trip. A note, excerpt, picture or link opened beside a draft does not.
    if(node.data.kind==='video'||node.data.kind==='draft'){playbackRequest.current++;clearDraftNavigation();}
    showCard(id);
    setCanvasReveal({boardId:current.id,ids:[id],instant:false,whenInspected:id});
    if(node.data.kind==='image')setImagePreviewToken(value=>value+1);
    else if(keyboardInput.current&&node.data.kind!=='video')focusPanelWhenReady();
  },[clearDraftNavigation,showCard]);
  /** Esc and the left column's close: watch page, otherwise the left column, otherwise a panel that is not a pinned draft. */
  const closeInspector=useCallback(()=>{
    const previous=slotsRef.current;
    const closing=previous.watch??previous.companion??previous.solo;
    if(!closing)return;
    const next=dismissEscape(previous);
    if(previous.watch&&!next.watch){setCanvasReveal(current=>current?.whenInspected?null:current);clearDraftNavigation();}
    releaseVideo(previous.watch===activeVideo&&next.watch!==activeVideo?activeVideo:previous.solo===activeVideo&&next.solo!==activeVideo?activeVideo:null);
    commitSlots(next);returnFocus(closing);
  },[activeVideo,clearDraftNavigation,commitSlots,returnFocus]);
  closeInspectorRef.current=closeInspector;
  const closeCompanion=useCallback(()=>{
    const previous=slotsRef.current;if(!previous.companion)return;
    const closing=previous.companion;
    commitSlots({...previous,companion:null,focused:previous.watch??previous.pinned??previous.solo});
    returnFocus(closing);
  },[commitSlots,returnFocus]);
  /** The draft's own close. A left-hand card becomes the single right-hand panel. */
  const closeDraft=useCallback(()=>{
    const previous=slotsRef.current;if(!previous.pinned)return;
    const closing=previous.pinned;
    // A watch page that was covering the draft becomes the single panel and keeps playing.
    const next=closeDraftSlots(previous);
    clearDraftNavigation();
    commitSlots(next);returnFocus(closing);
  },[clearDraftNavigation,commitSlots,returnFocus]);
  const closePanels=useCallback(()=>{
    const previous=slotsRef.current;
    commitSlots(emptyPanels());
    clearDraftNavigation();
    releaseVideo(previous.watch===activeVideo?activeVideo:previous.solo===activeVideo?activeVideo:null);
  },[activeVideo,clearDraftNavigation,commitSlots]);
  const releaseCards=useCallback((ids:string[])=>{
    const previous=slotsRef.current;
    const pinned=previous.pinned?boardRef.current?.nodes.find(node=>node.id===previous.pinned):undefined;
    const pinnedRemains=!!pinned&&pinned.data.kind==='draft'&&!ids.includes(pinned.id);
    commitSlots(releaseIds(previous,ids,pinnedRemains));
  },[commitSlots]);
  const focusSource=useCallback((id:string,time?:number,keepDraftReturn=false,quoteNodeId?:string,origin?:TraceOrigin,quoteText?:string)=>{
    const n=boardRef.current?.nodes.find(item=>item.id===id);if(!n){notify('来源卡片已被移除，摘录原文仍保留。可撤销删除来恢复来源。');return;}
    const quote=quoteNodeId?boardRef.current?.nodes.find(node=>node.id===quoteNodeId):undefined;
    if(quoteNodeId&&(!quote||quote.data.kind!=='quote'||quote.data.citation?.nodeId!==id)){notify('这条摘录与来源不一致，请重新打开原摘录。');return;}
    if(!keepDraftReturn)clearDraftNavigation();
    else if(n.data.kind==='video')tripSource.current=id;
    const visible=slotsRef.current.watch??slotsRef.current.focused;
    if(n.data.kind==='video'&&activeVideo&&visible!==activeVideo)playbackSession.current.stop();
    const boardId=boardRef.current?.id;
    void preloadInspector().catch(()=>{});
    if(n.data.kind==='draft')void preloadDraftEditor().catch(()=>{});
    fieldTrace.toSource({sourceId:id,quoteId:quoteNodeId,...origin},()=>{
      const current=boardRef.current;
      if(!current||current.id!==boardId||!current.nodes.some(node=>node.id===id))return;
      setView('canvas');showCard(id);playVideo(n.data.kind==='video'?id:null,time??0);
      const isText=n.data.kind==='note'||n.data.kind==='link';
      setSourceTextReveal(isText&&quoteNodeId?{nodeId:id,quoteNodeId,token:++sourceTextToken.current}:isText&&quoteText?{nodeId:id,quoteText,token:++sourceTextToken.current}:null);
      setCanvasReveal({boardId:current.id,ids:[id],instant:!!draftNavigation.current.info(current),whenInspected:id});
    });
  },[activeVideo,clearDraftNavigation,fieldTrace,notify,playVideo,showCard]);
  const openDraftSource=useCallback((request:DraftSourceRequest)=>{
    const current=workspaceRef.current;const target=current?.boards.find(item=>item.id===current.activeBoardId);
    const open=slotsRef.current;
    const draftOpen=open.pinned===request.draftId||open.focused===request.draftId;
    if(!target||!draftOpen){notify('请先打开要回查来源的文稿。');return false;}
    const source=target.nodes.find(node=>node.id===request.sourceId);
    // A film still takes the full watch page and keeps the trip. A note or link stays beside the draft, so the caret never leaves.
    if(source?.data.kind==='video'){
      try{
        const destination=draftNavigation.current.open(target,request,view,flow.getViewport());
        setDraftNavigationVersion(value=>value+1);
        focusSource(destination.nodeId,destination.time,true,destination.quoteNodeId,{draftId:request.draftId});
        return true;
      }catch(error){notify(errorMessage(error));return false;}
    }
    focusSource(request.sourceId,request.time,true,request.quoteNodeId);
    return true;
  },[flow,focusSource,notify,view]);
  const returnToDraft=useCallback(()=>{
    tripSource.current=null;
    const current=workspaceRef.current;const target=current?.boards.find(item=>item.id===current.activeBoardId);
    if(!target)return false;
    const destination=draftNavigation.current.returnToDraft(target);
    setDraftNavigationVersion(value=>value+1);
    if(!destination){notify('原文稿已不在当前画布，无法返回。');return false;}
    setCanvasReveal(null);setSourceTextReveal(null);playbackRequest.current++;setView(destination.view);showCard(destination.draftId);setSelectedEdgeIds([]);
    void flow.setViewport(destination.viewport,{duration:0});
    return true;
  },[flow,notify,showCard]);
  const completeDraftRestore=useCallback((token:number)=>{
    draftNavigation.current.complete(token);setDraftNavigationVersion(value=>value+1);
  },[]);
  const completeSourceTextReveal=useCallback((token:number)=>setSourceTextReveal(previous=>previous?.token===token?null:previous),[]);
  useEffect(()=>{
    draftNavigation.current.reconcile(board);
    const sourceId=tripSource.current;
    if(!board||!sourceId)return;
    if(!draftNavigation.current.info(board)){tripSource.current=null;return;}
    if(!board.nodes.some(node=>node.id===sourceId)){tripSource.current=null;returnToDraft();}
  },[board,returnToDraft]);
  return {draftNavigation,draftReturn,draftRestore,clearDraftNavigation,sourceTextReveal,showCard,openCard,closeInspector,closeInspectorRef,focusSource,openDraftSource,returnToDraft,completeDraftRestore,completeSourceTextReveal,inspectedId,focusedId,pinnedId,companionId,watchId,soloId,closeCompanion,closeDraft,closePanels,releaseCards,panelDismissable};
}
