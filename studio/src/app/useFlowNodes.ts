import { useMemo, useRef } from 'react';
import type { Node } from '@xyflow/react';
import type { Board, BoardNode, CardData } from '../model';
import { cardFacet, type LibraryFacet } from '../shell/MaterialsLibrary';
import { SELECTED_NODE_Z, nodeAriaLabel } from './studio-dom';
import { captionRules, PHOTO_CAPTION_HEIGHT, type CaptionRules } from './caption-rules';

/**
 * The React Flow nodes of the open board (CORE-32: moved out of App.tsx unchanged): each card with its selection,
 * facet dimming, accessible name and tray layering; unchanged cards keep their node object between renders.
 */
export function useFlowNodes({board,selectedIds,measurements,libraryFacet,imageRatioVersion,captions}:{
  board:Board|null;
  selectedIds:string[];
  measurements:Record<string,{width:number;height:number}>;
  libraryFacet:LibraryFacet;
  imageRatioVersion:number;
  captions?:CaptionRules;
}) {
  type Entry={node:BoardNode;measured:Node<CardData>['measured'];selected:boolean;dim:boolean;className:string;photoNumber?:string;value:Node<CardData>};
  const flowNodeCache=useRef<{boardId:string;entries:Map<string,Entry>}>({boardId:'',entries:new Map()});
  const rules=useMemo(()=>captions??captionRules(board?.nodes??[],measurements),[captions,board?.nodes,measurements,imageRatioVersion]);
  // React Flow raises a selected frame above its contents. Keep its wrapper
  // transparent to pointers; the title and resize handles remain interactive.
  const flowNodes=useMemo(()=>{
    if(!board)return [];
    const previous=flowNodeCache.current.boardId===board.id?flowNodeCache.current.entries:new Map<string,Entry>();
    const selected=new Set(selectedIds),entries=new Map<string,Entry>();
    const values=board.nodes.map(node=>{
      const measured=measurements[node.id],isSelected=selected.has(node.id);
      const dim=libraryFacet!=='all'&&node.data.kind!=='frame'&&cardFacet(node.data)!==libraryFacet;
      const flag=rules.flags.get(node.id),photoNumber=flag?.printNumber;
      const className=[dim&&'is-facet-dim',flag?.inTray&&'is-in-tray',flag?.tightCaption&&'has-tight-caption'].filter(Boolean).join(' ');
      const cached=previous.get(node.id);
      const entry=cached&&cached.node===node&&cached.measured===measured&&cached.selected===isSelected&&cached.dim===dim&&cached.className===className&&cached.photoNumber===photoNumber?cached:{node,measured,selected:isSelected,dim,className,photoNumber,value:{...node,className:className||undefined,ariaLabel:nodeAriaLabel(node.data),style:{...node.style,...(node.data.kind==='frame'?{pointerEvents:'none' as const}:{}),...(node.data.kind==='image'?{'--photo-caption-height':PHOTO_CAPTION_HEIGHT+'px'}:{}),...(photoNumber?{'--photo-number':JSON.stringify(photoNumber)}:{})},measured,selected:isSelected,dragHandle:'.card-drag, .card-drag-content',zIndex:node.data.kind==='frame'?(isSelected?-1-SELECTED_NODE_Z:-1):undefined}};
      entries.set(node.id,entry);return entry.value;
    });
    flowNodeCache.current={boardId:board.id,entries};return values;
  // A new nodes array after a picture ratio is learned (FC-01) lets the sidebar recount its groups.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[board?.id,board?.nodes,selectedIds,measurements,libraryFacet,imageRatioVersion,rules]);
  return flowNodes;
}
