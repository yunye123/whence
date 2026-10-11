import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import type { Node, ReactFlowInstance } from '@xyflow/react';
import type { Board, BoardNode, CardData } from '../model';
import { parseDraftReferences } from '../draft-references';
import { frameContainsCard, getCardBounds } from '../card-placement';
import { getCanvasMetrics, getCanvasOverlayRects, getVisibleFlowRect, visibleFlowRect, visibleScreenRect, type Rect } from '../canvas/safe-area';
import { CANVAS_MIN_ZOOM, GALLERY_MIN_ZOOM, REVEAL_MIN_ZOOM, START_MIN_ZOOM, cameraDuration, cameraEase, composeStartViewport, computeRevealViewport, fitViewportToRect, fitsAtZoom, framedStart, rectContains, startAreaZoom, unionRects, type RevealOptions } from '../canvas/reveal';
import { LOD_FULL_MIN } from '../canvas/lod';
import { readStartLineOffset } from '../canvas/start-line-alignment';
import { getVisibleCardBounds, type CaptionRules } from './caption-rules';
import { motionDuration } from '../motion';
import { dismissToast } from '../shell/Toasts';
import { TRAY_PADDING } from './frame-layout';
import { SELECTION_BAR_BAND, TRAY_LABEL_BAND, focusCanvasNode } from './studio-dom';
import type { CanvasRevealRequest, CanvasView } from './types';

/**
 * The camera (DESIGN_SYSTEM §5.5, CORE-32: moved out of App.tsx unchanged): fit (“查看全部 / 查看所选”), the single
 * reveal follow, the start area of a freshly opened board, and the visible safe area new cards are placed into.
 */
