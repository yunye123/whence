import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import { applyEdgeChanges, addEdge, type Node, type NodeChange, type EdgeChange, type Connection, type OnConnectEnd, type OnSelectionChangeParams, type ReactFlowInstance } from '@xyflow/react';
import type { Board, BoardNode, CardData, TranscriptLine, Workspace } from '../model';
import { uid } from '../model';
import { STORAGE_LIMITS } from '../storage';
import { frameContainsCard } from '../card-placement';
import { nudgeCards } from '../card-movement';
import { snapCards, type SnapGuide } from '../card-snap';
import { storedEdgeChanges, resolveConnectionDrop, CONNECT_HINT } from '../canvas/edges';
import type { ToastOptions } from '../shell/Toasts';
import type { CanvasTool, CanvasView, Modal } from './types';
import { clone, editableTarget } from './utils';
import { isSubstantiveNodeChange, applyCanvasNodeChanges } from './canvas-changes';
import { canvasTabOrder } from './studio-dom';
import { getVisibleCardBounds, type CaptionRules } from './caption-rules';
import { lodForZoom } from '../canvas/lod';

/** Smart snapping (§6.7; CORE-32: moved out of App.tsx unchanged): the remembered switch, the guides, Alt to bypass. */
export function useSnapGuides({board,effectiveTool,view}:{board:Board|null;effectiveTool:CanvasTool;view:CanvasView}) {
  const [smartSnap,setSmartSnap]=useState(()=>{try{return localStorage.getItem('field.smart-snap.v1')!=='off';}catch{return true;}});
  const [snapGuides,setSnapGuides]=useState<SnapGuide[]>([]);
  const movingCardIds=useRef<string[]>([]);
  const snapBypass=useRef(false);
  useEffect(()=>{try{localStorage.setItem('field.smart-snap.v1',smartSnap?'on':'off');}catch{}setSnapGuides([]);},[smartSnap]);
  useEffect(()=>{movingCardIds.current=[];setSnapGuides([]);},[board?.id,effectiveTool,view]);
  useEffect(()=>{
    const modifier=(event:KeyboardEvent)=>{snapBypass.current=event.altKey;if(event.altKey)setSnapGuides([]);};
    const reset=()=>{snapBypass.current=false;setSnapGuides([]);};
    window.addEventListener('keydown',modifier,true);window.addEventListener('keyup',modifier,true);window.addEventListener('blur',reset);
    return()=>{window.removeEventListener('keydown',modifier,true);window.removeEventListener('keyup',modifier,true);window.removeEventListener('blur',reset);};
  },[]);
  return {smartSnap,setSmartSnap,snapGuides,setSnapGuides,movingCardIds,snapBypass};
}

/**
 * The canvas's own events (CORE-32: moved out of App.tsx unchanged): selection, measurements, drags and resizes as one
 * undo step each (frames carry their cards, K9-6), lines, the canvas Tab order and arrow keys (CORE-16/18), and drops.
 */
