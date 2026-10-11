import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Board, CardKind, Workspace } from '../model';
import { safeUrl } from '../board-utils';
import { isCardControlTarget } from '../card-interaction';
import { isNative } from '../native';
import type { ToastOptions } from '../shell/Toasts';
import type { CanvasTool, CanvasView, Modal } from './types';
import { editableTarget, errorMessage } from './utils';

// Window-wide keys, paste and drops (CORE-32: moved out of App.tsx unchanged).

/** CORE-16: whether the last input was the keyboard (an open from Enter or a focused button moves focus into the panel). */
export function useKeyboardModality() {
  // CORE-16: whether the last input was the keyboard (an open from Enter or a focused button moves focus into the panel).
  const keyboardInput=useRef(false);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{if(!event.ctrlKey&&!event.metaKey)keyboardInput.current=true;};
    const pointer=()=>{keyboardInput.current=false;};
    window.addEventListener('keydown',key,true);window.addEventListener('pointerdown',pointer,true);
    return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('pointerdown',pointer,true);};
  },[]);
  return keyboardInput;
}

/** Hold Space to pan (the hand tool while it is held), except in fields, card controls and dialogs. */
export function useSpacePan({modal,view,setPanPressed}:{modal:Modal;view:CanvasView;setPanPressed:Dispatch<SetStateAction<boolean>>}) {
  useEffect(()=>{
    setPanPressed(false);
    const down=(event:KeyboardEvent)=>{if(event.code==='Space'&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.isComposing&&!modal&&view==='canvas'&&!editableTarget(event.target)&&!isCardControlTarget(event.target)){event.preventDefault();event.stopPropagation();setPanPressed(true);}};
    const up=(event:KeyboardEvent)=>{if(event.code==='Space')setPanPressed(false);};
    const reset=()=>setPanPressed(false);
    window.addEventListener('keydown',down,true);window.addEventListener('keyup',up,true);window.addEventListener('blur',reset);
    return()=>{window.removeEventListener('keydown',down,true);window.removeEventListener('keyup',up,true);window.removeEventListener('blur',reset);};
  },[modal,view]);
}

/**
 * Window-wide shortcuts and paste (K9-11, KB-M1, CORE-15): links open in the system browser on the desktop, files dropped
 * outside the canvas never navigate away, Ctrl+S saves at once, Esc leaves one layer at a time, and the canvas keys.
 */
