import { useCallback, useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Board, CardKind, Workspace } from '../model';
import type { WorkspaceSearchHit } from '../workspace-search';
import type { TraceOrigin } from '../canvas/trace';
import type { ToastOptions } from '../shell/Toasts';
import type { CanvasView, Modal } from './types';
import { searchHitPassage, searchHitRange } from './search-reveal';

/** Search and commands (Ctrl K; CORE-32: moved out of App.tsx unchanged): a hit opens at the hit (CORE-05), commands run. */
export function useSearchNavigation({board,boardRef,workspaceRef,readOnlyRef,busyRef,pendingTranscriptEdits,notify,switchBoard,setView,setModal,focusSource,addCard,fitCanvas}:{
  board:Board|null;
  boardRef:RefObject<Board|null>;
  workspaceRef:RefObject<Workspace|null>;
  readOnlyRef:RefObject<boolean>;
  busyRef:RefObject<string>;
  pendingTranscriptEdits:RefObject<Set<string>>;
  notify:(message:string,options?:ToastOptions)=>void;
  switchBoard:(id:string)=>void;
  setView:Dispatch<SetStateAction<CanvasView>>;
  setModal:Dispatch<SetStateAction<Modal>>;
  focusSource:(id:string,time?:number,keepDraftReturn?:boolean,quoteNodeId?:string,origin?:TraceOrigin,quoteText?:string)=>void;
  addCard:(kind:CardKind,position?:{x:number;y:number})=>unknown;
  fitCanvas:(duration?:number,ids?:string[])=>void;
}) {
  const [searchNavigation,setSearchNavigation]=useState<WorkspaceSearchHit|null>(null);
  const selectSearchHit=useCallback((hit:WorkspaceSearchHit)=>{
    if(pendingTranscriptEdits.current.size){notify('请先保存或取消逐字稿校对，再打开另一张卡片。');return;}
    const target=workspaceRef.current?.boards.find(item=>item.id===hit.boardId);
    if(!target?.nodes.some(node=>node.id===hit.nodeId)){notify('这张卡片已被移除，请重新搜索。');return;}
    switchBoard(hit.boardId);setView('canvas');setModal(null);setSearchNavigation(hit);
  },[notify,switchBoard]);
  const runSearchCommand=useCallback((command:'note'|'draft'|'import'|'new-board'|'fit')=>{
    if(command!=='fit'&&(readOnlyRef.current||busyRef.current))return;
    setModal(null);
    if(command==='fit'){setView('canvas');requestAnimationFrame(()=>void fitCanvas());}
    else if(command==='note'||command==='draft')addCard(command);
    else setModal(command==='import'?'import':'new');
  },[addCard,fitCanvas]);
  useEffect(()=>{
    if(!searchNavigation||board?.id!==searchNavigation.boardId)return;
    const request=searchNavigation;
    const frame=requestAnimationFrame(()=>{
      const current=boardRef.current;
      if(current?.id!==request.boardId||!current.nodes.some(node=>node.id===request.nodeId))return;
      // CORE-05: a hit in a body opens at the hit — the reading view marks and scrolls to the sentence, a draft puts the caret on it.
      const node=current.nodes.find(item=>item.id===request.nodeId)!;
      const passage=node.data.kind==='note'||node.data.kind==='link'?searchHitPassage(node.data.body,request):undefined;
      const draftRange=node.data.kind==='draft'?searchHitRange(node.data.body,request):undefined;
      setSearchNavigation(null);focusSource(request.nodeId,request.time,false,undefined,undefined,passage);
      document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(request.nodeId)}"]`)?.focus({preventScroll:true});
      if(draftRange){
        let frames=0,seen=0;
        const tick=()=>{
          const editor=document.querySelector<HTMLElement&{revealRange?:(from:number,to:number)=>void}>('.inspector .cm-content');
          if(editor?.revealRange&&++seen>2){editor.revealRange(draftRange.start,draftRange.end);return;}
          if(++frames<90)requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    });
    return()=>cancelAnimationFrame(frame);
  },[board?.id,searchNavigation,focusSource]);
  return {selectSearchHit,runSearchCommand};
}