export function useCanvasViewport({flow,boardRef,measurementsRef,sidebarRef,setSidebar,captionRulesRef}:{
  flow:ReactFlowInstance<Node<CardData>>;
  boardRef:RefObject<Board|null>;
  measurementsRef:RefObject<Record<string,{width:number;height:number}>>;
  sidebarRef:RefObject<boolean>;
  captionRulesRef?:RefObject<CaptionRules|null>;
  setSidebar:Dispatch<SetStateAction<boolean>>;
}) {
  // CORE-22: the board whose start area already folded the sidebar away (once per board open).
  const startCollapse=useRef<string|null>(null);
  // CORE-22: while the start area of a freshly opened board is composed, every card renders (not only the visible ones)
  // so each has a real measurement — a card left unmeasured counted with a fallback height (a note as 440).
  const [measureAll,setMeasureAll]=useState(false);
  // Bounds come from stored positions and known sizes (measured, stored or default), never from a pending React Flow measurement (CV-B1).
  const nodeBounds=useCallback((nodes:BoardNode[]):Rect|null=>{
    const frames=nodes.filter(node=>node.data.kind==='frame');
    const visible=frames.length?(boardRef.current?.nodes??nodes).filter(node=>nodes.includes(node)||frames.some(frame=>frameContainsCard(frame,node,measurementsRef.current))):nodes;
    return unionRects(visible.map(node=>getVisibleCardBounds(node,measurementsRef.current,captionRulesRef?.current?.captionIds)));
  },[]);
  /** "查看全部" / "查看所选": fit inside the safe area (no space reserved for the minimap), at most 100%. */
  const importToast=useRef<string|null>(null);
  const fitCanvas=useCallback((duration=300,ids?:string[])=>{
    const current=boardRef.current;if(!current)return;
    if(importToast.current){dismissToast(importToast.current);importToast.current=null;}
    const chosen=ids?current.nodes.filter(node=>ids.includes(node.id)):current.nodes;
    const metrics=getCanvasMetrics();const cards=nodeBounds(chosen);if(!cards||!metrics)return;
    // CORE-36: a tray's label hangs above its top edge — 26 canvas units at full size, 26 screen pixels when zoomed out —
    // so it is fitted too, and never cut by the top bar. Two passes: the band depends on the zoom it leads to.
    const trays=chosen.filter(node=>node.data.kind==='frame').map(node=>getCardBounds(node,measurementsRef.current));
    const withLabels=(zoom:number)=>{const band=TRAY_LABEL_BAND/Math.min(1,zoom);return trays.length?unionRects([cards,...trays.map(box=>({...box,y:box.y-band,height:box.height+band}))])!:cards;};
    const first=fitViewportToRect(withLabels(1),metrics,metrics.insets,{minZoom:CANVAS_MIN_ZOOM,maxZoom:1});
    const rect=withLabels(first?.zoom??1);
    const next=fitViewportToRect(rect,metrics,metrics.insets,{minZoom:CANVAS_MIN_ZOOM,maxZoom:1});
    if(next)void flow.setViewport(next,{duration:motionDuration(duration)});
  },[flow,nodeBounds]);
  /** The single viewport follow for open card, source reveal, created cards and excerpts (§5.5). */
  const revealRect=useCallback((rect:Rect,options:RevealOptions&{instant?:boolean;reserveTop?:number}={})=>{
    const metrics=getCanvasMetrics();if(!metrics)return false;
    const current=flow.getViewport();
    const insets=options.reserveTop?{...metrics.insets,top:metrics.insets.top+options.reserveTop}:metrics.insets;
    const next=computeRevealViewport(rect,current,metrics,insets,options);
    if(!next)return false;
    void flow.setViewport(next,{duration:options.instant?0:cameraDuration(current,next,metrics),ease:cameraEase,interpolate:'linear'});
    return true;
  },[flow]);
  /**
   * Reveal cards; a batch that does not fit even at 50% reveals its first card instead. Two or more cards come up selected
   * with the selection bar above them (40 high + 7 tip + 10 gap + 8 margin, less the 24 the safe area keeps): the reveal
   * leaves that band free, so the bar sits over the batch instead of inside it (canvas-chrome round 4 §1.1).
   */
  const revealNodes=useCallback((ids:string[],options:{instant?:boolean}={})=>{
    const nodes=ids.map(id=>boardRef.current?.nodes.find(node=>node.id===id)).filter((node):node is BoardNode=>!!node);
    const rect=nodeBounds(nodes);const metrics=getCanvasMetrics();if(!rect||!metrics)return false;
    const reserveTop=nodes.length>1?SELECTION_BAR_BAND:0;
    const insets=reserveTop?{...metrics.insets,top:metrics.insets.top+reserveTop}:metrics.insets;
    const batch=nodes.length>1&&fitsAtZoom(rect,REVEAL_MIN_ZOOM,metrics,insets);
    const target=nodes.length>1&&!batch?nodeBounds(nodes.slice(0,1)):rect;
    return !!target&&revealRect(target,{...options,...(batch?{reserveTop}:{})});
  },[nodeBounds,revealRect]);
  /** Would these cards fit the safe area at 50%? (Import toasts point to "查看全部" when not.) */
  const batchFits=useCallback((nodes:BoardNode[])=>{const rect=nodeBounds(nodes);const metrics=getCanvasMetrics();return !rect||!metrics||fitsAtZoom(rect,REVEAL_MIN_ZOOM,metrics,metrics.insets);},[nodeBounds]);
  const revealStartArea=useCallback((boardId:string)=>{
    const current=boardRef.current;if(!current||current.id!==boardId)return;
    const cards=current.nodes.filter(node=>node.data.kind!=='frame');
    const cardRect=nodeBounds(cards.length?cards:current.nodes);
    // A tray's label sits 26 above its top edge (§6.15): the labels of trays holding these cards stay in view too.
    const trayNodes=current.nodes.filter(node=>node.data.kind==='frame'&&cards.some(card=>frameContainsCard(node,card,measurementsRef.current)));
    const trays=trayNodes.map(node=>getCardBounds(node,measurementsRef.current));
    const rect=cardRect&&trays.length?unionRects([cardRect,...trays.map(box=>({...box,y:box.y-26,height:box.height+26}))]):cardRect;
    // §5.5, W-M3: 100% when the start area fits, otherwise down to 85% so no column is cut off at the right edge
    // (the writing example at 1280×800 lost its draft and note); top aligned to the safe area, centred across.
    const metrics=getCanvasMetrics();
    if(!rect||!metrics)return;
    // CORE-22: a narrow window (1093×614 is 1366×768 at 125%) cannot show the whole start area even at 85%. First the
    // sidebar steps aside below 1280 wide; if the start area still does not fit, the draft and the excerpts it cites —
    // the finished work — are framed whole instead of being cut at the edge or hidden under the toolbar.
    const screen=visibleScreenRect(metrics,metrics.insets);
    const fitsWidth=rect.width*START_MIN_ZOOM<=screen.width+.5;
    if(!fitsWidth&&sidebarRef.current&&window.innerWidth<1280&&startCollapse.current!==boardId){
      // Finish the canvas-width change in this frame, before node-size observers
      // can flush a pending sidebar collapse during their own deeper delivery.
      startCollapse.current=boardId;flushSync(()=>setSidebar(false));
      requestAnimationFrame(()=>requestAnimationFrame(()=>revealStartAreaRef.current(boardId)));
      return;
    }
    let target=rect;
    if(!fitsWidth||rect.height*START_MIN_ZOOM>screen.height+24){
      const drafts=cards.filter(node=>node.data.kind==='draft');
      const cited=new Set(drafts.flatMap(node=>parseDraftReferences(node.data.body).map(reference=>reference.quoteNodeId).filter((id):id is string=>!!id)));
      // CORE-22 (round 3): a board of loose cards (writing, video) is composed card by card — the whole-percent zoom
      // (85–100%) and position that show the most whole cards, the draft and its excerpts first, and cut none at the
      // sides; what cannot fit only continues below.
      if(!trays.length){
        const composed=composeStartViewport(cards.map(node=>getVisibleCardBounds(node,measurementsRef.current,captionRulesRef?.current?.captionIds)),cards.flatMap((node,index)=>node.data.kind==='draft'||cited.has(node.id)?[index]:[]),metrics,metrics.insets,{overlays:getCanvasOverlayRects()});
        if(composed){void flow.setViewport(composed,{duration:0});return;}
      }else if(!drafts.length){
        // CORE-22 (round 4): a gallery opens on its first tray, whole — label, every picture and the tray's edge — instead
        // of 100% with its last row under the toolbar and the navigator (1000–1440 wide). A tray of pictures only may go
        // down to 60% (pictures read the same in the simple tier and the label keeps its size); others stop at 85%.
        const first=trayNodes.map((node,index)=>({node,box:trays[index]})).sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x)[0];
        const members=cards.filter(card=>frameContainsCard(first.node,card,measurementsRef.current));
        const pictures=members.length>0&&members.every(card=>card.data.kind==='image');
        const band=(zoom:number)=>TRAY_LABEL_BAND/(zoom<LOD_FULL_MIN?Math.max(.05,Math.floor(zoom*20+1e-6)/20):1);
        // At the floor (1093×614) the tray's bottom padding may pass the comfort line and the label may use half the top gap.
        const envelope=unionRects([first.box,...members.map(node=>getVisibleCardBounds(node,measurementsRef.current,captionRulesRef?.current?.captionIds))])!;
        const framed=framedStart(envelope,metrics,metrics.insets,{minZoom:pictures?GALLERY_MIN_ZOOM:START_MIN_ZOOM,give:TRAY_PADDING,headroom:12,band});
        if(framed){
          revealRect({...envelope,y:framed.top,height:envelope.y+envelope.height-framed.top},{zoom:framed.zoom,centerBias:.5,instant:true});
          return;
        }
      }
      const focus=nodeBounds([...drafts,...cards.filter(node=>cited.has(node.id))]);
      // Keep the whole start area when the finished work is complete in it anyway; frame the work itself otherwise.
      const whole=computeRevealViewport(rect,flow.getViewport(),metrics,metrics.insets,{zoom:startAreaZoom(rect,metrics,metrics.insets),centerBias:.5})??flow.getViewport();
      if(focus&&!rectContains(visibleFlowRect(whole,metrics,metrics.insets),focus))target=focus;
    }
    revealRect(target,{zoom:startAreaZoom(target,metrics,metrics.insets),centerBias:.5,instant:true});
  },[flow,nodeBounds,revealRect]);
  const revealStartAreaRef=useRef(revealStartArea);revealStartAreaRef.current=revealStartArea;
  // §5.5: the start area is sized from measured cards. Before React Flow measures them, cards without a stored height
  // count with fallback heights (note 440, video 520), so on a cold start the first frame often chose 100% and cut the
  // bottom row at 1366×768. Wait for every card's measurement, at most ~30 frames (cards outside the view never get one).
  const revealStartAreaWhenMeasured=useCallback((boardId:string)=>{
    let frames=0;
    setMeasureAll(true);
    const step=()=>{
      const current=boardRef.current;if(!current||current.id!==boardId){setMeasureAll(false);return;}
      const waiting=current.nodes.some(node=>node.data.kind!=='frame'&&!measurementsRef.current[node.id]);
      if(waiting&&++frames<30){requestAnimationFrame(step);return;}
      revealStartArea(boardId);
      // The sidebar may still step aside and compose again two frames later: keep every card rendered until then.
      requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
        setMeasureAll(false);
        const expected=flow.getViewport();
        void document.fonts.ready.then(()=>{
          if(boardRef.current?.id!==boardId)return;
          const current=flow.getViewport();
          // A user move while fonts load takes precedence over the first-open composition.
          if(current.x!==expected.x||current.y!==expected.y||current.zoom!==expected.zoom)return;
          const offset=readStartLineOffset();
          if(offset)void flow.setViewport({...current,y:current.y+offset},{duration:0});
        });
      })));
    };
    requestAnimationFrame(step);
  },[flow,revealStartArea]);
  /** Centre of the visible, unobstructed canvas in flow coordinates (safe area, §5.2). */
  const center=useCallback(()=>{const view=getVisibleFlowRect(flow.getViewport());return {x:view.x+view.width/2,y:view.y+view.height/2};},[flow]);
  const visibleView=useCallback(()=>getVisibleFlowRect(flow.getViewport()),[flow]);
  return {importToast,fitCanvas,revealRect,revealNodes,batchFits,revealStartAreaWhenMeasured,measureAll,center,visibleView};
}

