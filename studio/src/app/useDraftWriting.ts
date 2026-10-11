import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Board, BoardNode, TranscriptLine } from '../model';
import { STORAGE_LIMITS } from '../storage';
import { createNode, createQuoteBatch } from '../board-utils';
import { formatDraftQuote } from '../draft-references';
import { writeTripLine, type DraftNavigationSession, type TripWriteMode } from '../draft-navigation';
import { avoidCaptionObstacles, captionPlacementBounds, getCardBounds, placeAtPointer } from '../card-placement';
import type { ToastOptions } from '../shell/Toasts';
import type { CanvasRevealRequest } from './types';
import { errorMessage } from './utils';
import { clickWhenReady, focusWhenReady } from './studio-dom';

/**
 * Writing excerpts into a draft (§6.6, §6.29; CORE-32: moved out of App.tsx unchanged): “写进文稿” to the draft written
 * last, “配给这一行” / “另起一行写进原话” on a shot-picking trip, and the two shortcuts that open a draft in focus writing
 * or at its export.
 */
export function useDraftWriting({board,inspected,boardRef,readOnlyRef,measurementsRef,changeBoard,undoChange,markFresh,notify,draftNavigation,returnToDraft,openCard,showCard,clearDraftNavigation,playbackRequest,setCanvasReveal}:{
  board:Board|null;
  inspected:BoardNode|undefined;
  boardRef:RefObject<Board|null>;
  readOnlyRef:RefObject<boolean>;
  measurementsRef:RefObject<Record<string,{width:number;height:number}>>;
  changeBoard:(fn:(value:Board)=>Board,options?:{history?:boolean;key?:string})=>boolean;
  undoChange:(boardId:string,fallback:(board:Board)=>Board)=>()=>void;
  markFresh:(ids:string[])=>void;
  notify:(message:string,options?:ToastOptions)=>void;
  draftNavigation:RefObject<DraftNavigationSession>;
  returnToDraft:()=>boolean;
  openCard:(id:string)=>void;
  showCard:(id:string,known?:BoardNode)=>void;
  clearDraftNavigation:()=>void;
  playbackRequest:RefObject<number>;
  setCanvasReveal:Dispatch<SetStateAction<CanvasRevealRequest|null>>;
}) {
  // The draft written most recently on each board: “写进文稿” goes there (§6.6).
  const lastDraft=useRef<{boardId:string;id:string}|null>(null);
  useEffect(()=>{if(board&&inspected?.data.kind==='draft')lastDraft.current={boardId:board.id,id:inspected.id};},[board?.id,inspected?.id,inspected?.data.kind]);
  const focusWriting=useCallback((id:string)=>{openCard(id);clickWhenReady('.inspector [aria-label="展开写作"][aria-pressed="false"]');},[clickWhenReady,openCard]);
  const exportDraft=useCallback((id:string)=>{openCard(id);clickWhenReady('.inspector details.inspector-draft-export:not([open]) > summary');},[clickWhenReady,openCard]);
  /**
   * On a trip that picks a shot for one script line (“补一个镜头”, §6.29), excerpts are written into that draft in one
   * undo step with any new quote cards: `shot` (“配给这一行”) folds only their source links into the line, which gets its
   * picture and keeps its words; `line` (“另起一行写进原话”) writes each quotation with its source right after the line.
   * The way back then opens the script, where that line (or the new one) comes to the middle and is marked once
   * (`draft-inserted`).
   */
  const writeIntoTripLine=useCallback((make:(current:Board)=>{board:Board;quotes:BoardNode[];created:boolean},mode:TripWriteMode)=>{
    const current=boardRef.current;if(!current||readOnlyRef.current)return false;
    const point=draftNavigation.current.insertPoint(current);const trip=draftNavigation.current.info(current);
    if(!point||!trip)return false;
    let quotes:BoardNode[]=[];let created=false;let before='';let after='';let followed=true;let written:TripWriteMode=mode;
    let span={from:0,to:0,at:0,delta:0};
    try{
      const changed=changeBoard(b=>{
        const made=make(b);
        const draft=made.board.nodes.find(node=>node.id===trip.draftId&&node.data.kind==='draft');
        if(!made.quotes.length||!draft)return b;
        before=draft.data.body;const body=before.replace(/\r\n?/g,'\n');
        const result=writeTripLine(body,point,made.quotes,mode);followed=result.followed;written=result.mode;
        after=result.body;span={from:result.from,to:result.to,at:result.at,delta:result.body.length-body.length};
        quotes=made.quotes;created=made.created;
        return {...made.board,nodes:made.board.nodes.map(node=>node.id===draft.id?{...node,data:{...node.data,body:after}}:node)};
      });
      if(!changed||!quotes.length)return false;
    }catch(error){notify(errorMessage(error));return false;}
    const ids=created?quotes.map(quote=>quote.id):[];
    if(ids.length)markFresh(ids);
    // The caret kept for the way back moves with the words after the new lines.
    draftNavigation.current.shiftReturn(span.at,span.delta);
    const title=trip.title||'未命名文稿';
    const undoWrite=undoChange(current.id,b=>{const gone=new Set(ids);return {...b,nodes:b.nodes.filter(node=>!gone.has(node.id)).map(node=>node.id===trip.draftId&&node.data.body===after?{...node,data:{...node.data,body:before}}:node),edges:b.edges.filter(edge=>!gone.has(edge.source)&&!gone.has(edge.target))};});
    if(!returnToDraft())return true;
    // After the panel has restored the draft (its token is acknowledged) and the editor holds the new body: the caret goes
    // after the new words (for 正文), and the script brings the line that took the picture (or the first new line) to the
    // middle and marks it.
    let frames=0;
    const reveal=()=>{
      const latest=boardRef.current;const editor=document.querySelector<HTMLElement&{value?:string;setSelectionRange?:(a:number,b:number)=>void;revealSelection?:()=>void}>('.inspector [aria-label="文稿正文"]');
      const restoring=latest?draftNavigation.current.restoreInfo(latest):null;
      if(editor?.setSelectionRange&&editor.value===after&&!restoring){
        editor.focus({preventScroll:true});editor.setSelectionRange(span.to,span.to);editor.revealSelection?.();
        // “配给这一行”: the script marks the line holding the new link; otherwise the first new line.
        editor.dispatchEvent(new CustomEvent('draft-inserted',{bubbles:true,detail:written==='shot'?{within:span.from}:{from:span.from}}));return;}
      if(++frames<180)requestAnimationFrame(reveal);};
    requestAnimationFrame(reveal);
    const many=quotes.length>1?` ${quotes.length} 段`:'';
    notify(written==='shot'?`已给「${title}」${point.line?`第 ${point.line} 行`:'这一行'}配上画面${quotes.length>1?`，共 ${quotes.length} 段`:''}`
      :followed?`已写进「${title}」${many}${point.line?`，在第 ${point.line} 行之后`:''}`:`已写进「${title}」末尾${many}：出发的那一行已改动`,{undo:undoWrite});
    return true;
  },[changeBoard,markFresh,notify,returnToDraft,undoChange]);
  /** The watching page's transcript on a “补一个镜头” trip: excerpt the sentences, then give them to the line (or write them in after it). */
  const writeLinesToDraft=useCallback((nodeId:string,lines:TranscriptLine[],mode:TripWriteMode='shot')=>writeIntoTripLine(b=>{
    const batch=createQuoteBatch(b,nodeId,lines,{measurements:measurementsRef.current,limits:STORAGE_LIMITS});
    const quotes=avoidCaptionObstacles(batch.quotes,b.nodes,measurementsRef.current);
    const placed=new Map(quotes.map(node=>[node.id,node]));
    return {board:{...batch.board,nodes:batch.board.nodes.map(node=>placed.get(node.id)??node)},quotes,created:true};
  },mode),[writeIntoTripLine]);
  /** “写进文稿” (§6.6): append the quote's citation to the draft written last on this board (or the first, or a new one) and open it. */
  const writeToDraft=useCallback((quoteId:string,mode:TripWriteMode='shot')=>{
    const current=boardRef.current;const quote=current?.nodes.find(node=>node.id===quoteId);
    if(!current||!quote||quote.data.kind!=='quote'||readOnlyRef.current)return;
    // On a “补一个镜头” trip the excerpt goes to the line the trip left from (§6.29 配给这一行 / 另起一行写进原话).
    if(draftNavigation.current.insertPoint(current)){writeIntoTripLine(b=>{const found=b.nodes.find(node=>node.id===quoteId&&node.data.kind==='quote');return {board:b,quotes:found?[found]:[],created:false};},mode);return;}
    const remembered=lastDraft.current?.boardId===current.id?current.nodes.find(node=>node.id===lastDraft.current?.id&&node.data.kind==='draft'):undefined;
    const existing=remembered??current.nodes.find(node=>node.data.kind==='draft');
    let text:string;try{text=formatDraftQuote(quote);}catch(error){notify(errorMessage(error));return;}
    const append=(body:string)=>`${body.replace(/\s+$/,'')}${text.replace(/\n+$/,'\n')}`.replace(/^\n+/,'');
    const created=existing?undefined:placeAtPointer(createNode('draft',{x:0,y:0}),current.nodes,{x:quote.position.x+getCardBounds(quote,measurementsRef.current).width+64,y:quote.position.y},measurementsRef.current,captionPlacementBounds(current.nodes,measurementsRef.current));
    const target=(existing??created)!;
    const before=target.data.body;const after=append(before);
    if(!changeBoard(b=>({...b,nodes:created?[...b.nodes,{...created,data:{...created.data,body:after}}]:b.nodes.map(node=>node.id===target.id?{...node,data:{...node.data,body:after}}:node)})))return;
    if(created)markFresh([created.id]);
    playbackRequest.current++;clearDraftNavigation();showCard(target.id);
    setCanvasReveal({boardId:current.id,ids:[target.id],instant:false,whenInspected:target.id});
    // The caret lands right after the new citation, so the insertion is in view (C11 adapter on the editor).
    let frames=0;
    const caret=()=>{const editor=document.querySelector<HTMLElement&{value?:string;setSelectionRange?:(a:number,b:number)=>void;revealSelection?:()=>void}>('.inspector [aria-label="文稿正文"]');
      if(editor?.setSelectionRange&&editor.value===after.replace(/\r\n?/g,'\n')){editor.focus({preventScroll:true});editor.setSelectionRange(after.length,after.length);editor.revealSelection?.();
        // A draft showing 脚本 has its editor hidden: the script view brings the new line into view instead (§6.29).
        editor.dispatchEvent(new CustomEvent('draft-inserted',{bubbles:true,detail:{from:before.replace(/\s+$/,'').length}}));return;}
      if(++frames<120)requestAnimationFrame(caret);};
    requestAnimationFrame(caret);
    notify(created?'已写进新文稿':`已写进「${target.data.title||'未命名文稿'}」`,{undo:undoChange(current.id,b=>({...b,nodes:created?b.nodes.filter(node=>node.id!==created.id):b.nodes.map(node=>node.id===target.id&&node.data.body===after?{...node,data:{...node.data,body:before}}:node)}))});
  },[changeBoard,clearDraftNavigation,focusWhenReady,markFresh,notify,showCard,undoChange,writeIntoTripLine]);
  return {focusWriting,exportDraft,writeLinesToDraft,writeToDraft};
}
