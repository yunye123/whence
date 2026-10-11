import { applyNodeChanges, type Node, type NodeChange } from '@xyflow/react';
import type { BoardNode, CardData } from '../model';
import { MAX_CARD_SIZE } from '../card-size';

export function isSubstantiveNodeChange(change:NodeChange<Node<CardData>>):boolean {
  // Explicit false is the resize-end event, which must commit its own undo snapshot.
  return change.type!=='select'&&!(change.type==='dimensions'&&change.resizing===undefined&&!change.setAttributes);
}

/** Keep unchanged cards shared, and move frame contents without mutating history. */
export function applyCanvasNodeChanges(nodes:BoardNode[],changes:NodeChange<Node<CardData>>[],frames:{frameId:string;origin:{x:number;y:number};nodes:BoardNode[]}[]=[]):BoardNode[] {
  const originals=new Map(nodes.map(node=>[node.id,node]));
  const constrained=changes.map(change=>{
    if(change.type!=='dimensions'||!change.dimensions||!change.setAttributes)return change;
    const original=originals.get(change.id);
    const bound=(value:number,fallback:number)=>Number.isFinite(value)?Math.max(40,Math.min(MAX_CARD_SIZE,value)):fallback;
    return {...change,dimensions:{width:change.setAttributes===true||change.setAttributes==='width'?bound(change.dimensions.width,original?.style?.width??290):change.dimensions.width,height:change.setAttributes===true||change.setAttributes==='height'?bound(change.dimensions.height,original?.style?.height??440):change.dimensions.height}};
  });
  const changed=applyNodeChanges(constrained,nodes as Node<CardData>[]).map(node=>{
    const original=originals.get(node.id);
    if(node===original)return original;
    return {id:node.id,type:'card' as const,position:node.position,data:node.data,style:node.width||node.height?{...(node.style as BoardNode['style']),...(node.width?{width:node.width}:{}),...(node.height?{height:node.height}:{})}:node.style as BoardNode['style']};
  });
  const positions=new Map<string,{x:number;y:number}>();
  for(const group of frames){const movement=changes.find(change=>change.type==='position'&&change.id===group.frameId);if(movement?.type==='position'&&movement.position){const dx=movement.position.x-group.origin.x,dy=movement.position.y-group.origin.y;for(const original of group.nodes)positions.set(original.id,{x:original.position.x+dx,y:original.position.y+dy});}}
  return changed.map(node=>{const position=positions.get(node.id);return position&&(position.x!==node.position.x||position.y!==node.position.y)?{...node,position}:node;});
}
