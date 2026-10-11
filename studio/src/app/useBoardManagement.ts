import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Board, TemplateId, Workspace } from '../model';
import { uid } from '../model';
import { saveWorkspace, importBoard, exportBoard, openLocalBoard, validateBoard, validateWorkspace, STORAGE_LIMITS } from '../storage';
import { createBoard, createExampleBoard, EXAMPLES, type ExampleId } from '../templates';
import type { DirectoryChoice, BoardRecoveryAvailable } from '../../native/board-storage';
import type { VideoPlaybackSession } from '../video-playback';
import type { LibraryFacet } from '../shell/MaterialsLibrary';
import type { ToastOptions } from '../shell/Toasts';
import type { CanvasRevealRequest, CanvasView, Modal } from './types';
import { errorMessage } from './utils';
import { WELCOME_KEY, focusCanvasStart } from './studio-dom';

/**
 * The boards of the workspace (CORE-32: moved out of App.tsx unchanged): switch, create (template, folder), import,
 * duplicate, rename, the first-run examples and welcome (§6.24), and reopening a board folder with its recovery prompt.
 */
export function useBoardManagement({workspaceRef,boardRef,readOnlyRef,readOnly,busyRef,setBusy,setWorkspace,setNext,saveQueue,initialRevealBoard,revealStartAreaWhenMeasured,notify,changeBoard,clearDraftNavigation,playbackRequest,playbackSession,setSelectedIds,setSelectedEdgeIds,setInspectedId,setActiveVideo,setLibraryFacet,setGroupPicker,setView,setModal,setCanvasReveal}:{
  workspaceRef:RefObject<Workspace|null>;
  boardRef:RefObject<Board|null>;
  readOnlyRef:RefObject<boolean>;
  readOnly:boolean;
  busyRef:RefObject<string>;
  setBusy:Dispatch<SetStateAction<string>>;
  setWorkspace:Dispatch<SetStateAction<Workspace|null>>;
  setNext:(next:Workspace)=>void;
  saveQueue:RefObject<Promise<void>>;
  initialRevealBoard:RefObject<string|null>;
  revealStartAreaWhenMeasured:(boardId:string)=>void;
  notify:(message:string,options?:ToastOptions)=>void;
  changeBoard:(fn:(value:Board)=>Board,options?:{history?:boolean;key?:string})=>boolean;
  clearDraftNavigation:()=>void;
  playbackRequest:RefObject<number>;
  playbackSession:RefObject<VideoPlaybackSession>;
  setSelectedIds:Dispatch<SetStateAction<string[]>>;
  setSelectedEdgeIds:Dispatch<SetStateAction<string[]>>;
  setInspectedId:Dispatch<SetStateAction<string|null>>;
  setActiveVideo:Dispatch<SetStateAction<string|null>>;
  setLibraryFacet:Dispatch<SetStateAction<LibraryFacet>>;
  setGroupPicker:Dispatch<SetStateAction<{cardId:string;anchor:HTMLElement|{x:number;y:number}}|null>>;
  setView:Dispatch<SetStateAction<CanvasView>>;
  setModal:Dispatch<SetStateAction<Modal>>;
  setCanvasReveal:Dispatch<SetStateAction<CanvasRevealRequest|null>>;
}) {
  const [recoveryPrompt,setRecoveryPrompt]=useState<BoardRecoveryAvailable|null>(null);
  const recoveryDecision=useRef<((value:boolean)=>void)|null>(null);
  const [boardName,setBoardName]=useState('');
  const [boardDirectory,setBoardDirectory]=useState<DirectoryChoice|null>(null);
  const [directoryError,setDirectoryError]=useState('');
  const [creatingBoard,setCreatingBoard]=useState(false);
  // The new-board dialog does not lean towards any one kind of creator (F-M1).
  const [chosenTemplate,setChosenTemplate]=useState<TemplateId>('blank');
  const [welcome,setWelcome]=useState(()=>{try{return localStorage.getItem(WELCOME_KEY)!=='seen';}catch{return false;}});
  const switchBoard=useCallback((id:string)=>{const current=workspaceRef.current;if(!current||id===current.activeBoardId||!current.boards.some(item=>item.id===id))return;setCanvasReveal(null);clearDraftNavigation();playbackRequest.current++;playbackSession.current.handoff();const next={...current,activeBoardId:id};if(readOnlyRef.current){workspaceRef.current=next;setWorkspace(next);}else setNext(next);setSelectedIds([]);setInspectedId(null);setActiveVideo(null);setLibraryFacet('all');setGroupPicker(null);},[clearDraftNavigation,setNext]);
  const changeWorkspace=useCallback((change:(current:Workspace)=>Workspace)=>{
    if(readOnlyRef.current)return;
    const current=workspaceRef.current;if(!current)return;
    try { const next=validateWorkspace(change(current));if(next.activeBoardId!==current.activeBoardId){clearDraftNavigation();playbackRequest.current++;playbackSession.current.handoff();setInspectedId(null);setActiveVideo(null);setSelectedIds([]);setSelectedEdgeIds([]);setView('canvas');}setNext(next); }
    catch(error){notify(errorMessage(error));}
  },[clearDraftNavigation,notify,setNext]);
  const chooseBoardDirectory=useCallback(async()=>{
    if(!window.fieldBoardStorage)return;
    setDirectoryError('');try{const chosen=await window.fieldBoardStorage.chooseDirectory();if(chosen)setBoardDirectory(chosen);}catch(error){setDirectoryError(errorMessage(error));}
  },[]);
  const addBoard=useCallback(async(template:TemplateId)=>{
    if(readOnly||creatingBoard)return;
    const b=createBoard(template);if(boardName.trim())b.title=boardName.trim();
    const current=workspaceRef.current;if(!current)return;
    if(current.boards.length>=STORAGE_LIMITS.boards){notify('这个本机工作区已达到 100 张画布，请先导出整理。');return;}
    setCreatingBoard(true);setDirectoryError('');
    try{
    if(boardDirectory){if(!window.fieldBoardStorage)throw new Error('自定义目录需要来处桌面版。');b.storage=await window.fieldBoardStorage.create(boardDirectory.id,b);}
    const latest=workspaceRef.current;if(!latest||readOnlyRef.current)throw new Error('工作区暂时无法创建画布。');
    if(b.nodes.length)initialRevealBoard.current=b.id;
    clearDraftNavigation();playbackRequest.current++;playbackSession.current.handoff();setNext({...latest,activeBoardId:b.id,boards:[...latest.boards,b]});setModal(null);setBoardName('');setBoardDirectory(null);setInspectedId(null);setActiveVideo(null);setSelectedIds([]);setView('canvas');notify(b.storage?'新画布已创建，内容将保存到所选文件夹':'新画布已创建');focusCanvasStart();
    }catch(error){setDirectoryError(errorMessage(error));}finally{setCreatingBoard(false);}
  },[boardName,boardDirectory,creatingBoard,clearDraftNavigation,notify,readOnly,setNext]);
  const insertBoard=useCallback((b:Board,message:string|null='画布已导入')=>{const w=workspaceRef.current;if(!w||readOnlyRef.current)return;if(w.boards.length>=STORAGE_LIMITS.boards){notify('这个工作区已达到 100 张画布，请先导出整理。');return;}if(w.boards.some(item=>item.id===b.id))b={...b,id:uid()};try{validateBoard(b);}catch(error){notify(`画布未导入：${errorMessage(error)}`);return;}clearDraftNavigation();playbackRequest.current++;playbackSession.current.handoff();setNext({...w,boards:[...w.boards,b],activeBoardId:b.id});setModal(null);setInspectedId(null);setActiveVideo(null);setSelectedIds([]);setSelectedEdgeIds([]);if(message)notify(message);},[clearDraftNavigation,notify,setNext]);
  /** Board “…” menu → 复制画布: the tested package export/import path remaps ids, citations and media (SB-m1). */
  const duplicateBoard=useCallback(async(id:string)=>{
    const source=workspaceRef.current?.boards.find(item=>item.id===id);
    if(!source||readOnlyRef.current||busyRef.current)return;
    const title=`${source.title||'未命名画布'} 副本`;
    setBusy('正在复制画布…');
    try{
      const copy=await importBoard(new File([await exportBoard(source)],`${source.title||'画布'}.field.json`,{type:'application/json'}));
      insertBoard({...copy,title,groupId:source.groupId,storage:undefined},`已复制为「${title}」`);
    }catch(error){notify(`复制失败：${errorMessage(error)}`);}
    finally{setBusy('');}
  },[insertBoard,notify]);
  /** Board “…” menu → 重命名: the current board's name is one undo step; another board's name changes in place. */
  const renameBoard=useCallback((id:string,title:string)=>{
    if(id===boardRef.current?.id)changeBoard(b=>({...b,title}));
    else changeWorkspace(w=>({...w,boards:w.boards.map(b=>b.id===id?{...b,title,updatedAt:new Date().toISOString()}:b)}));
  },[changeBoard,changeWorkspace]);
  const dismissWelcome=useCallback(()=>{try{localStorage.setItem(WELCOME_KEY,'seen');}catch{/* Blocked storage: the welcome shows again next launch. */}setWelcome(false);},[]);
  /** Welcome entries (§6.24): open the example board; the untouched copy from the first launch is reused, not duplicated. */
  const openExample=useCallback((id:ExampleId)=>{
    const info=EXAMPLES.find(item=>item.id===id);const current=workspaceRef.current;if(!info||!current)return;
    const existing=current.boards.find(item=>item.title===info.title&&item.nodes.length>0&&item.nodes.every(node=>node.data.demo));
    if(existing){
      if(existing.id!==current.activeBoardId)switchBoard(existing.id);
      // Welcome can reuse the active example. Compose again after its overlay closes,
      // when the actual canvas width and loaded card faces can be measured.
      requestAnimationFrame(()=>requestAnimationFrame(()=>revealStartAreaWhenMeasured(existing.id)));
    }
    else{const created=createExampleBoard(id);initialRevealBoard.current=created.id;insertBoard(created,null);}
    dismissWelcome();focusCanvasStart();
  },[dismissWelcome,insertBoard,switchBoard,revealStartAreaWhenMeasured]);
  const decideRecovery=useCallback((accepted:boolean)=>{const resolve=recoveryDecision.current;recoveryDecision.current=null;setRecoveryPrompt(null);resolve?.(accepted);},[]);
  const confirmRecovery=useCallback((info:BoardRecoveryAvailable)=>new Promise<boolean>(resolve=>{recoveryDecision.current?.(false);recoveryDecision.current=resolve;setRecoveryPrompt(info);}),[]);
  useEffect(()=>()=>{recoveryDecision.current?.(false);},[]);
  const reconnectLocalBoard=useCallback(()=>{
    if(readOnlyRef.current||busyRef.current)return;
    setBusy('正在打开本机画布…');
    void (async()=>{await saveQueue.current.catch(()=>{});if(workspaceRef.current)await saveWorkspace(workspaceRef.current,{folders:false});return openLocalBoard(workspaceRef.current??undefined,{onRecovery:confirmRecovery});})().then(value=>{
      if(!value)return;
      const current=workspaceRef.current;const existing=current?.boards.find(item=>item.id===value.id);
      if(existing){changeWorkspace(w=>({...w,activeBoardId:value.id,boards:w.boards.map(item=>item.id===value.id?{...item,storage:value.storage,nodes:item.nodes.map(node=>node.data.url?.startsWith('field-media:')?{...node,data:{...node.data,url:`field-media://${value.storage!.id}/${new URL(node.data.url).pathname.slice(1)}`}}:node)}:item)}));setModal(null);notify('画布已打开，当前编辑已保留');}
      else insertBoard(value);
    }).catch(error=>notify(errorMessage(error))).finally(()=>setBusy(''));
  },[changeWorkspace,confirmRecovery,insertBoard,notify]);
  return {switchBoard,changeWorkspace,chooseBoardDirectory,addBoard,insertBoard,duplicateBoard,renameBoard,dismissWelcome,openExample,decideRecovery,reconnectLocalBoard,recoveryPrompt,welcome,boardName,setBoardName,boardDirectory,setBoardDirectory,directoryError,setDirectoryError,creatingBoard,chosenTemplate,setChosenTemplate};
}