/** A pending viewport follow (§5.5): applied two frames later, once the panel has narrowed the canvas. */
export function useRevealFollow({board,boardRef,canvasReveal,setCanvasReveal,inspectedId,view,revealNodes}:{
  board:Board|null;
  boardRef:RefObject<Board|null>;
  canvasReveal:CanvasRevealRequest|null;
  setCanvasReveal:Dispatch<SetStateAction<CanvasRevealRequest|null>>;
  inspectedId:string|null;
  view:CanvasView;
  revealNodes:(ids:string[],options?:{instant?:boolean})=>boolean;
}) {
  // Pending viewport follows wait two frames so they use the post-Inspector canvas width; a quick return,
  // board switch or close cancels them (returnToDraft then restores its own viewport).
  useEffect(()=>{
    const request=canvasReveal;
    if(!request||request.boardId!==board?.id||view!=='canvas')return;
    if(request.whenInspected&&request.whenInspected!==inspectedId)return;
    let nextFrame=0;
    const frame=requestAnimationFrame(()=>{nextFrame=requestAnimationFrame(()=>{
      setCanvasReveal(current=>current===request?null:current);
      if(boardRef.current?.id!==request.boardId)return;
      revealNodes(request.ids,{instant:request.instant});
      if(request.focus&&request.ids[0])focusCanvasNode(request.ids[0]);
    });});
    return()=>{cancelAnimationFrame(frame);cancelAnimationFrame(nextFrame);};
  },[board?.id,canvasReveal,focusCanvasNode,inspectedId,revealNodes,view]);
}