export function useCanvasHandlers({boardRef,workspaceRef,readOnlyRef,modal,contextMenu,inspectedId,selectedIds,effectiveTool,measurements,flow,changeBoard,pushHistory,notify,openCard,addQuote,importFiles,setSelectedIds,setSelectedEdgeIds,setMeasurements,smartSnap,setSnapGuides,movingCardIds,snapBypass,captionRulesRef}:{
  boardRef:RefObject<Board|null>;
  workspaceRef:RefObject<Workspace|null>;
  readOnlyRef:RefObject<boolean>;
  modal:Modal;
  contextMenu:{x:number;y:number}|null;
  inspectedId:string|null;
  selectedIds:string[];
  effectiveTool:CanvasTool;
  measurements:Record<string,{width:number;height:number}>;
  flow:ReactFlowInstance<Node<CardData>>;
  changeBoard:(fn:(value:Board)=>Board,options?:{history?:boolean;key?:string})=>boolean;
  pushHistory:(old:Board,key?:string)=>void;
  notify:(message:string,options?:ToastOptions)=>void;
  openCard:(id:string)=>void;
  addQuote:(nodeId:string,lines:TranscriptLine[],position?:{x:number;y:number})=>boolean;
  importFiles:(files:File[],point?:{x:number;y:number})=>Promise<void>;
  setSelectedIds:Dispatch<SetStateAction<string[]>>;
  setSelectedEdgeIds:Dispatch<SetStateAction<string[]>>;
  setMeasurements:Dispatch<SetStateAction<Record<string,{width:number;height:number}>>>;
  smartSnap:boolean;
  setSnapGuides:Dispatch<SetStateAction<SnapGuide[]>>;
  movingCardIds:RefObject<string[]>;
  snapBypass:RefObject<boolean>;
  captionRulesRef?:RefObject<CaptionRules|null>;
}) {
  const dragSnapshot=useRef<Board|null>(null);
  const resizeSnapshot=useRef<Board|null>(null);
  const frameContents=useRef<{frameId:string;origin:{x:number;y:number};nodes:BoardNode[]}[]>([]);
  const keyboardMoveSnapshot=useRef<Board|null>(null);
  const onNodesChange=useCallback((changes:NodeChange<Node<CardData>>[])=>{
    const selection=changes.filter(change=>change.type==='select');
    if(selection.length)setSelectedIds(current=>{const ids=new Set(current);for(const change of selection)if(change.type==='select'){if(change.selected)ids.add(change.id);else ids.delete(change.id);}const next=[...ids];return next.length===current.length&&next.every((id,index)=>id===current[index])?current:next;});
    const dimensions=changes.filter(c=>c.type==='dimensions'&&c.dimensions);
    if(dimensions.length)setMeasurements(previous=>{let next=previous;for(const c of dimensions){if(c.type!=='dimensions'||!c.dimensions)continue;const old=previous[c.id];if(!old||old.width!==c.dimensions.width||old.height!==c.dimensions.height){if(next===previous)next={...previous};next[c.id]=c.dimensions;}}return next;});
    const substantive=changes.filter(isSubstantiveNodeChange);
    if(!substantive.length)return;
    if(substantive.some(c=>c.type==='dimensions'&&c.resizing)&&!resizeSnapshot.current)resizeSnapshot.current=clone(boardRef.current);
    const commit=()=>changeBoard(b=>{
      let next=applyCanvasNodeChanges(b.nodes,substantive,frameContents.current);
      if(movingCardIds.current.length&&substantive.some(change=>change.type==='position')){
        const snap=snapCards(next,movingCardIds.current,measurements,{zoom:flow.getZoom(),bypass:!smartSnap||snapBypass.current,getBounds:(node,sizes)=>getVisibleCardBounds(node,sizes,captionRulesRef?.current?.captionIds,lodForZoom(flow.getZoom()))});
        setSnapGuides(snap.guides);
        // Whole canvas units: a dragged group and its cards move by exactly the same amount (K9-6), and cards stay crisp at 100%.
        const moving=new Set(movingCardIds.current);next=next.map(node=>moving.has(node.id)?{...node,position:{x:Math.round(node.position.x+snap.dx),y:Math.round(node.position.y+snap.dy)}}:node);
      }
      return {...b,nodes:next};
    },{history:false});
    // Pointer resize changes carry setAttributes. Commit their controlled width now,
    // before native observers run, instead of letting an observer store notification
    // flush that pending width change midway through its own delivery.
    if(substantive.some(c=>c.type==='dimensions'&&c.setAttributes))flushSync(commit);else commit();
    if(substantive.some(c=>c.type==='dimensions'&&c.resizing===false)&&resizeSnapshot.current){pushHistory(resizeSnapshot.current);resizeSnapshot.current=null;}
  },[changeBoard,pushHistory,flow,measurements,smartSnap]);
  const onEdgesChange=useCallback((changes:EdgeChange[])=>{const selection=changes.filter(change=>change.type==='select');if(selection.length)setSelectedEdgeIds(current=>{const ids=new Set(current);for(const change of selection)if(change.type==='select'){if(change.selected)ids.add(change.id);else ids.delete(change.id);}return [...ids];});const edits=storedEdgeChanges(changes.filter(c=>c.type!=='select'));if(edits.length)changeBoard(b=>({...b,edges:applyEdgeChanges(edits,b.edges)}));},[changeBoard]);
  const onSelectionChange=useCallback(({nodes,edges}:OnSelectionChangeParams)=>{
    const ids=nodes.map(n=>n.id);const edgeIds=edges.map(e=>e.id);
    setSelectedIds(old=>old.length===ids.length&&old.every((id,i)=>id===ids[i])?old:ids);
    setSelectedEdgeIds(old=>old.length===edgeIds.length&&old.every((id,i)=>id===edgeIds[i])?old:edgeIds);
  },[]);
  const connectCards=useCallback((source:string,target:string)=>{
    const current=boardRef.current;
    if(readOnlyRef.current||!current)return false;
    if(source===target){notify('请连接两张不同的卡片');return false;}
    if(!current.nodes.some(node=>node.id===source)||!current.nodes.some(node=>node.id===target)){notify('卡片已被移除，请重新选择');return false;}
    if(current.edges.some(edge=>edge.source===source&&edge.target===target)){notify('这两张卡片已经连接');return false;}
    if(current.edges.length>=STORAGE_LIMITS.edges){notify('当前画布连线已达到上限');return false;}
    return changeBoard(value=>({...value,edges:addEdge({source,target,id:uid(),type:'smoothstep'},value.edges)}));
  },[changeBoard,notify]);
  const onConnect=useCallback((connection:Connection)=>{connectCards(connection.source,connection.target);},[connectCards]);
  // EG-M2: the whole card is a drop target; a drop on empty canvas says how to connect (§8.3 #24).
  const onConnectEnd=useCallback<OnConnectEnd>((event,state)=>{const drop=resolveConnectionDrop(event,state,id=>boardRef.current?.nodes.find(node=>node.id===id)?.data.kind);if(drop==='hint')notify(CONNECT_HINT);else if(drop)connectCards(drop.source,drop.target);},[connectCards,notify]);
  const onNodeDragStart=useCallback((_event:unknown,node:Node<CardData>,dragged:Node<CardData>[])=>{
    const latest=workspaceRef.current,current=latest?.boards.find(item=>item.id===latest.activeBoardId)??null;dragSnapshot.current=clone(current);frameContents.current=[];setSnapGuides([]);
    if(current){const selected=new Set([...(node?[node.id]:[]),...dragged.map(item=>item.id)]);const assigned=new Set(selected);for(const frame of current.nodes.filter(item=>selected.has(item.id)&&item.data.kind==='frame')){const children=current.nodes.filter(item=>!assigned.has(item.id)&&frameContainsCard(frame,item,measurements));children.forEach(item=>assigned.add(item.id));frameContents.current.push({frameId:frame.id,origin:{...frame.position},nodes:clone(children)});}movingCardIds.current=[...assigned];}
  },[measurements]);
  const onNodeDragStop=useCallback(()=>{
    const latest=workspaceRef.current,current=latest?.boards.find(item=>item.id===latest.activeBoardId);
    if(dragSnapshot.current){if(current?.id===dragSnapshot.current.id&&JSON.stringify(dragSnapshot.current.nodes.map(n=>n.position))!==JSON.stringify(current.nodes.map(n=>n.position)))pushHistory(dragSnapshot.current);dragSnapshot.current=null;}
    frameContents.current=[];movingCardIds.current=[];setSnapGuides([]);
  },[pushHistory]);
  const finishKeyboardMove=useCallback(()=>{const previous=keyboardMoveSnapshot.current;keyboardMoveSnapshot.current=null;const latest=workspaceRef.current,current=latest?.boards.find(item=>item.id===latest.activeBoardId);if(previous&&current?.id===previous.id&&JSON.stringify(previous.nodes.map(node=>node.position))!==JSON.stringify(current.nodes.map(node=>node.position)))pushHistory(previous);},[pushHistory]);
  useEffect(()=>{const release=(event:KeyboardEvent)=>{if(event.key.startsWith('Arrow'))finishKeyboardMove();};window.addEventListener('keyup',release);window.addEventListener('blur',finishKeyboardMove);return()=>{window.removeEventListener('keyup',release);window.removeEventListener('blur',finishKeyboardMove);};},[finishKeyboardMove]);
  const onCanvasKey=useCallback((event:React.KeyboardEvent)=>{
    // CORE-16: cards first, then lines, then the tools (canvasTabOrder); typing fields and open menus keep their own Tab.
    if(event.key==='Tab'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.nativeEvent.isComposing&&!editableTarget(event.target)&&!(event.target as Element).closest?.('[role="menu"], [role="dialog"]')){
      const shell=event.currentTarget as HTMLElement;const active=document.activeElement as HTMLElement|null;
      const order=canvasTabOrder(shell);const found=active?order.indexOf(active):-1;const index=active===shell?-1:found>=0?found:-2;
      if(index>-2){
        let next:HTMLElement|null|undefined=event.shiftKey?(index>0?order[index-1]:index===0?shell:null):order[index+1];
        // Past the last stop: the first focusable thing after the canvas (the lines may sit before the cards in the DOM).
        if(!event.shiftKey&&!next&&index>=0){
          const after=[...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')].find(element=>element.tabIndex>=0&&!shell.contains(element)&&!!(shell.compareDocumentPosition(element)&Node.DOCUMENT_POSITION_FOLLOWING)&&!element.closest('[inert]')&&element.getClientRects().length>0);
          next=after??null;
        }
        if(next){event.preventDefault();event.stopPropagation();next.focus();return;}
      }
    }
    const node=(event.target as HTMLElement).classList?.contains('react-flow__node')?(event.target as HTMLElement).dataset.id:undefined;
    const plain=!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&!event.nativeEvent.isComposing;
    // CORE-16: Enter on the card that is already selected opens it (the same as a double click); Space still adds to the selection.
    if(node&&plain&&event.key==='Enter'&&selectedIds.length===1&&selectedIds[0]===node){event.preventDefault();event.stopPropagation();openCard(node);return;}
    // CORE-18: Esc on a card clears the whole selection and keeps the focus on that card (React Flow would drop one card and blur).
    if(node&&plain&&event.key==='Escape'&&!modal&&!contextMenu&&!inspectedId){event.preventDefault();event.stopPropagation();setSelectedIds([]);setSelectedEdgeIds([]);return;}
    if(effectiveTool==='hand'||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||editableTarget(event.target)||(event.target as Element).closest('button,a,video,audio,[role="toolbar"]')||event.nativeEvent.isComposing||event.ctrlKey||event.metaKey||event.altKey||!selectedIds.length||readOnlyRef.current)return;
    event.preventDefault();event.stopPropagation();if(!keyboardMoveSnapshot.current)keyboardMoveSnapshot.current=clone(boardRef.current);
    const step=event.shiftKey?10:1;changeBoard(current=>nudgeCards(current,selectedIds,event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0,measurements),{history:false});
  },[changeBoard,contextMenu,effectiveTool,inspectedId,measurements,modal,openCard,selectedIds]);
  const onCanvasDrop=useCallback((e:React.DragEvent<HTMLDivElement>)=>{
    e.preventDefault();const point=flow.screenToFlowPosition({x:e.clientX,y:e.clientY});const payload=e.dataTransfer.getData('application/x-field-quote');
    if(payload){try{const selection=JSON.parse(payload) as {nodeId:string;lineIds:string[]};const source=boardRef.current?.nodes.find(n=>n.id===selection.nodeId);if(!source||!Array.isArray(selection.lineIds))return;const lines=source.data.transcript?.filter(l=>selection.lineIds.includes(l.id))??[];addQuote(source.id,lines,point);}catch{notify('摘录拖放未完成，请重新选择原句。');}return;}
    void importFiles(Array.from(e.dataTransfer.files),point);
  },[addQuote,flow,importFiles,notify]);
  return {onNodesChange,onEdgesChange,onSelectionChange,connectCards,onConnect,onConnectEnd,onNodeDragStart,onNodeDragStop,onCanvasKey,onCanvasDrop};
}

