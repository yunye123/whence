import { useCallback, useMemo, useRef, type RefObject } from 'react';
import type { Board } from '../model';
import { citationLocationLabel, paragraphIndexAt } from '../source-location';
import { frameContainsCard } from '../card-placement';
import { EMPTY_IDS, NO_MARKS } from './studio-dom';

/**
 * What cards read from the board besides their own data (CORE-32: moved out of App.tsx unchanged): excerpt marks and
 * locations, the lit source of a selected excerpt, tray member counts, and the stable set of card ids.
 */
export function useCardExtras({board,boardRef,selectedIds,measurements,imageRatioVersion,freshCardIds,readOnly,replaceMedia}:{
  board:Board|null;
  boardRef:RefObject<Board|null>;
  selectedIds:string[];
  measurements:Record<string,{width:number;height:number}>;
  imageRatioVersion:number;
  freshCardIds:ReadonlySet<string>;
  readOnly:boolean;
  replaceMedia:(id:string)=>void;
}) {
  const sourceIdsCache=useRef<{boardId:string;ids:ReadonlySet<string>}>({boardId:'',ids:new Set()});
  // Card capabilities (docs/redesign/integration/cards.md). Rebuilt only when an excerpt's citation or a
  // source's length changes (not on drags or title edits), so CardContext stays put while cards move.
  const excerptSignature=(board?.nodes??[]).map(node=>node.data.kind==='quote'&&node.data.citation
    ?`${node.id}:${node.data.citation.nodeId}:${node.data.citation.start??''}:${node.data.citation.end??''}:${node.data.citation.textAnchor?.from??''}:${node.data.citation.textAnchor?.to??''}`
    :node.data.kind==='note'||node.data.kind==='link'?`${node.id}#${node.data.body.length}`:'').join('|');
  const excerptIndex=useMemo(()=>{
    const nodes=boardRef.current?.nodes??[];
    const byId=new Map(nodes.map(node=>[node.id,node]));
    const marks=new Map<string,{quoteId?:string;start?:number;end?:number;from?:number;to?:number}[]>();
    const locations=new Map<string,string>();
    for(const quote of nodes){
      const citation=quote.data.kind==='quote'?quote.data.citation:undefined;if(!citation)continue;
      const anchor=citation.textAnchor;
      const list=marks.get(citation.nodeId)??[];
      list.push(citation.start!==undefined?{quoteId:quote.id,start:citation.start,end:citation.end}:{quoteId:quote.id,from:anchor?.from,to:anchor?.to});
      marks.set(citation.nodeId,list);
      const paragraph=anchor?paragraphIndexAt(byId.get(citation.nodeId)?.data.body,anchor.from):undefined;
      const label=citationLocationLabel(citation,paragraph);
      if(label)locations.set(quote.id,label);
    }
    return {marks,locations};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[board?.id,excerptSignature]);
  const sourceParagraph=useCallback((nodeId:string,offset:number)=>paragraphIndexAt(boardRef.current?.nodes.find(node=>node.id===nodeId)?.data.body,offset),[]);
  // Selecting exactly one excerpt lights its source (§6.8).
  const litSourceId=(()=>{if(selectedIds.length!==1)return '';const quote=board?.nodes.find(node=>node.id===selectedIds[0]);return quote?.data.kind==='quote'?quote.data.citation?.nodeId??'':'';})();
  const litSourceIds=useMemo<ReadonlySet<string>>(()=>litSourceId?new Set([litSourceId]):EMPTY_IDS,[litSourceId]);
  // Tray label counts: ordinary cards wholly inside (the same rule as dragging a group, K9-6); the map only changes with a count.
  const frameCountKey=useMemo(()=>{const nodes=board?.nodes??[];const frames=nodes.filter(node=>node.data.kind==='frame');return frames.map(frame=>`${frame.id}=${nodes.filter(node=>frameContainsCard(frame,node,measurements)).length}`).join('|');
  // imageRatioVersion: a picture ratio learned since (FC-01) can change who is inside.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[board?.nodes,measurements,imageRatioVersion]);
  const frameCounts=useMemo(()=>new Map(frameCountKey?frameCountKey.split('|').map(entry=>{const at=entry.lastIndexOf('=');return [entry.slice(0,at),Number(entry.slice(at+1))] as const;}):[]),[frameCountKey]);
  const cardExtras=useMemo(()=>({
    sourceParagraph,
    quoteLocation:(id:string)=>excerptIndex.locations.get(id),
    excerptMarks:(id:string)=>excerptIndex.marks.get(id)??NO_MARKS,
    freshCardIds,
    litSourceIds,
    frameMemberCount:(id:string)=>frameCounts.get(id),
    replaceMedia:readOnly?undefined:replaceMedia,
  }),[excerptIndex,freshCardIds,frameCounts,litSourceIds,sourceParagraph,readOnly,replaceMedia]);
  const sourceNodeIds=useMemo(()=>{const previous=sourceIdsCache.current;const nodes=board?.nodes??[];if(previous.boardId===(board?.id??'')&&previous.ids.size===nodes.length&&nodes.every(node=>previous.ids.has(node.id)))return previous.ids;const ids=new Set(nodes.map(node=>node.id));sourceIdsCache.current={boardId:board?.id??'',ids};return ids;},[board?.id,board?.nodes]);
  return {cardExtras,frameCounts,sourceNodeIds};
}
