import { useEffect, type RefObject } from 'react';
import type { Board } from '../model';
import { lazySurface } from './lazy-surface';
import { preloadInspector } from '../shell/InspectorPanel';
import { loadedDraftEditor, preloadDraftEditor } from '../inspector/draft-editor/editor-loader';

// CORE-31: the first-run welcome, the dialogs, the outline and the search are separate chunks, fetched while the browser
// is idle; once fetched they open without a Suspense round (lazySurface). Moved out of App.tsx unchanged (CORE-32).
const welcomeSurface=lazySurface(()=>import('../shell/Welcome'));
const importSurface=lazySurface(()=>import('../dialogs/ImportDialog'));
const videoImportsSurface=lazySurface(()=>import('../dialogs/VideoImportsDialog'));
const exportSurface=lazySurface(()=>import('../dialogs/ExportDialog'));
const helpSurface=lazySurface(()=>import('../dialogs/HelpDialog'));
const newBoardSurface=lazySurface(()=>import('../dialogs/NewBoardDialog'));
const searchSurface=lazySurface(()=>import('../dialogs/SearchDialog'));
const outlineSurface=lazySurface(()=>import('../shell/OutlineView'));
const recoverySurface=lazySurface(()=>import('../DirectoryRecoveryDialog'));
const translationSettingsSurface=lazySurface(()=>import('../dialogs/TranslationSettingsDialog'));
const mediaToolsSurface=lazySurface(()=>import('../dialogs/MediaToolsDialog'));
export const Welcome=welcomeSurface.Surface,ImportDialog=importSurface.Surface,VideoImportsDialog=videoImportsSurface.Surface,ExportDialog=exportSurface.Surface,HelpDialog=helpSurface.Surface;
export const NewBoardDialog=newBoardSurface.Surface,SearchDialog=searchSurface.Surface,OutlineView=outlineSurface.Surface,DirectoryRecoveryDialog=recoverySurface.Surface,TranslationSettingsDialog=translationSettingsSurface.Surface,MediaToolsDialog=mediaToolsSurface.Surface;
// The search palette's own module (WorkspaceSearch) is lazy inside SearchDialog: fetching it early saves the network wait.
const preloadChunks=()=>Promise.all([welcomeSurface,importSurface,videoImportsSurface,exportSurface,helpSurface,newBoardSurface,searchSurface,outlineSurface,recoverySurface,translationSettingsSurface,mediaToolsSurface].map(surface=>surface.preload() as Promise<unknown>).concat(import('../WorkspaceSearch')));

/** CORE-11: fetch the panel module while the browser is idle after the first screen, so opening a source never waits on it. */
export function useIdlePreload(workspaceReady:boolean) {
  useEffect(()=>{
    if(!workspaceReady)return;
    const warm=()=>{void preloadInspector().catch(()=>{});void preloadChunks().catch(()=>{});};
    if(typeof window.requestIdleCallback==='function'){const handle=window.requestIdleCallback(warm,{timeout:2500});return()=>window.cancelIdleCallback(handle);}
    const timer=window.setTimeout(warm,1200);return()=>window.clearTimeout(timer);
  },[workspaceReady]);
}

/**
 * CORE-32: the writing editor (CodeMirror) is its own chunk and is not part of the idle preload. It is fetched when
 * writing is near: a draft card selected, or pointed at or focused on the canvas or in the sidebar list. Opening a
 * draft some other way starts it too (InspectorPanel, focusSource, a new draft), so the panel rarely waits for it.
 */
export function useDraftEditorWarmup({board,boardRef,selectedIds}:{board:Board|null;boardRef:RefObject<Board|null>;selectedIds:string[]}) {
  const selectsDraft=!!board&&selectedIds.some(id=>board.nodes.find(node=>node.id===id)?.data.kind==='draft');
  useEffect(()=>{if(selectsDraft)void preloadDraftEditor().catch(()=>{});},[selectsDraft]);
  useEffect(()=>{
    const warm=(event:Event)=>{
      if(loadedDraftEditor()||!(event.target instanceof Element))return;
      const holder=event.target.closest<HTMLElement>('.react-flow__node[data-id], [data-card-id]');
      const id=holder?.dataset.id??holder?.dataset.cardId;
      if(id&&boardRef.current?.nodes.find(node=>node.id===id)?.data.kind==='draft')void preloadDraftEditor().catch(()=>{});
    };
    document.addEventListener('pointerover',warm,true);document.addEventListener('focusin',warm,true);
    return()=>{document.removeEventListener('pointerover',warm,true);document.removeEventListener('focusin',warm,true);};
  },[boardRef]);
}
