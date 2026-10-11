import { useCallback, useRef, useState, type RefObject } from 'react';
import type { Board, Workspace } from '../model';
import { validateBoard } from '../storage';
import type { ToastOptions } from '../shell/Toasts';
import { clone, errorMessage } from './utils';

/**
 * Undo history per board and the one way to change the open board (CORE-32: moved out of App.tsx unchanged): every
 * edit goes through `changeBoard` (validated, one undo step unless `history:false`; quick typing merges into one step).
 */
export function useBoardHistory({workspaceRef,boardRef,readOnly,notify,setNext}:{
  workspaceRef:RefObject<Workspace|null>;
  boardRef:RefObject<Board|null>;
  readOnly:boolean;
  notify:(message:string,options?:ToastOptions)=>void;
  setNext:(next:Workspace)=>void;
}) {
  const history=useRef(new Map<string,{past:Board[];future:Board[];key:string;time:number}>());
  const [,setHistoryVersion]=useState(0);
  const pushHistory=useCallback((old:Board,key='command')=>{
    const h=history.current.get(old.id)??{past:[],future:[],key:'',time:0};
    if(key!=='edit'||h.key!==key||Date.now()-h.time>800){h.past.push(clone(old));if(h.past.length>60)h.past.shift();}
    h.future=[];h.key=key;h.time=Date.now();history.current.set(old.id,h);setHistoryVersion(v=>v+1);
  },[]);
  const changeBoard=useCallback((fn:(value:Board)=>Board,options:{history?:boolean;key?:string}={})=>{
    if(readOnly){notify('另一个窗口正在编辑。请关闭它，再重新载入此窗口。');return false;}
    const current=workspaceRef.current;if(!current)return false;
    const old=current.boards.find(b=>b.id===current.activeBoardId);if(!old)return false;
    const next=fn(old);if(next===old)return false;
    if(options.history!==false){try{validateBoard(next);}catch(error){notify(`这次修改未保存：${errorMessage(error)}`);return false;}}
    if(options.history!==false)pushHistory(old,options.key);
    setNext({...current,boards:current.boards.map(b=>b.id===old.id?{...next,updatedAt:new Date().toISOString()}:b)});
    return true;
  },[notify,pushHistory,readOnly,setNext]);
  const undo=useCallback((redo=false)=>{
    if(readOnly)return;
    const current=workspaceRef.current;const b=boardRef.current;if(!current||!b)return;
    const h=history.current.get(b.id);if(!h)return;
    const next=redo?h.future.pop():h.past.pop();if(!next)return;
    (redo?h.past:h.future).push(clone(b));h.key='';
    setNext({...current,boards:current.boards.map(item=>item.id===b.id?{...next,updatedAt:new Date().toISOString()}:item)});setHistoryVersion(v=>v+1);
  },[readOnly,setNext]);
  /**
   * “撤销” on a toast reverses exactly that change: while the board's cards and lines are untouched since, it is
   * the canvas undo; otherwise `fallback` reverses only that change on the same board (the history stays).
   */
  const undoChange=useCallback((boardId:string,fallback:(board:Board)=>Board)=>{
    const after=workspaceRef.current?.boards.find(item=>item.id===boardId);
    return ()=>{
      const current=workspaceRef.current;if(!current||current.activeBoardId!==boardId)return;
      const now=current.boards.find(item=>item.id===boardId);
      if(after&&now&&now.nodes===after.nodes&&now.edges===after.edges)undo();else changeBoard(fallback);
    };
  },[changeBoard,undo]);
  return {history,pushHistory,changeBoard,undo,undoChange};
}