export function useGlobalShortcuts({effectiveTool,notify,readOnlyRef,readOnly,workspaceRef,persist,saveVersion,modal,setModal,contextMenu,setContextMenu,creatingBoard,xRun,closeModal,inspectedId,closeInspector,selectedIds,setSelectedIds,selectedEdgeIds,setSelectedEdgeIds,recoveryPrompt,importFiles,pasteText,pasteFromMenu,undo,groupSelection,duplicateCardAction,deleteCards,changeBoard,addCard,setTool,view,setView,fitCanvas,boardRef}:{
  effectiveTool:CanvasTool;
  notify:(message:string,options?:ToastOptions)=>void;
  readOnlyRef:RefObject<boolean>;
  readOnly:boolean;
  workspaceRef:RefObject<Workspace|null>;
  persist:(value:Workspace,version:number,silent?:boolean)=>Promise<void>;
  saveVersion:RefObject<number>;
  modal:Modal;
  setModal:Dispatch<SetStateAction<Modal>>;
  contextMenu:{x:number;y:number}|null;
  setContextMenu:Dispatch<SetStateAction<{x:number;y:number}|null>>;
  creatingBoard:boolean;
  xRun:RefObject<{controller:AbortController;requestId:string;committing:boolean}|null>;
  closeModal:()=>void;
  inspectedId:string|null;
  closeInspector:()=>void;
  selectedIds:string[];
  setSelectedIds:Dispatch<SetStateAction<string[]>>;
  selectedEdgeIds:string[];
  setSelectedEdgeIds:Dispatch<SetStateAction<string[]>>;
  recoveryPrompt:unknown;
  importFiles:(files:File[],point?:{x:number;y:number})=>Promise<void>;
  pasteText:(text:string)=>void;
  pasteFromMenu:()=>Promise<void>;
  undo:(redo?:boolean)=>void;
  groupSelection:(ids:string[])=>void;
  duplicateCardAction:(id:string)=>void;
  deleteCards:(ids:string[])=>void;
  changeBoard:(fn:(value:Board)=>Board,options?:{history?:boolean;key?:string})=>boolean;
  addCard:(kind:CardKind,position?:{x:number;y:number})=>unknown;
  setTool:Dispatch<SetStateAction<CanvasTool>>;
  view:CanvasView;
  setView:Dispatch<SetStateAction<CanvasView>>;
  fitCanvas:(duration?:number,ids?:string[])=>void;
  boardRef:RefObject<Board|null>;
}) {
  useEffect(()=>{
    if(!isNative())return;
    const open=(event:MouseEvent)=>{const anchor=(event.target as Element)?.closest?.('a[href]');if(!(anchor instanceof HTMLAnchorElement)||event.defaultPrevented)return;if(anchor.closest('.react-flow__node')&&(event.shiftKey||effectiveTool==='hand')){event.preventDefault();return;}const url=safeUrl(anchor.href);if(!url)return;event.preventDefault();void window.studio.openExternal(url).catch(error=>notify(`打开来源失败：${errorMessage(error)}`));};
    document.addEventListener('click',open,true);return()=>document.removeEventListener('click',open,true);
  },[notify,effectiveTool]);
  // RL-m5: a file dropped outside the canvas must not make the browser navigate away to it.
  useEffect(()=>{
    const guard=(event:DragEvent)=>{
      if(!event.dataTransfer?.types.includes('Files')||event.defaultPrevented)return;
      event.preventDefault();
      if(event.type==='dragover')event.dataTransfer.dropEffect='none';
    };
    window.addEventListener('dragover',guard);window.addEventListener('drop',guard);
    return()=>{window.removeEventListener('dragover',guard);window.removeEventListener('drop',guard);};
  },[]);
  /**
   * CORE-15: Ctrl/⌘+S saves at once from anywhere — also from a note, a title or a dialog field, where the panel stops
   * other keys — and never opens the browser's “save page”. Captured before any panel handler. A read-only window
   * writes nothing (K1); the draft editor shows its own “已保存” in its footer.
   */
  useEffect(()=>{
    const save=(e:KeyboardEvent)=>{
      if(!(e.ctrlKey||e.metaKey)||e.altKey||e.key.toLowerCase()!=='s'||e.isComposing||e.keyCode===229)return;
      e.preventDefault();
      if(readOnlyRef.current){notify('这是只读窗口，修改请在正在编辑的窗口完成。',{tone:'info',key:'save-shortcut'});return;}
      const current=workspaceRef.current;if(!current)return;
      void persist(current,saveVersion.current).then(()=>{if(!(e.target as Element|null)?.closest?.('.cm-editor'))notify('已保存到本机',{tone:'success',duration:1600,key:'save-shortcut'});}).catch(()=>{});
    };
    window.addEventListener('keydown',save,true);return()=>window.removeEventListener('keydown',save,true);
  },[notify,persist]);
  useEffect(()=>{
    const paste=(e:ClipboardEvent)=>{
      if(editableTarget(e.target)||modal||readOnly)return;
      const files=Array.from(e.clipboardData?.files??[]);if(files.length){e.preventDefault();void importFiles(files);return;}
      const text=e.clipboardData?.getData('text/plain').trim();if(text){e.preventDefault();pasteText(text);}
    };
    const key=(e:KeyboardEvent)=>{
      if(e.isComposing||e.keyCode===229)return;
      if(e.key==='Escape'&&document.fullscreenElement)return;
      // Esc leaves one layer at a time (KB-M1): dialog → context menu → a focused field loses focus → panel.
      if(e.key==='Escape'){
        if(creatingBoard||xRun.current?.committing)return;
        if(modal){closeModal();return;}
        if(contextMenu){setContextMenu(null);return;}
        if(e.target instanceof HTMLElement&&editableTarget(e.target)){e.target.blur();return;}
        if(inspectedId)closeInspector();
        else if(selectedIds.length||selectedEdgeIds.length){setSelectedIds([]);setSelectedEdgeIds([]);}
        return;
      }
      const mod=e.ctrlKey||e.metaKey;
      // RL-m1: an open dialog (for example, a board being created) is never replaced by search.
      if(mod&&e.key.toLowerCase()==='k'){e.preventDefault();if(!xRun.current&&(!modal||modal==='search')&&!recoveryPrompt)setModal('search');return;}
      // Ctrl N: a new board (the desktop app receives it; browsers keep Ctrl N for a new window).
      if(mod&&!e.shiftKey&&!e.altKey&&e.key.toLowerCase()==='n'){if(!modal&&!xRun.current&&!readOnlyRef.current){e.preventDefault();setModal('new');}return;}
      if(editableTarget(e.target)||(e.target as Element)?.closest?.('video,audio')||modal)return;
      if(mod&&e.key.toLowerCase()==='v'&&window.fieldLocalFiles&&!readOnly){e.preventDefault();void pasteFromMenu();return;}
      if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();undo(e.shiftKey);return;}
      if(mod&&e.key.toLowerCase()==='y'){e.preventDefault();undo(true);return;}
      if(mod&&!e.shiftKey&&e.key.toLowerCase()==='g'){e.preventDefault();if(selectedIds.length&&!readOnlyRef.current)groupSelection(selectedIds);return;}
      if(mod&&e.key.toLowerCase()==='d'){e.preventDefault();selectedIds.forEach(duplicateCardAction);return;}
      // CV-m2: on the canvas Ctrl+A selects every card instead of all the page text.
      if(mod&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='a'){if(view!=='canvas'||!boardRef.current)return;e.preventDefault();setSelectedIds(boardRef.current.nodes.map(node=>node.id));setSelectedEdgeIds([]);setContextMenu(null);return;}
      if(e.key==='Delete'||e.key==='Backspace'){if((e.target as HTMLElement)?.closest?.('button,a'))return;e.preventDefault();if(selectedIds.length)deleteCards(selectedIds);if(selectedEdgeIds.length)changeBoard(b=>({...b,edges:b.edges.filter(edge=>!selectedEdgeIds.includes(edge.id))}));return;}
      if(!mod&&!e.altKey){switch(e.key.toLowerCase()){case'n':addCard('note');break;case't':addCard('draft');break;case'v':setTool('select');break;case'h':setTool('hand');break;case'f':setView('canvas');requestAnimationFrame(()=>void fitCanvas());break;case'?':setModal('help');break;}}
    };
    window.addEventListener('keydown',key);window.addEventListener('paste',paste);return()=>{window.removeEventListener('keydown',key);window.removeEventListener('paste',paste);};
  },[modal,contextMenu,creatingBoard,readOnly,importFiles,changeBoard,closeInspector,closeModal,notify,undo,selectedIds,selectedEdgeIds,duplicateCardAction,deleteCards,addCard,fitCanvas,persist,pasteText,pasteFromMenu,groupSelection,inspectedId,recoveryPrompt,view]);
}

