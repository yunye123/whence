import { useCallback, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Board, BoardNode, CardData, CardKind, TranscriptLine, Workspace } from '../model';
import { STORAGE_LIMITS } from '../storage';
import { createNode, createQuoteBatch, duplicateNode } from '../board-utils';
import { citationLocationLabel, paragraphIndexAt } from '../source-location';
import { createTextQuoteBatch } from '../text-sources';
import { avoidCaptionObstacles, captionPlacementBounds, placeAtPointer, placeCards, placeInView } from '../card-placement';
import type { Rect } from '../canvas/safe-area';
import type { useFieldTrace } from '../canvas/useFieldTrace';
import type { VideoPlaybackSession } from '../video-playback';
import { cancelVideoImport as cancelNativeVideoImport, type VideoImportTask } from '../video-import';
import type { ToastOptions } from '../shell/Toasts';
import type { CanvasRevealRequest, CanvasView } from './types';
import { pendingImport } from './video-links';
import { errorMessage } from './utils';
import { EMPTY_IDS, beginNoteEdit, focusWhenReady } from './studio-dom';
import { preloadDraftEditor } from '../inspector/draft-editor/editor-loader';

/**
 * Making, changing and removing cards (CORE-32: moved out of App.tsx unchanged): a new card where §5.4 puts it, the
 * new-placement ring, excerpts from a film or a text (with their toast and precise undo), duplicate and delete.
 */
