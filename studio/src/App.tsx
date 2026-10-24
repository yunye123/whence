import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, useReactFlow, useStoreApi, type Node } from '@xyflow/react';
import type { CardData } from './model';
import { BoardContext, CardContext, type BoardActions, type CardActions } from './board-context';
import { importBoard, validateBoard } from './storage';
import { registerCanvasContainer } from './canvas/safe-area';
import { alignCards } from './card-movement';
import { canActivateCard, isCardControlTarget } from './card-interaction';
import { nodeTypes } from './CanvasCard';
import CanvasSelectionTools from './CanvasSelectionTools';
import { resizeCard } from './card-size';
import { motionDuration } from './motion';
import { isNative } from './native';
import { isVideoImportAvailable } from './video-import';
// Pure helpers and constants (src/app).
import type { CanvasRevealRequest, CanvasTool, CanvasView, Modal, ResolvedTheme } from './app/types';
import { errorMessage } from './app/utils';
import { pendingImport, sharedLinks, isXUrl } from './app/video-links';
import { canvasAriaLabels } from './app/canvas-config';
import { exportBoardPackage, exportBoardDirectory, exportBoardDraft } from './app/export-actions';
import { nodeSelector, focusCanvasStart } from './app/studio-dom';
// Presentational shell and dialogs (state stays here, passed in as props).
import { LoadErrorScreen, LoadingScreen } from './shell/RecoveryScreens';
import Sidebar from './shell/Sidebar';
import TopBar from './shell/TopBar';
import StatusBanners from './shell/StatusBanners';
import CanvasLayers from './shell/CanvasLayers';
import { fieldEdgeTypes, fieldDefaultEdgeOptions, FIELD_CONNECTION_RADIUS, FieldConnectionLine, useFieldFlowEdges } from './canvas/edges';
import { useFieldTrace } from './canvas/useFieldTrace';
import { CanvasLod, settleCanvasZoom } from './canvas/lod';
import EmptyCanvas from './shell/EmptyCanvas';
import CanvasToolbar from './shell/CanvasToolbar';
import CanvasRail from './shell/CanvasRail';
import ZoomControls from './shell/ZoomControls';
import InspectorPanel from './shell/InspectorPanel';
import CanvasContextMenu from './shell/CanvasContextMenu';
import Toasts, { showToast, inferToastTone, type ToastOptions } from './shell/Toasts';
import type { LibraryFacet } from './shell/MaterialsLibrary';
import { Menu, MenuItem } from './components/Menu';
import { keyOf } from './components/shortcut-keys';
import { GroupIcon } from './icons/field-icons';
import ModalShell from './shell/ModalShell';
import HiddenFileInputs from './shell/HiddenFileInputs';
import { Welcome, ImportDialog, VideoImportsDialog, ExportDialog, HelpDialog, NewBoardDialog, SearchDialog, OutlineView, DirectoryRecoveryDialog, useIdlePreload, useDraftEditorWarmup } from './app/lazy-chunks';
import { useWorkspaceStore } from './app/useWorkspaceStore';
import { useBoardHistory } from './app/useBoardHistory';
import { useMediaUrls } from './app/useMediaUrls';
import { useCanvasViewport, useRevealFollow } from './app/useCanvasViewport';
import { usePlayback } from './app/usePlayback';
import { useVideoTasks, useVideoTaskRecovery } from './app/useVideoTasks';
import { useSourceNavigation } from './app/useSourceNavigation';
import { useCardCommands } from './app/useCardCommands';
import { useBoardManagement } from './app/useBoardManagement';
import { useTranscripts } from './app/useTranscripts';
import { useImportFlows } from './app/useImportFlows';
import { useDraftWriting } from './app/useDraftWriting';
import { useRecentDraftEdits } from './app/useRecentDraftEdits';
import { useTrayCommands } from './app/useTrayCommands';
import { useCardExtras } from './app/useCardExtras';
import { useSnapGuides, useCanvasHandlers, usePaneMarquee } from './app/useCanvasInteraction';
import { bindFreshTranslation } from './app/fresh-translation';
import { useKeyboardModality, useSpacePan, useGlobalShortcuts } from './app/useGlobalKeys';
import { useDialogFocus, useCoverLayer } from './app/useFocusLayers';
import { useSearchNavigation } from './app/useSearchNavigation';
import { useFlowNodes } from './app/useFlowNodes';
import { captionRules, type CaptionRules } from './app/caption-rules';

// Tests import these helpers from './App'; they now live in src/app.
export { isSubstantiveNodeChange, applyCanvasNodeChanges } from './app/canvas-changes';
export { needsImportPosterRestore, prepareVideoImportUpdate } from './app/import-merge';
export { prepareTranscriptReplacement } from './app/transcript-replacement';

export default function App() { return <ReactFlowProvider><Studio /></ReactFlowProvider>; }
/**
 * The studio: state the shell renders, and the parts that act on it (CORE-32). Each part lives in src/app as a hook and
 * is called here in a fixed order (hooks run their effects in call order): the workspace and its saving, the camera,
 * playback and the way back to sources, card and board commands, imports, writing, the canvas's own events, the window's
 * keys and focus. This function only composes them and renders the shell.
 */
