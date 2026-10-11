import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Viewport } from '@xyflow/react';
import type { Workspace } from '../model';
import { loadWorkspace, saveWorkspace, mergeFolderMedia } from '../storage';
import { createExampleBoard } from '../templates';
import type { SaveStatus } from './types';
import { errorMessage } from './utils';

/**
 * The workspace and its saving (K1, CORE-32: moved out of App.tsx unchanged): load once, debounced save (250 ms) through
 * one queue, a quiet save for viewport-only changes, the close guard, and the single-writer lock
 * (navigator.locks 'field-workspace-writer'): a second window is read-only and never writes.
 */
export function useWorkspaceStore({busyRef,pendingTranscriptEdits,initialRevealBoard}:{
  busyRef:RefObject<string>;
  pendingTranscriptEdits:RefObject<Set<string>>;
  initialRevealBoard:RefObject<string|null>;
}) {
  const [workspace, setWorkspace] = useState<Workspace|null>(null);
  const workspaceRef = useRef<Workspace|null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [saveError, setSaveError] = useState('');
  const saveQueue = useRef(Promise.resolve());
  const saveVersion = useRef(0); const savedVersion = useRef(0);
  // Content changes show "保存中"; a viewport-only change is saved silently (m-03, RL-M2).
  const visibleChange = useRef(false);
  // Version of the latest content change: only content still unsaved warns before closing, never a pending viewport.
  const contentVersion = useRef(0);
  const writerLockResolved=useRef(!navigator.locks);
  const [readOnly,setReadOnly]=useState(!!navigator.locks);
  const readOnlyRef=useRef(!!navigator.locks);
  const [loadError,setLoadError]=useState('');
  const persist=useCallback((value:Workspace,version:number,silent=false)=>{
    if(readOnlyRef.current)return Promise.resolve();
    if(!silent)setSaveStatus('saving');
    const operation=saveQueue.current.catch(()=>{}).then(()=>saveWorkspace(value,{onNormalized:(before,saved)=>{const current=workspaceRef.current;if(!current)return;const next=mergeFolderMedia(current,before,saved);if(next!==current){workspaceRef.current=next;setWorkspace(next);}}}));
    saveQueue.current=operation;
    void operation.then(()=>{savedVersion.current=version;if(saveVersion.current===version){setSaveStatus('saved');setSaveError('');}},error=>{setSaveStatus('error');setSaveError(errorMessage(error));});
    return operation;
  },[]);
  const setNext=useCallback((next:Workspace)=>{if(readOnlyRef.current)return;workspaceRef.current=next;setWorkspace(next);saveVersion.current++;contentVersion.current=saveVersion.current;visibleChange.current=true;setSaveStatus('saving');},[]);
  /**
   * Viewport-only change (pan, zoom, reveal): saved quietly, without touching `updatedAt` (RL-M2), without the
   * "保存中" flash (m-03), and never in a read-only window, which therefore no longer warns on every move (RL-M1).
   */
  const saveViewport=useCallback((boardId:string,viewport:Viewport)=>{
    if(readOnlyRef.current||![viewport.x,viewport.y,viewport.zoom].every(Number.isFinite))return;
    const current=workspaceRef.current;const target=current?.boards.find(item=>item.id===boardId);if(!current||!target)return;
    const saved=target.viewport;if(saved.x===viewport.x&&saved.y===viewport.y&&saved.zoom===viewport.zoom)return;
    const next={...current,boards:current.boards.map(item=>item.id===boardId?{...item,viewport:{x:viewport.x,y:viewport.y,zoom:viewport.zoom}}:item)};
    workspaceRef.current=next;setWorkspace(next);saveVersion.current++;
  },[]);
  useEffect(()=>{
    let active=true;
    void loadWorkspace().then(value=>{
      if(!active)return;
      // First launch opens the video example (0/6/13 s subtitles, K1) behind the welcome (§6.24, EXAMPLE_CONTENT §8.4).
      const demo=createExampleBoard('video');
      const initial=value??{schema:1 as const,activeBoardId:demo.id,boards:[demo]};
      if(!value)initialRevealBoard.current=demo.id;
      const needsSync=!value||initial.boards.some(item=>!!item.storage);
      if(needsSync){saveVersion.current++;contentVersion.current=saveVersion.current;}
      workspaceRef.current=initial;setWorkspace(initial);setSaveStatus(readOnlyRef.current&&writerLockResolved.current?'readonly':needsSync?'saving':'saved');
    }).catch(error=>{if(active){setLoadError(errorMessage(error));setSaveStatus('error');}});
    return()=>{active=false;};
  },[persist]);
  useEffect(()=>{
    if(!workspace||readOnly)return;
    if(saveVersion.current===savedVersion.current)return;
    const timer=setTimeout(()=>{const silent=!visibleChange.current;visibleChange.current=false;void persist(workspace,saveVersion.current,silent);},250);
    return()=>clearTimeout(timer);
  },[workspace,readOnly,persist]);
  useEffect(()=>{
    const handler=(e:BeforeUnloadEvent)=>{if((!readOnlyRef.current&&savedVersion.current<contentVersion.current)||busyRef.current||pendingTranscriptEdits.current.size){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',handler);
    const off=window.studio?.onFlush(async()=>{if(pendingTranscriptEdits.current.size)throw new Error('还有未保存的逐字稿校对，请先保存或取消校对后再关闭。');if(busyRef.current)throw new Error('素材处理尚未完成，请稍后关闭。');if(workspaceRef.current&&!readOnlyRef.current)await persist(workspaceRef.current,saveVersion.current);});
    return()=>{window.removeEventListener('beforeunload',handler);off?.();};
  },[persist]);
  useEffect(()=>{
    if(!navigator.locks)return;
    let active=true;
    let release:()=>void=()=>{};
    const hold=new Promise<void>(resolve=>{release=resolve;});
    void navigator.locks.request('field-workspace-writer',{ifAvailable:true},async lock=>{
      if(!active)return;
      writerLockResolved.current=true;
      readOnlyRef.current=!lock;
      setReadOnly(!lock);
      if(!lock)setSaveStatus('readonly');
      if(lock)await hold;
    });
    return()=>{active=false;release();};
  },[]);
  const retrySave=useCallback(()=>{const current=workspaceRef.current;if(current)void persist(current,saveVersion.current).catch(()=>{});},[persist]);
  return {workspace,setWorkspace,workspaceRef,saveStatus,saveError,saveQueue,saveVersion,writerLockResolved,readOnly,readOnlyRef,loadError,persist,setNext,saveViewport,retrySave};
}