export function useCardCommands({boardRef,workspaceRef,readOnlyRef,measurements,measurementsRef,changeBoard,undoChange,notify,fieldTrace,visibleView,setSelectedIds,setSelectedEdgeIds,setView,setCanvasReveal,setContextMenu,inspectedId,setInspectedId,activeVideo,setActiveVideo,playbackRequest,playbackSession,clearDraftNavigation,showCard,closeInspectorRef,videoRuns,expectedAttempts,nativeTasks}:{
  boardRef:RefObject<Board|null>;
  workspaceRef:RefObject<Workspace|null>;
  readOnlyRef:RefObject<boolean>;
  measurements:Record<string,{width:number;height:number}>;
  measurementsRef:RefObject<Record<string,{width:number;height:number}>>;
  changeBoard:(fn:(value:Board)=>Board,options?:{history?:boolean;key?:string})=>boolean;
  undoChange:(boardId:string,fallback:(board:Board)=>Board)=>()=>void;
  notify:(message:string,options?:ToastOptions)=>void;
  fieldTrace:ReturnType<typeof useFieldTrace>;
  visibleView:()=>Rect;
  setSelectedIds:Dispatch<SetStateAction<string[]>>;
  setSelectedEdgeIds:Dispatch<SetStateAction<string[]>>;
  setView:Dispatch<SetStateAction<CanvasView>>;
  setCanvasReveal:Dispatch<SetStateAction<CanvasRevealRequest|null>>;
  setContextMenu:Dispatch<SetStateAction<{x:number;y:number}|null>>;
  inspectedId:string|null;
  setInspectedId:Dispatch<SetStateAction<string|null>>;
  activeVideo:string|null;
  setActiveVideo:Dispatch<SetStateAction<string|null>>;
  playbackRequest:RefObject<number>;
  playbackSession:RefObject<VideoPlaybackSession>;
  clearDraftNavigation:()=>void;
  showCard:(id:string,known?:BoardNode)=>void;
  closeInspectorRef:RefObject<()=>void>;
  videoRuns:RefObject<Map<string,{boardId:string;attemptId:string;controller:AbortController}>>;
  expectedAttempts:RefObject<Map<string,number>>;
  nativeTasks:RefObject<Map<string,VideoImportTask>>;
}) {
  // Cards placed in the last ~1.2s: the new-placement ring (§6.8).
  const [freshCardIds,setFreshCardIds]=useState<ReadonlySet<string>>(EMPTY_IDS);
  // Metadata the player fills in by itself (duration) is not a user edit and never becomes an invisible undo step (RL-m2).
  const updateCard=useCallback((id:string,patch:Partial<CardData>)=>{const automatic=Object.keys(patch).length>0&&Object.keys(patch).every(key=>key==='duration');return changeBoard(b=>({...b,nodes:b.nodes.map(n=>n.id===id?{...n,data:{...n.data,...patch}}:n)}),automatic?{history:false}:{key:'edit'});},[changeBoard]);
  /** New placement (§6.8): the ring on fresh cards; with reduced motion the trace player keeps the ring as a fade (§7). */
  const markFresh=useCallback((ids:string[])=>{
    if(!ids.length)return;
    const fresh:ReadonlySet<string>=new Set(ids);setFreshCardIds(fresh);fieldTrace.land(ids);
    window.setTimeout(()=>setFreshCardIds(current=>current===fresh?EMPTY_IDS:current),1300);
  },[fieldTrace]);
  /** Select and reveal cards that were just created (“查看”); a full-window panel steps aside first. */
  const revealIds=useCallback((boardId:string,ids:string[])=>{
    const current=boardRef.current;if(!current||current.id!==boardId)return;
    const present=ids.filter(id=>current.nodes.some(node=>node.id===id));
    if(document.querySelector('.inspector--video, .inspector--writing-expanded'))closeInspectorRef.current();
    setSelectedIds(present);setSelectedEdgeIds([]);setView('canvas');
    if(present.length)setCanvasReveal({boardId,ids:present,instant:false});
  },[]);
  /** “已摘到画布，系在 [位置]　[查看] [撤销]” (§8.3 #5–6). */
  const notifyExcerpt=useCallback((boardId:string,quotes:BoardNode[])=>{
    const ids=quotes.map(quote=>quote.id);const first=quotes[0];if(!first)return;
    const citation=first.data.citation;
    const source=citation?workspaceRef.current?.boards.find(item=>item.id===boardId)?.nodes.find(node=>node.id===citation.nodeId):undefined;
    const paragraph=citation?.textAnchor&&source?paragraphIndexAt(source.data.body,citation.textAnchor.from):undefined;
    const tag=citationLocationLabel(citation,paragraph);
    const many=quotes.length>1;
    notify(tag?(many?`已摘下 ${quotes.length} 张到画布，第一张系在`:'已摘到画布，系在'):(many?`已摘下 ${quotes.length} 张到画布`:'已摘到画布'),{
      ...(tag?{tag}:{}),
      action:{label:'查看',ariaLabel:'查看刚刚创建的摘录',onAction:()=>revealIds(boardId,ids)},
      undo:undoChange(boardId,b=>{const gone=new Set(ids);return {...b,nodes:b.nodes.filter(node=>!gone.has(node.id)),edges:b.edges.filter(edge=>!gone.has(edge.source)&&!gone.has(edge.target))};}),
    });
  },[notify,revealIds,undoChange]);
  /**
   * New card (§5.4). Keyboard, toolbar and commands: centred in the visible canvas, first free 32px-grid slot.
   * Double click or context menu: top-left at the pointer, pushed right/down when it would overlap.
   * A note opens for typing in place; a draft opens its panel with the focus in the body.
   */
  const addCard=useCallback((kind:CardKind,position?:{x:number;y:number})=>{
    const current=boardRef.current;if(!current)return;
    const created=createNode(kind,position??{x:0,y:0});
    const bounds=captionPlacementBounds(current.nodes,measurementsRef.current);
    const node=position?placeAtPointer(created,current.nodes,position,measurementsRef.current,bounds):placeInView(created,current.nodes,visibleView(),measurementsRef.current,'straddle',bounds);
    if(!changeBoard(b=>({...b,nodes:[...b.nodes,node]})))return;
    setSelectedIds([node.id]);setSelectedEdgeIds([]);setContextMenu(null);markFresh([node.id]);
    if(kind==='draft'||kind==='link'){
      // A new draft opens its writing panel: the editor chunk starts now (CORE-32).
      if(kind==='draft')void preloadDraftEditor().catch(()=>{});
      playbackRequest.current++;clearDraftNavigation();setInspectedId(node.id);
      setCanvasReveal({boardId:current.id,ids:[node.id],instant:false,whenInspected:node.id});
      if(kind==='draft')focusWhenReady('.inspector [aria-label="文稿正文"]');
    }else{
      if(!position)setCanvasReveal({boardId:current.id,ids:[node.id],instant:false});
      if(kind==='note')beginNoteEdit(node.id);
    }
    return node;
  },[beginNoteEdit,changeBoard,clearDraftNavigation,focusWhenReady,markFresh,visibleView]);
  const deleteCards=useCallback((ids:string[])=>{
    if(!ids.length||readOnlyRef.current)return;
    for(const node of boardRef.current?.nodes.filter(item=>ids.includes(item.id)&&pendingImport(item.data.videoImport?.status))??[]){
      videoRuns.current.get(node.id)?.controller.abort();
      if(node.data.nativeImportJobId)void cancelNativeVideoImport(node.data.nativeImportJobId,expectedAttempts.current.get(node.data.nativeImportJobId)).then(task=>{nativeTasks.current.set(task.id,task);}).catch(error=>notify(`卡片已移除，后台取消未完成：${errorMessage(error)}`));
    }
    const before=boardRef.current;
    const removedNodes=before?.nodes.filter(node=>ids.includes(node.id))??[];
    const removedEdges=before?.edges.filter(edge=>ids.includes(edge.source)||ids.includes(edge.target))??[];
    if(!before||!changeBoard(b=>({...b,nodes:b.nodes.filter(n=>!ids.includes(n.id)),edges:b.edges.filter(e=>!ids.includes(e.source)&&!ids.includes(e.target))})))return;
    if(inspectedId&&ids.includes(inspectedId))setInspectedId(null);if(activeVideo&&ids.includes(activeVideo)){playbackRequest.current++;playbackSession.current.stop();setActiveVideo(null);}setSelectedIds([]);
    // “已移除 3 张卡片　[撤销]” (§8.3 #9): puts back exactly these cards and their lines.
    notify(`已移除 ${removedNodes.length||ids.length} 张卡片`,{undo:undoChange(before.id,b=>{
      const present=new Set(b.nodes.map(node=>node.id));
      const nodes=[...b.nodes,...removedNodes.filter(node=>!present.has(node.id))];const all=new Set(nodes.map(node=>node.id));const edgeIds=new Set(b.edges.map(edge=>edge.id));
      return {...b,nodes,edges:[...b.edges,...removedEdges.filter(edge=>!edgeIds.has(edge.id)&&all.has(edge.source)&&all.has(edge.target))]};
    })});
  },[activeVideo,changeBoard,inspectedId,notify,undoChange]);
  const duplicateCardAction=useCallback((id:string)=>{const current=boardRef.current;const n=current?.nodes.find(n=>n.id===id);if(!n||!current)return;const original=duplicateNode(n);const raw=measurementsRef.current;const [copy]=placeCards([original],current.nodes,{origin:original.position,measurements:raw,bounds:captionPlacementBounds(current.nodes,raw)});if(changeBoard(b=>({...b,nodes:[...b.nodes,copy]}))){setSelectedIds([copy.id]);markFresh([copy.id]);}},[changeBoard,markFresh]);
  const placeQuotes=(current:Board,batch:{board:Board;quotes:BoardNode[]})=>{
    const quotes=avoidCaptionObstacles(batch.quotes,current.nodes,measurementsRef.current);
    if(quotes===batch.quotes)return batch;
    const placed=new Map(quotes.map(node=>[node.id,node]));
    return {...batch,quotes,board:{...batch.board,nodes:batch.board.nodes.map(node=>placed.get(node.id)??node)}};
  };
  const addQuote=useCallback((nodeId:string,lines:TranscriptLine[],position?:{x:number;y:number})=>{
    let quotes:BoardNode[]=[];let boardId='';
    try{
      const changed=changeBoard(current=>{
        const batch=placeQuotes(current,createQuoteBatch(current,nodeId,lines,{position,measurements,limits:STORAGE_LIMITS}));
        quotes=batch.quotes;boardId=current.id;return batch.board;
      });
      if(!changed||!quotes.length)return false;
      const ids=quotes.map(quote=>quote.id);setSelectedIds(ids);setSelectedEdgeIds([]);
      notifyExcerpt(boardId,quotes);fieldTrace.tie(ids);markFresh(ids);
      // A dropped excerpt stays where it was dropped; a button excerpt comes into the visible canvas (§5.4).
      if(!position)setCanvasReveal({boardId,ids,instant:false});
      return true;
    }catch(error){notify(errorMessage(error));return false;}
  },[changeBoard,fieldTrace,markFresh,measurements,notify,notifyExcerpt]);
  const addTextQuote=useCallback((nodeId:string,range:{from:number;to:number;bodySnapshot?:string})=>{
    let quotes:BoardNode[]=[];let boardId='';
    try{
      const changed=changeBoard(current=>{
        const batch=placeQuotes(current,createTextQuoteBatch(current,nodeId,range,{measurements,limits:STORAGE_LIMITS}));
        quotes=batch.quotes;boardId=current.id;return batch.board;
      });
      if(!changed||!quotes.length)return false;
      const ids=quotes.map(quote=>quote.id);setSelectedIds(ids);setSelectedEdgeIds([]);
      notifyExcerpt(boardId,quotes);fieldTrace.tie(ids);markFresh(ids);setCanvasReveal({boardId,ids,instant:false});return true;
    }catch(error){notify(errorMessage(error));return false;}
  },[changeBoard,fieldTrace,markFresh,measurements,notify,notifyExcerpt]);
  /** “摘录并写理解” (§6.18.2): excerpt like addQuote, then open the first new quote with “我的理解” focused. */
  const addQuoteAndAnnotate=useCallback((nodeId:string,lines:TranscriptLine[])=>{
    let quotes:BoardNode[]=[];let boardId='';
    try{
      const changed=changeBoard(current=>{const batch=placeQuotes(current,createQuoteBatch(current,nodeId,lines,{measurements,limits:STORAGE_LIMITS}));quotes=batch.quotes;boardId=current.id;return batch.board;});
      if(!changed||!quotes.length)return false;
      const ids=quotes.map(quote=>quote.id);const first=ids[0];
      notifyExcerpt(boardId,quotes);fieldTrace.tie(ids);markFresh(ids);
      playbackRequest.current++;clearDraftNavigation();showCard(first,quotes[0]);
      setCanvasReveal({boardId,ids:[first],instant:false,whenInspected:first});
      // The quote panel's “我的理解” field (CardBodySection, label for=card-body).
      focusWhenReady('.inspector textarea.inspector-mine');
      return true;
    }catch(error){notify(errorMessage(error));return false;}
  },[changeBoard,clearDraftNavigation,fieldTrace,focusWhenReady,markFresh,measurements,notify,notifyExcerpt,showCard]);
  return {freshCardIds,updateCard,markFresh,addCard,deleteCards,duplicateCardAction,addQuote,addTextQuote,addQuoteAndAnnotate};
}