function Studio() {
  // --- The workspace: load, save queue, single-writer lock (K1) ---
  const pendingTranscriptEdits=useRef(new Set<string>());
  const [busy,setBusy] = useState('');
  const busyRef=useRef(busy);busyRef.current=busy;
  // First open (and a new template board) shows its start area at 100% instead of "查看全部" (F-B1).
  const initialRevealBoard=useRef<string|null>(null);
  const {workspace,setWorkspace,workspaceRef,saveStatus,saveError,saveQueue,saveVersion,writerLockResolved,readOnly,readOnlyRef,loadError,persist,setNext,saveViewport,retrySave}
    =useWorkspaceStore({busyRef,pendingTranscriptEdits,initialRevealBoard});

  // --- What the shell shows ---
  const [modal, setModal] = useState<Modal>(null);
  // Below 1000px the sidebar is an overlay drawer: closed at start, and it follows the window across 1000 (§5.1, CV-m4).
  const [sidebar, setSidebar] = useState(()=>typeof window==='undefined'||window.innerWidth>=1000);
  const sidebarRef=useRef(sidebar);sidebarRef.current=sidebar;
  useEffect(()=>{const narrow=matchMedia('(max-width: 999px)');const sync=()=>setSidebar(!narrow.matches);narrow.addEventListener('change',sync);return()=>narrow.removeEventListener('change',sync);},[]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdsRef=useRef(selectedIds);selectedIdsRef.current=selectedIds;
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [measurements,setMeasurements]=useState<Record<string,{width:number;height:number}>>({});
  const [view, setView] = useState<CanvasView>('canvas');
  const [tool, setTool] = useState<CanvasTool>('select');
  const [panPressed,setPanPressed]=useState(false);
  const effectiveTool=panPressed?'hand':tool;
  const [canvasReveal,setCanvasReveal]=useState<CanvasRevealRequest|null>(null);
  // Sidebar facet (§6.2 item 7): cards outside it fade to .35 on the canvas.
  const [libraryFacet,setLibraryFacet] = useState<LibraryFacet>('all');
  const [imagePreviewToken,setImagePreviewToken] = useState(0);
  const [resolvedTheme,setResolvedTheme]=useState<ResolvedTheme>(document.documentElement.dataset.theme==='dark'?'dark':'light');
  const keyboardInput=useKeyboardModality();
  // Where the export dialog opens: the plain list, or the moodboard of one group (§6.20.1).
  const [exportStart,setExportStart]=useState<{view:'list'|'moodboard';groupId?:string}>({view:'list'});
  // “加入分组” with several trays: the tray list opens at the button that asked (§6.6).
  const [groupPicker,setGroupPicker]=useState<{cardId:string;anchor:HTMLElement|{x:number;y:number}}|null>(null);
  const [contextMenu,setContextMenu]=useState<{x:number;y:number}|null>(null);
  const boardFile=useRef<HTMLInputElement>(null), mediaFile=useRef<HTMLInputElement>(null), subtitleFile=useRef<HTMLInputElement>(null);
  const modalHost=useRef<HTMLDivElement>(null);
  const flow=useReactFlow<Node<CardData>>();
  const board = workspace?.boards.find(b=>b.id===workspace.activeBoardId) ?? null;
  // Every board activation path (new/import/restore/delete/switch) resets the controlled directory facet.
  // Reopening the sidebar on the same board keeps its session filter.
  useEffect(()=>{setLibraryFacet('all');},[workspace?.activeBoardId]);
  const boardRef=useRef(board);boardRef.current=board;
  // FIELD trace (§6.17) and the tie of a new excerpt (§7); the controller lives as long as the studio.
  const fieldTrace=useFieldTrace(()=>boardRef.current);
  const flowStore=useStoreApi();
  const measurementsRef=useRef(measurements);measurementsRef.current=measurements;

  const captionRulesRef=useRef<CaptionRules|null>(null);

  // --- The camera, panning, snapping ---
  const {importToast,fitCanvas,revealRect,revealNodes,batchFits,revealStartAreaWhenMeasured,measureAll,center,visibleView}
    =useCanvasViewport({flow,boardRef,measurementsRef,sidebarRef,setSidebar,captionRulesRef});
  useSpacePan({modal,view,setPanPressed});
  const {smartSnap,setSmartSnap,snapGuides,setSnapGuides,movingCardIds,snapBypass}=useSnapGuides({board,effectiveTool,view});
  const lastModifiedDraftId=useRecentDraftEdits(board);
  const workspaceReady=!!workspace;
  useIdlePreload(workspaceReady);
  useDraftEditorWarmup({board,boardRef,selectedIds});
  // C9: the window names the open board (“画布名 - 来处”).
  useEffect(()=>{if(board)document.title=`${(board.title||'').trim()||'未命名画布'} - 来处`;},[board?.title,board?.id]);
  /** Toast queue (§6.22): failures stay until closed; options add a location tag, an action (“查看”) or a precise “撤销”. */
  const notify=useCallback((message:string,options:ToastOptions={})=>{showToast(message,{tone:inferToastTone(message),...options});},[]);
  const writeCardQuiet=useCallback((boardId:string,nodeId:string,patch:Partial<CardData>)=>{
    const current=workspaceRef.current;if(!current||readOnlyRef.current)return false;
    const target=current.boards.find(item=>item.id===boardId);const node=target?.nodes.find(item=>item.id===nodeId);
    if(!target||!node)return false;
    let nextBoard;
    try{nextBoard=validateBoard({...target,nodes:target.nodes.map(item=>item.id===nodeId?{...item,data:{...item.data,...patch}}:item)});}catch{return false;}
    setNext({...current,boards:current.boards.map(item=>item.id===boardId?nextBoard:item)});
    return true;
  },[setNext]);
  bindFreshTranslation(()=>workspaceRef.current,writeCardQuiet,message=>notify(message,{key:'fresh-translate'}));
  useEffect(()=>{const observer=new MutationObserver(()=>setResolvedTheme(document.documentElement.dataset.theme==='dark'?'dark':'light'));observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect();},[]);

  // --- Media, undo history, playback, background video tasks ---
  const {mediaUrls,mediaUrlsRef,getMediaStatus,retryMedia,imageRatioVersion}=useMediaUrls({board,notify});
  const captions=useMemo(()=>captionRules(board?.nodes??[],measurements),[board?.nodes,measurements,imageRatioVersion]);
  captionRulesRef.current=captions;
  const {history,pushHistory,changeBoard,undo,undoChange}=useBoardHistory({workspaceRef,boardRef,readOnly,notify,setNext});
  const {activeVideo,setActiveVideo,videoPlaybackVersion,setVideoPlaybackVersion,playbackSession,playbackRequest,setPendingTranscriptEdit,getVideoPlayback,bindVideoPlayer,captureVideoPlayback,restoreVideoPlayback,playVideo}
    =usePlayback({board,workspaceRef,boardRef,pendingTranscriptEdits,notify,setBusy});
  const videoTasks=useVideoTasks({workspaceRef,readOnlyRef,notify,setNext,persist,saveVersion});
  const {videoActionIds,videoActions,videoRuns,pendingVideoSubmissions,nativeTasks,expectedAttempts,updateImportCard,setVideoAction,launchVideoImport,cancelVideoImportAction,retryVideoImportAction}=videoTasks;

  // --- Panels and the way back to sources (FIELD trace, draft round trip) ---
  const {draftNavigation,draftReturn,draftRestore,clearDraftNavigation,sourceTextReveal,showCard,openCard,closeInspector,closeInspectorRef,focusSource,openDraftSource,returnToDraft,completeDraftRestore,completeSourceTextReveal,inspectedId,focusedId,pinnedId,companionId,watchId,soloId,closeCompanion,closeDraft,closePanels,releaseCards,panelDismissable}
    =useSourceNavigation({board,boardRef,workspaceRef,selectedIdsRef,setSelectedIds,setSelectedEdgeIds,view,setView,setCanvasReveal,setImagePreviewToken,keyboardInput,flow,notify,fieldTrace,activeVideo,setActiveVideo,setVideoPlaybackVersion,playbackSession,playbackRequest,getVideoPlayback,playVideo});

  // --- Cards and boards ---
  const {freshCardIds,updateCard,markFresh,addCard,deleteCards,duplicateCardAction,addQuote,addTextQuote,addQuoteAndAnnotate}
    =useCardCommands({boardRef,workspaceRef,readOnlyRef,measurements,measurementsRef,changeBoard,undoChange,notify,fieldTrace,visibleView,setSelectedIds,setSelectedEdgeIds,setView,setCanvasReveal,setContextMenu,releaseCards,activeVideo,setActiveVideo,playbackRequest,playbackSession,clearDraftNavigation,showCard,closeInspectorRef,videoRuns,expectedAttempts,nativeTasks});
  const panelsOpen=!!(pinnedId||companionId||soloId||watchId);
  // Below 1000px the sidebar drawer would cover the docked panel's close button: opening a panel closes the drawer.
  useEffect(()=>{if(panelsOpen&&matchMedia('(max-width: 999px)').matches)setSidebar(false);},[panelsOpen]);
  useRevealFollow({board,boardRef,canvasReveal,setCanvasReveal,inspectedId:focusedId,view,revealNodes});
  const {switchBoard,changeWorkspace,chooseBoardDirectory,addBoard,insertBoard,duplicateBoard,renameBoard,dismissWelcome,openExample,decideRecovery,reconnectLocalBoard,recoveryPrompt,welcome,boardName,setBoardName,boardDirectory,setBoardDirectory,directoryError,setDirectoryError,creatingBoard,chosenTemplate,setChosenTemplate}
    =useBoardManagement({workspaceRef,boardRef,readOnlyRef,readOnly,busyRef,setBusy,setWorkspace,setNext,saveQueue,initialRevealBoard,revealStartAreaWhenMeasured,notify,changeBoard,clearDraftNavigation,playbackRequest,playbackSession,setSelectedIds,setSelectedEdgeIds,closePanels,setActiveVideo,setLibraryFacet,setGroupPicker,setView,setModal,setCanvasReveal});

  // --- Bringing material in, transcripts, writing, trays ---
  const {linkValue,setLinkValue,linkMode,setLinkMode,importFormError,setImportFormError,xImportProgress,xCommitting,xRun,closeModal:closeImportModal,importXLinks,readXPost,xPostErrors,xPostLoadingIds,importFiles,replaceMedia,runNative,pasteText,pasteFromMenu}
    =useImportFlows({workspaceRef,boardRef,readOnlyRef,readOnly,busyRef,setBusy,measurements,measurementsRef,persist,saveVersion,pushHistory,setNext,changeBoard,notify,fitCanvas,importToast,center,visibleView,batchFits,markFresh,openCard,insertBoard,setModal,setSelectedIds,setSelectedEdgeIds,setView,setCanvasReveal,updateImportCard,launchVideoImport,pendingVideoSubmissions});
  const {chooseSubtitles,loadSubtitle,transcribe,transcriptionMessages}=useTranscripts({boardRef,workspaceRef,readOnlyRef,notify,pushHistory,setNext,changeBoard,setVideoAction,videoActions,subtitleFile});
  /** Pan so this card is in the visible canvas and select it; the panel stays (inspector-shell B1). */
  const revealCard=useCallback((id:string)=>{const current=boardRef.current;if(!current?.nodes.some(node=>node.id===id))return;setSelectedIds([id]);setSelectedEdgeIds([]);setView('canvas');setCanvasReveal({boardId:current.id,ids:[id],instant:false});},[]);
  const pinnedNode=pinnedId?board?.nodes.find(node=>node.id===pinnedId):undefined;
  const companionNode=companionId?board?.nodes.find(node=>node.id===companionId):undefined;
  const soloNode=soloId&&!pinnedNode?board?.nodes.find(node=>node.id===soloId):undefined;
  const watchNode=watchId?board?.nodes.find(node=>node.id===watchId):undefined;
  const focusedNode=focusedId?board?.nodes.find(node=>node.id===focusedId):undefined;
  const writingDraft=pinnedNode?.data.kind==='draft'?pinnedNode:focusedNode?.data.kind==='draft'?focusedNode:undefined;
  const {focusWriting,exportDraft,writeLinesToDraft,writeToDraft}
    =useDraftWriting({board,inspected:writingDraft,boardRef,readOnlyRef,measurementsRef,changeBoard,undoChange,markFresh,notify,draftNavigation,returnToDraft,openCard,showCard,clearDraftNavigation,playbackRequest,setCanvasReveal});
  const {groupSelection,arrangeFrameAction,moveCardIntoFrame,addToGroup}
    =useTrayCommands({boardRef,readOnlyRef,measurementsRef,mediaUrlsRef,changeBoard,markFresh,revealRect,flow,notify,setSelectedIds,setSelectedEdgeIds,setCanvasReveal,setGroupPicker});
  /** Export dialog straight on the moodboard of one group (§6.20.1, entry one). */
  const openMoodboard=useCallback((groupId?:string)=>{setExportStart({view:'moodboard',groupId});setModal('export');},[]);
  const openExport=useCallback(()=>{setExportStart({view:'list'});setModal('export');},[]);

  // --- What cards and panels receive (docs/redesign/integration/cards.md) ---
  const {cardExtras,frameCounts,sourceNodeIds}=useCardExtras({board,boardRef,selectedIds,measurements,imageRatioVersion,freshCardIds,readOnly,replaceMedia});
  // The watching workbench covers the save banner: it offers the same ways out (FD-02), reconnect only where the banner does.
  const canReconnect=isNative()&&!!workspace?.boards.some(item=>item.storage);
  const actions:BoardActions=useMemo(()=>({updateCard,openCard,readXPost,xPostLoading:id=>xPostLoadingIds.includes(id),xPostError:id=>xPostErrors[id],deleteCard:id=>deleteCards([id]),duplicateCard:duplicateCardAction,addQuote,addTextQuote,focusSource,openDraftSource,draftReturn,returnToDraft,draftRestore,completeDraftRestore,sourceTextReveal,completeSourceTextReveal,getMediaUrl:id=>id?mediaUrls[id]:undefined,getMediaStatus,retryMedia,tool:effectiveTool,activeVideo,inspectedId,playVideo,videoPlaybackVersion,getVideoPlayback,bindVideoPlayer,captureVideoPlayback,restoreVideoPlayback,setPendingTranscriptEdit,nodes:board?.nodes??[],cancelVideoImport:cancelVideoImportAction,retryVideoImport:retryVideoImportAction,videoImportAvailable:isVideoImportAvailable(),videoImportActionPending:id=>videoActionIds.includes(id),transcribeVideo:transcribe,transcriptionMessage:id=>transcriptionMessages[id]??'',nativeTranscribeAvailable:isNative()&&!readOnly,readOnly,revealCard,addQuoteAndAnnotate,edges:board?.edges??[],saveStatus,retrySave,saveError,reconnectFolder:canReconnect?reconnectLocalBoard:undefined,exportBackup:openExport,writeToDraft,writeLinesToDraft,...cardExtras}),[updateCard,openCard,readXPost,xPostLoadingIds,xPostErrors,deleteCards,duplicateCardAction,addQuote,addTextQuote,focusSource,openDraftSource,draftReturn,returnToDraft,draftRestore,completeDraftRestore,sourceTextReveal,completeSourceTextReveal,mediaUrls,getMediaStatus,retryMedia,effectiveTool,activeVideo,inspectedId,playVideo,videoPlaybackVersion,getVideoPlayback,bindVideoPlayer,captureVideoPlayback,restoreVideoPlayback,setPendingTranscriptEdit,board?.nodes,cancelVideoImportAction,retryVideoImportAction,videoActionIds,transcribe,transcriptionMessages,readOnly,revealCard,addQuoteAndAnnotate,board?.edges,saveStatus,retrySave,saveError,canReconnect,reconnectLocalBoard,openExport,writeToDraft,writeLinesToDraft,cardExtras]);
  const cardActions:CardActions=useMemo(()=>({updateCard,openCard,deleteCard:id=>deleteCards([id]),duplicateCard:duplicateCardAction,addQuote,focusSource,getMediaUrl:id=>id?mediaUrls[id]:undefined,getMediaStatus,retryMedia,tool:effectiveTool,activeVideo,inspectedId,playVideo,videoPlaybackVersion,getVideoPlayback,bindVideoPlayer,captureVideoPlayback,restoreVideoPlayback,sourceNodeIds,cancelVideoImport:cancelVideoImportAction,retryVideoImport:retryVideoImportAction,videoImportAvailable:isVideoImportAvailable(),videoImportActionPending:id=>videoActionIds.includes(id),transcribeVideo:transcribe,transcriptionMessage:id=>transcriptionMessages[id]??'',nativeTranscribeAvailable:isNative()&&!readOnly,readOnly,...cardExtras}),[updateCard,openCard,deleteCards,duplicateCardAction,addQuote,focusSource,mediaUrls,getMediaStatus,retryMedia,effectiveTool,activeVideo,inspectedId,playVideo,videoPlaybackVersion,getVideoPlayback,bindVideoPlayer,captureVideoPlayback,restoreVideoPlayback,sourceNodeIds,cancelVideoImportAction,retryVideoImportAction,videoActionIds,transcribe,transcriptionMessages,readOnly,cardExtras]);

  // --- The canvas's own events, the window's keys and focus, search ---
  useVideoTaskRecovery({video:videoTasks,workspace,workspaceRef,readOnlyRef,readOnly,notify});
  const {onNodesChange,onEdgesChange,onSelectionChange,connectCards,onConnect,onConnectEnd,onNodeDragStart,onNodeDragStop,onCanvasKey,onCanvasDrop}=useCanvasHandlers({boardRef,workspaceRef,readOnlyRef,modal,contextMenu,inspectedId:focusedId,selectedIds,effectiveTool,measurements,flow,changeBoard,pushHistory,notify,openCard,addQuote,importFiles,setSelectedIds,setSelectedEdgeIds,setMeasurements,smartSnap,setSnapGuides,movingCardIds,snapBypass,captionRulesRef});
  usePaneMarquee({enabled:effectiveTool==='select'&&!!board,flow,flowStore});
  useDialogFocus({modal,modalHost});
  const closeModal=useCallback(()=>{if(modal==='export'&&busyRef.current)return;closeImportModal();},[modal,closeImportModal]);
  useGlobalShortcuts({effectiveTool,notify,readOnlyRef,readOnly,workspaceRef,persist,saveVersion,modal,setModal,contextMenu,setContextMenu,creatingBoard,xRun,closeModal,panelDismissable,closeInspector,selectedIds,setSelectedIds,selectedEdgeIds,setSelectedEdgeIds,recoveryPrompt,importFiles,pasteText,pasteFromMenu,undo,groupSelection,duplicateCardAction,deleteCards,changeBoard,addCard,setTool,view,setView,fitCanvas,boardRef});
  const flowNodes=useFlowNodes({board,selectedIds,measurements,libraryFacet,imageRatioVersion,captions});
  // Stored lines plus the derived “摘录 → 文稿” citation lines (EG-M3), each with its look, lit/dim state and Chinese name.
  const flowEdges=useFieldFlowEdges(board,selectedIds,selectedEdgeIds);
  const {selectSearchHit,runSearchCommand}=useSearchNavigation({board,boardRef,workspaceRef,readOnlyRef,busyRef,pendingTranscriptEdits,notify,switchBoard,setView,setModal,focusSource,addCard,fitCanvas});
  const {setWorkspaceBody,coverLayer}=useCoverLayer();
  const h=board?history.current.get(board.id):null;
  const importEntries=workspace?.boards.flatMap(item=>item.nodes.filter(node=>node.data.videoImport).map(node=>({board:item,node,task:node.data.videoImport!}))).sort((a,b)=>b.task.createdAt.localeCompare(a.task.createdAt))??[];
  const activeImportCount=importEntries.filter(entry=>pendingImport(entry.task.status)).length;

  if(loadError)return <LoadErrorScreen message={loadError}/>;
  if(!workspace||!board)return <LoadingScreen/>;

  // Shell handlers: plain closures recreated on every render, exactly like the former inline JSX handlers.
  // KB-M2: after locating a card from the sidebar the keyboard focus moves to that card, so Delete acts on it.
  // CORE-16: Enter on the entry of the card that is already the selection opens it, like a double click (the first Enter
  // locates the card and moves the focus to it, where Enter opens it too).
  const revealLibraryCard=(id:string)=>{if(keyboardInput.current&&selectedIdsRef.current.length===1&&selectedIdsRef.current[0]===id){openCard(id);return;}setSelectedIds([id]);setSelectedEdgeIds([]);setView('canvas');setCanvasReveal({boardId:board.id,ids:[id],instant:false,focus:true});};
  const revealStorage=()=>void window.fieldBoardStorage?.reveal(board.storage!.id).catch(error=>notify(errorMessage(error)));
  const resizeSelectedCard=(id:string,width:number,height:number)=>{const current=boardRef.current;if(readOnlyRef.current||!current)return false;const next=resizeCard(current,id,width,height);if(next===current){const node=current.nodes.find(node=>node.id===id);return node?.style?.width===width&&node?.style?.height===height;}return changeBoard(()=>next);};
  const changeLinkText=(value:string)=>{setLinkValue(value);setImportFormError('');if(sharedLinks(value).some(isXUrl))setLinkMode('x');};
  const submitLink=()=>{pasteText(linkValue);};
  // "前往卡片": the reveal waits for the switched board instead of a 100ms timer (EN-m3).
  const goToImportCard=(boardId:string,nodeId:string)=>{switchBoard(boardId);setSelectedIds([nodeId]);setView('canvas');setModal(null);setCanvasReveal({boardId,ids:[nodeId],instant:false});};
  const exportHandlers={setBusy,notify,close:()=>setModal(null)};
  // First-run welcome (§6.24): only while every board is untouched example content; hidden once the window is known to be read-only.
  const showWelcome=welcome&&!(readOnly&&writerLockResolved.current)&&workspace.boards.every(item=>item.nodes.every(node=>node.data.demo));
  const selectedVideo=selectedIds.length===1?board.nodes.find(node=>node.id===selectedIds[0]&&node.data.kind==='video'):undefined;
  const pickerFrames=groupPicker?board.nodes.filter(node=>node.data.kind==='frame').sort((a,b)=>a.position.y-b.position.y||a.position.x-b.position.x):[];
  // CORE-25: the button says “打开画布文件”, so the failure says the same, why, and which file to choose instead.
  const restoreBoardFile=async(file:File)=>{setBusy('正在打开画布文件…');try{insertBoard(await importBoard(file));}catch(error){const message=errorMessage(error);notify(`没能打开这个文件：${/JSON 画布包|不支持的字段|画布包|格式/.test(message)?'它不是来处导出的画布。请选择用“导出 → 便携画布文件”保存的文件。':message}`,{tone:'error'});}finally{setBusy('');}};

  return (
    <BoardContext.Provider value={actions}>
      <CardContext.Provider value={cardActions}>
        <div className={`studio ${sidebar?'':'sidebar-hidden'} ${panelsOpen?'inspector-visible':''}`} inert={showWelcome&&!modal}>
          <a className="skip-link" href="#" inert={coverLayer} onClick={event=>{event.preventDefault();/* CORE-38: land on the selected card or the first card (visible focus ring, no walk through every thread). */const selected=selectedIdsRef.current.map(id=>document.querySelector<HTMLElement>(nodeSelector(id))).find(Boolean);if(selected){selected.focus();return;}document.querySelector<HTMLElement>('[data-testid="canvas"]')?.focus({preventScroll:true});focusCanvasStart();}}>跳到画布</a>
          {/* display:contents keeps the shell layout; inert only takes the covered sidebar out of reach (FV-M9). */}
          <div className="layer-guard" style={{display:'contents'}} inert={coverLayer}>
          <Sidebar
            open={sidebar}
            workspace={workspace}
            board={board}
            readOnly={readOnly}
            busy={!!busy}
            selectedIds={selectedIds}
            facet={libraryFacet}
            onFacet={setLibraryFacet}
            onSearch={()=>setModal('search')}
            onSwitchBoard={switchBoard}
            onNewBoard={()=>setModal('new')}
            onChangeWorkspace={changeWorkspace}
            onRevealCard={revealLibraryCard}
            onOpenCard={openCard}
            onHelp={()=>setModal('help')}
            onToggleSidebar={()=>setSidebar(open=>!open)}
            onRenameBoard={renameBoard}
            onDuplicateBoard={id=>void duplicateBoard(id)}
            onExportBoard={id=>{switchBoard(id);openExport();}}
          />
          </div>
          <div className="main-workspace">
            <div className="layer-guard" style={{display:'contents'}} inert={coverLayer}>
            <TopBar
              board={board}
              readOnly={readOnly}
              saveStatus={saveStatus}
              saveError={saveError}
              sidebarOpen={sidebar}
              onToggleSidebar={()=>setSidebar(!sidebar)}
              sidebarHasCollapse
              onRename={title=>changeBoard(b=>({...b,title}),{key:'edit'})}
              onRevealStorage={revealStorage}
              view={view}
              onViewChange={setView}
              canUndo={!!h?.past.length}
              canRedo={!!h?.future.length}
              onUndo={()=>undo()}
              onRedo={()=>undo(true)}
              importTaskCount={importEntries.length}
              activeImportCount={activeImportCount}
              attentionImportCount={importEntries.filter(entry=>entry.task.status==='failed'||entry.task.status==='interrupted').length}
              onOpenImports={()=>setModal('imports')}
              onOpenExport={openExport}
            />
            </div>
            <StatusBanners
              saveStatus={saveStatus}
              saveError={saveError}
              readOnly={readOnly}
              busy={!!busy}
              canReconnect={canReconnect}
              onRetrySave={()=>void persist(workspace,saveVersion.current).catch(()=>{})}
              onReconnect={reconnectLocalBoard}
              onExportBackup={openExport}
            />

            {/* CORE-28 (§6.28): the canvas area is the main landmark, named by a visually hidden h1. */}
            <main className="workspace-body" ref={setWorkspaceBody}>
              <h1 className="sr-only">{board.title.trim()||'未命名画布'}</h1>
              <div
                className="canvas-shell"
                data-testid="canvas"
                inert={coverLayer}
                tabIndex={view==='outline'?-1:0}
                aria-label="创作画布"
                onKeyDownCapture={onCanvasKey}
                onDragOver={e=>{if(e.dataTransfer.types.includes('Files')||e.dataTransfer.types.includes('application/x-field-quote')){e.preventDefault();e.dataTransfer.dropEffect='copy';}}}
                onDrop={onCanvasDrop}
              >
                <div ref={registerCanvasContainer} inert={view==='outline'} aria-hidden={view==='outline'} className={`flow-container ${effectiveTool==='hand'?'is-panning':''} ${view==='outline'?'flow-hidden':''}`}>
                  <ReactFlow
                    key={board.id}
                    ariaLabelConfig={canvasAriaLabels}
                    nodes={flowNodes}
                    edges={flowEdges}
                    nodeTypes={nodeTypes}
                    edgeTypes={fieldEdgeTypes}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onConnectEnd={onConnectEnd}
                    onSelectionChange={onSelectionChange}
                    defaultViewport={board.viewport}
                    onInit={instance=>{instance.setViewport(board.viewport);if(initialRevealBoard.current===board.id){initialRevealBoard.current=null;revealStartAreaWhenMeasured(board.id);}}}
                    onMoveEnd={(_,viewport)=>{settleCanvasZoom(flowStore);saveViewport(board.id,viewport);}}
                    onNodeDragStart={onNodeDragStart}
                    onNodeDragStop={onNodeDragStop}
                    onNodeDoubleClick={(event,node)=>{if(canActivateCard(effectiveTool,event)&&!isCardControlTarget(event.target))openCard(node.id);}}
                    onPaneClick={()=>{setContextMenu(null);setSelectedIds([]);}}
                    onPaneContextMenu={e=>{e.preventDefault();if(!readOnly)setContextMenu({x:e.clientX,y:e.clientY});}}
                    onDoubleClick={e=>{if(effectiveTool==='select'&&!readOnly&&!e.shiftKey&&(e.target as HTMLElement).classList.contains('react-flow__pane'))addCard('note',flow.screenToFlowPosition({x:e.clientX,y:e.clientY}));}}
                    panOnDrag={effectiveTool==='hand'?true:[0,1]}
                    selectionOnDrag={false}
                    panActivationKeyCode="Space"
                    multiSelectionKeyCode="Shift"
                    selectionKeyCode={null}
                    deleteKeyCode={null}
                    zoomOnDoubleClick={false}
                    minZoom={.2}
                    maxZoom={2}
                    nodesDraggable={!readOnly&&effectiveTool==='select'}
                    nodesConnectable={!readOnly&&effectiveTool==='select'}
                    elementsSelectable={effectiveTool==='select'}
                    nodeDragThreshold={4}
                    snapToGrid={false}
                    colorMode={resolvedTheme}
                    onlyRenderVisibleElements={!measureAll}
                    defaultEdgeOptions={fieldDefaultEdgeOptions}
                    connectionRadius={FIELD_CONNECTION_RADIUS}
                    connectionLineComponent={FieldConnectionLine}
                    proOptions={{hideAttribution:true}}
                  >
                    <CanvasLod/>
                    <CanvasLayers guides={snapGuides} theme={resolvedTheme} readOnly={readOnly}/>
                  </ReactFlow>
                </div>
                {view==='outline'&&<Suspense fallback={null}><OutlineView board={board} onOpenCard={openCard} onImport={()=>setModal('import')} onReorderDraft={(id,body)=>{changeBoard(b=>({...b,nodes:b.nodes.map(n=>n.id===id?{...n,data:{...n.data,body}}:n)}));}}/></Suspense>}
                {/* V8 / SB-M2: a board with only grouping frames is still empty of material. */}
                {/* CORE-24: a board that holds only a new group is no longer empty — the big empty state would sit in the group. */}{!board.nodes.length&&view==='canvas'&&<EmptyCanvas readOnly={readOnly} title={board.title} onImport={()=>setModal('import')} onAddNote={()=>addCard('note')} onPickFiles={()=>mediaFile.current?.click()} onPasteLink={()=>{setLinkMode('web');setImportFormError('');setModal('import');}}/>}
                {view==='canvas'&&(
                  <CanvasSelectionTools
                    nodes={board.nodes}
                    selectedIds={selectedIds}
                    readOnly={readOnly}
                    tool={effectiveTool}
                    measurements={measurements}
                    captionIds={captions.captionIds}
                    onOpen={openCard}
                    onDelete={id=>deleteCards([id])}
                    onDuplicate={duplicateCardAction}
                    onConnect={connectCards}
                    onResize={resizeSelectedCard}
                    onAlign={mode=>changeBoard(current=>alignCards(current,selectedIds,mode,measurements))}
                    onViewSelected={()=>void fitCanvas(250,selectedIds)}
                    onViewCard={id=>void fitCanvas(250,[id])}
                    onDeleteMany={ids=>deleteCards(ids)}
                    onViewOriginal={id=>openCard(id)}
                    onGroup={groupSelection}
                    onWriteToDraft={writeToDraft}
                    onFocusWriting={focusWriting}
                    onExportDraft={exportDraft}
                    onAddToGroup={addToGroup}
                    onArrangeFrame={arrangeFrameAction}
                    onExportMoodboard={openMoodboard}
                  />
                )}
                {view==='canvas'&&(
                  <CanvasRail
                    readOnly={readOnly}
                    tools={<CanvasToolbar
                      tool={effectiveTool}
                      readOnly={readOnly}
                      onTool={setTool}
                      onAddCard={kind=>addCard(kind)}
                      onPickFiles={()=>mediaFile.current?.click()}
                      onOpenImport={mode=>{if(mode){setLinkMode(mode);setImportFormError('');}setModal('import');}}
                      onPaste={()=>void pasteFromMenu()}
                      onImportSubtitles={()=>{if(selectedVideo)chooseSubtitles(selectedVideo.id);}}
                      subtitleTarget={selectedVideo?(selectedVideo.data.title||'未命名视频'):null}
                    />}
                    navigation={<ZoomControls
                      onZoomOut={()=>flow.zoomOut({duration:motionDuration(180)})}
                      onZoomReset={()=>flow.zoomTo(1,{duration:motionDuration(250)})}
                      onZoomIn={()=>flow.zoomIn({duration:motionDuration(180)})}
                      onFit={()=>fitCanvas(350)}
                      smartSnap={smartSnap}
                      onToggleSnap={()=>setSmartSnap(!smartSnap)}
                    />}
                  />
                )}
              </div>
              {companionNode&&pinnedNode&&(
                <InspectorPanel
                  slot="companion"
                  node={companionNode}
                  imagePreviewToken={imagePreviewToken}
                  onClose={closeCompanion}
                  onImportSubtitles={chooseSubtitles}
                  onNativeTranscribe={isNative()&&!readOnly?transcribe:undefined}
                  onNotify={notify}
                />
              )}
              {pinnedNode&&(
                <InspectorPanel
                  slot="pinned"
                  node={pinnedNode}
                  imagePreviewToken={imagePreviewToken}
                  onClose={closeDraft}
                  onImportSubtitles={chooseSubtitles}
                  onNativeTranscribe={isNative()&&!readOnly?transcribe:undefined}
                  onNotify={notify}
                />
              )}
              {soloNode&&(
                <InspectorPanel
                  node={soloNode}
                  imagePreviewToken={imagePreviewToken}
                  onClose={closeInspector}
                  onImportSubtitles={chooseSubtitles}
                  onNativeTranscribe={isNative()&&!readOnly?transcribe:undefined}
                  onNotify={notify}
                />
              )}
              {watchNode&&(
                <InspectorPanel
                  node={watchNode}
                  imagePreviewToken={imagePreviewToken}
                  onClose={closeInspector}
                  onImportSubtitles={chooseSubtitles}
                  onNativeTranscribe={isNative()&&!readOnly?transcribe:undefined}
                  onNotify={notify}
                />
              )}
            </main>
          </div>
          {contextMenu&&(
            <CanvasContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onAddCard={kind=>addCard(kind,flow.screenToFlowPosition(contextMenu))}
              onImport={()=>{setModal('import');setContextMenu(null);}}
              onFit={()=>{void fitCanvas();setContextMenu(null);}}
              onClose={()=>setContextMenu(null)}
              onPaste={()=>{setContextMenu(null);void pasteFromMenu();}}
              readOnly={readOnly}
            />
          )}
          {groupPicker&&pickerFrames.length>0&&(
            <Menu label="加入分组" anchor={groupPicker.anchor} placement="bottom-start" onClose={()=>setGroupPicker(null)}>
              {pickerFrames.map(frame=><MenuItem key={frame.id} icon={<GroupIcon size={16}/>} label={frame.data.title||'未命名分组'} reason={frameCounts.has(frame.id)?`${frameCounts.get(frame.id)} 张`:undefined} onSelect={()=>moveCardIntoFrame(groupPicker.cardId,frame.id)}/>)}
            </Menu>
          )}
          <Toasts busy={busy}/>
          {modal==='search'&&<Suspense fallback={<div className="busy-toast" role="status">正在打开搜索…</div>}><SearchDialog workspace={workspace} readOnly={readOnly||!!busy} onClose={()=>setModal(null)} onSelect={selectSearchHit} onCommand={runSearchCommand} onExtraCommand={command=>{if(command==='export')openExport();else setModal(command==='help'?'help':null);if(command==='outline')setView(current=>current==='outline'?'canvas':'outline');}}/></Suspense>}
          {modal&&modal!=='search'&&(
            <div ref={modalHost} style={{display:'contents'}}>
            <ModalShell kind={modal} locked={creatingBoard||(modal==='export'&&!!busy)} closeDisabled={creatingBoard||xCommitting||(modal==='export'&&!!busy)} onClose={closeModal}>
              <Suspense fallback={null}>
              {modal==='new'&&(
                <NewBoardDialog
                  name={boardName}
                  onName={setBoardName}
                  template={chosenTemplate}
                  onTemplate={setChosenTemplate}
                  directory={boardDirectory}
                  directoryError={directoryError}
                  creating={creatingBoard}
                  readOnly={readOnly}
                  onChooseDirectory={()=>void chooseBoardDirectory()}
                  onClearDirectory={()=>{setBoardDirectory(null);setDirectoryError('');}}
                  onCreate={()=>void addBoard(chosenTemplate)}
                />
              )}
              {modal==='import'&&(
                <ImportDialog
                  mode={linkMode}
                  onModeChange={mode=>{setLinkMode(mode);setImportFormError('');}}
                  value={linkValue}
                  onTextChange={changeLinkText}
                  onXTextChange={value=>{setLinkValue(value);setImportFormError('');}}
                  error={importFormError}
                  xProgress={xImportProgress}
                  xCommitting={xCommitting}
                  xAvailable={!!window.fieldXImports}
                  videoAvailable={isVideoImportAvailable()}
                  native={isNative()}
                  readOnly={readOnly}
                  busy={!!busy}
                  onPickFiles={()=>mediaFile.current?.click()}
                  onSubmitLink={submitLink}
                  onImportX={()=>void importXLinks(linkValue)}
                  onCancelX={closeModal}
                  onRestoreBoardFile={()=>boardFile.current?.click()}
                  onOpenLocalBoard={reconnectLocalBoard}
                  onRunNative={action=>void runNative(action)}
                />
              )}
              {modal==='imports'&&(
                <VideoImportsDialog
                  entries={importEntries}
                  readOnly={readOnly}
                  videoAvailable={isVideoImportAvailable()}
                  isActionPending={id=>videoActions.current.has(id)}
                  onGoToCard={goToImportCard}
                  onCancel={cancelVideoImportAction}
                  onRetry={retryVideoImportAction}
                />
              )}
              {modal==='export'&&(
                <ExportDialog
                  board={board}
                  busy={!!busy}
                  directoryAvailable={!!window.fieldBoardStorage}
                  currentDraftId={writingDraft?.id}
                  lastModifiedDraftId={lastModifiedDraftId}
                  onBusyChange={setBusy}
                  onExportComplete={()=>setModal(null)}
                  onExportPackage={()=>void exportBoardPackage(board,exportHandlers)}
                  onExportDirectory={()=>void exportBoardDirectory(board,exportHandlers)}
                  onExportMarkdown={()=>void exportBoardDraft(board,exportHandlers)}
                  initialView={exportStart.view}
                  initialGroupId={exportStart.groupId}
                  onNotify={notify}
                />
              )}
              {modal==='help'&&<HelpDialog/>}
              </Suspense>
            </ModalShell>
            </div>
          )}
          {recoveryPrompt&&<Suspense fallback={null}><DirectoryRecoveryDialog recovery={recoveryPrompt} onDecision={decideRecovery}/></Suspense>}
          <HiddenFileInputs
            mediaInput={mediaFile}
            boardInput={boardFile}
            subtitleInput={subtitleFile}
            onMediaFiles={files=>void importFiles(files)}
            onBoardFile={file=>void restoreBoardFile(file)}
            onSubtitleFile={file=>void loadSubtitle(file)}
          />
        </div>
        {/* Outside .studio, which is inert behind it (Tab must not reach the sidebar). */}
        {/* While the welcome chunk loads, its empty ground already covers the canvas, so a first launch never flashes the example board. */}
        {showWelcome&&<Suspense fallback={<section className="welcome" aria-hidden="true"/>}><Welcome
          onOpenExample={openExample}
          onNewBoard={()=>{dismissWelcome();setModal('new');}}
          onOpenBoardFile={()=>{dismissWelcome();requestAnimationFrame(()=>boardFile.current?.click());}}
          onHelp={()=>setModal('help')}
          onDismiss={dismissWelcome}
          newBoardShortcut={isNative()?keyOf('new-board','Ctrl N'):undefined}
        /></Suspense>}
      </CardContext.Provider>
    </BoardContext.Provider>
  );
}
