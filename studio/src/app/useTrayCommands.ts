import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Node, ReactFlowInstance } from '@xyflow/react';
import type { Board, CardData } from '../model';
import { frameContainsCard, getCardBounds, imageRatioKey, knownImageRatio, rememberImageRatio } from '../card-placement';
import type { Rect } from '../canvas/safe-area';
import type { RevealOptions } from '../canvas/reveal';
import type { ToastOptions } from '../shell/Toasts';
import { readImageSizeAt } from './local-media';
import { arrangeFrame, groupCards, moveIntoFrame, type FrameArrangementMode } from './frame-layout';
import type { CanvasRevealRequest } from './types';

/** Trays (§6.15; CORE-32: moved out of App.tsx unchanged): group the selection, arrange a tray, put a card into one. */
export function useTrayCommands({boardRef,readOnlyRef,measurementsRef,mediaUrlsRef,changeBoard,markFresh,revealRect,flow,notify,setSelectedIds,setSelectedEdgeIds,setCanvasReveal,setGroupPicker}:{
  boardRef:RefObject<Board|null>;
  readOnlyRef:RefObject<boolean>;
  measurementsRef:RefObject<Record<string,{width:number;height:number}>>;
  mediaUrlsRef:RefObject<Record<string,string>>;
  changeBoard:(fn:(value:Board)=>Board,options?:{history?:boolean;key?:string})=>boolean;
  markFresh:(ids:string[])=>void;
  revealRect:(rect:Rect,options?:RevealOptions&{instant?:boolean;reserveTop?:number})=>boolean;
  flow:ReactFlowInstance<Node<CardData>>;
  notify:(message:string,options?:ToastOptions)=>void;
  setSelectedIds:Dispatch<SetStateAction<string[]>>;
  setSelectedEdgeIds:Dispatch<SetStateAction<string[]>>;
  setCanvasReveal:Dispatch<SetStateAction<CanvasRevealRequest|null>>;
  setGroupPicker:Dispatch<SetStateAction<{cardId:string;anchor:HTMLElement|{x:number;y:number}}|null>>;
}) {
  /** Ctrl G / “分组” (§6.15): a tray around the selection, under every card, selected. */
  const groupSelection=useCallback((ids:string[])=>{
    const current=boardRef.current;if(!current||readOnlyRef.current)return;
    const result=groupCards(current,ids,measurementsRef.current);
    if(!result.frameId||!changeBoard(()=>result.board))return;
    setSelectedIds([result.frameId]);setSelectedEdgeIds([]);markFresh([result.frameId]);
    // FC-05: the tray's label sits 26 above its top edge (§6.15); a group made right under the top bar would leave it
    // under the bar, out of reach. Pan (never zoom) so the tray and its label are in the visible canvas.
    const frame=result.board.nodes.find(node=>node.id===result.frameId);
    if(frame){const box=getCardBounds(frame,measurementsRef.current);requestAnimationFrame(()=>revealRect({x:box.x,y:box.y-26,width:box.width,height:box.height+26},{zoom:flow.getViewport().zoom}));}
  },[changeBoard,flow,markFresh,revealRect]);
  /** Tray “按比例成行 / 网格 / 瀑布”: only the cards wholly inside, one undo step. */
  const arrangeFrameAction=useCallback(async(frameId:string,mode:FrameArrangementMode)=>{
    // CORE-03: arrange pictures at their own picture's ratio, not the box an earlier layout cropped them to.
    const current=boardRef.current;const frame=current?.nodes.find(node=>node.id===frameId);
    const unknown=current&&frame?current.nodes.filter(node=>node.data.kind==='image'&&!knownImageRatio(node)&&frameContainsCard(frame,node,measurementsRef.current)):[];
    await Promise.all(unknown.map(async node=>{
      const key=imageRatioKey(node);const source=node.data.mediaId?mediaUrlsRef.current[node.data.mediaId]:node.data.url||node.data.poster;
      if(!key||!source)return;
      const size=await Promise.race([readImageSizeAt(source),new Promise<null>(resolve=>window.setTimeout(()=>resolve(null),1500))]);
      if(size)rememberImageRatio(key,size.width,size.height);
    }));
    changeBoard(board=>arrangeFrame(board,frameId,mode,measurementsRef.current));
  },[changeBoard]);
  const moveCardIntoFrame=useCallback((cardId:string,frameId:string)=>{
    setGroupPicker(null);
    const current=boardRef.current;if(!current)return;
    if(changeBoard(b=>moveIntoFrame(b,cardId,frameId,measurementsRef.current))){setSelectedIds([cardId]);setCanvasReveal({boardId:current.id,ids:[frameId],instant:false});}
  },[changeBoard]);
  /** Image “加入分组” (§6.15): one tray takes it directly; several open the tray list at the button. */
  const addToGroup=useCallback((cardId:string)=>{
    const current=boardRef.current;const card=current?.nodes.find(node=>node.id===cardId);if(!current||!card)return;
    const frames=current.nodes.filter(node=>node.data.kind==='frame'&&!frameContainsCard(node,card,measurementsRef.current));
    if(!frames.length){notify(current.nodes.some(node=>node.data.kind==='frame')?'这张卡片已经在分组里。':'画布上还没有分组。选中几张卡片，按 Ctrl G 放进一个分组。');return;}
    if(frames.length===1){moveCardIntoFrame(cardId,frames[0].id);return;}
    const active=document.activeElement;const tools=document.querySelector<HTMLElement>('.selection-tools');const box=tools?.getBoundingClientRect();
    setGroupPicker({cardId,anchor:active instanceof HTMLElement&&active.closest('.selection-tools')?active:box?{x:box.left,y:box.bottom}:{x:innerWidth/2,y:innerHeight/2}});
  },[moveCardIntoFrame,notify]);
  return {groupSelection,arrangeFrameAction,moveCardIntoFrame,addToGroup};
}
