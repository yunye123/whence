import { useCallback, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Board, BoardNode, CardData, VideoImportState, Workspace } from '../model';
import { uid } from '../model';
import { saveMedia, removeMedia, validateBoard } from '../storage';
import { prepareXImport, type PreparedXImport } from '../x-import';
import { extractXLinks, normalizeXLink } from '../../shared/x-import';
import { findXPostSource, getStoredXPostText } from '../x-post-source';
import { mergeXVideoSource } from '../x-video-source-merge';
import { createNode } from '../board-utils';
import { isTextSourceFile, readTextSource } from '../text-sources';
import { avoidCaptionObstacles, captionPlacementBounds, placeBatchAtPoint, placeBatchInView, placeCards, placeInView, rememberImageRatio } from '../card-placement';
import { imageCardHeight, readImageSize, readVideoPreview } from './local-media';
import type { Rect } from '../canvas/safe-area';
import { importNativeProject, importNativeFiles } from '../native';
import { isVideoImportAvailable } from '../video-import';
import { showToast, type ToastOptions } from '../shell/Toasts';
import type { CanvasRevealRequest, CanvasView, LinkMode, Modal } from './types';
import { errorMessage } from './utils';
import { VIDEO_BATCH_LIMIT, sharedLinks, isXUrl, videoPlatform, recognizableVideo, taskTitle } from './video-links';
import { ImportRefusal, importFailure, importKind, importRefusal } from './import-messages';

/**
 * Everything that brings material in (CORE-32: moved out of App.tsx unchanged): files and pasted text (K9-11), web and
 * video links (background tasks on the desktop), X posts with their pictures and films, a replaced picture or film
 * (CORE-08), the desktop's local files and older projects, and the import dialog's own state.
 */
export function useImportFlows({workspaceRef,boardRef,readOnlyRef,readOnly,busyRef,setBusy,measurements,measurementsRef,persist,saveVersion,pushHistory,setNext,changeBoard,notify,fitCanvas,importToast,center,visibleView,batchFits,markFresh,openCard,insertBoard,setModal,setSelectedIds,setSelectedEdgeIds,setView,setCanvasReveal,updateImportCard,launchVideoImport,pendingVideoSubmissions}:{
  workspaceRef:RefObject<Workspace|null>;
  boardRef:RefObject<Board|null>;
  readOnlyRef:RefObject<boolean>;
  readOnly:boolean;
  busyRef:RefObject<string>;
  setBusy:Dispatch<SetStateAction<string>>;
  measurements:Record<string,{width:number;height:number}>;
  measurementsRef:RefObject<Record<string,{width:number;height:number}>>;
  persist:(value:Workspace,version:number,silent?:boolean)=>Promise<void>;
  saveVersion:RefObject<number>;
  pushHistory:(old:Board,key?:string)=>void;
  setNext:(next:Workspace)=>void;
  changeBoard:(fn:(value:Board)=>Board,options?:{history?:boolean;key?:string})=>boolean;
  notify:(message:string,options?:ToastOptions)=>void;
  fitCanvas:(duration?:number,ids?:string[])=>void;
  importToast:RefObject<string|null>;
  center:()=>{x:number;y:number};
  visibleView:()=>Rect;
  batchFits:(nodes:BoardNode[])=>boolean;
  markFresh:(ids:string[])=>void;
  openCard:(id:string)=>void;
  insertBoard:(b:Board,message?:string|null)=>void;
  setModal:Dispatch<SetStateAction<Modal>>;
  setSelectedIds:Dispatch<SetStateAction<string[]>>;
  setSelectedEdgeIds:Dispatch<SetStateAction<string[]>>;
  setView:Dispatch<SetStateAction<CanvasView>>;
  setCanvasReveal:Dispatch<SetStateAction<CanvasRevealRequest|null>>;
  updateImportCard:(boardId:string,nodeId:string,attemptId:string,material?:Partial<CardData>,taskPatch?:Partial<VideoImportState>)=>boolean;
  launchVideoImport:(boardId:string,nodeId:string,attemptId:string)=>void;
  pendingVideoSubmissions:RefObject<Set<string>>;
}) {
  const [xPostErrors,setXPostErrors]=useState<Record<string,string>>({});
  const [xPostLoadingIds,setXPostLoadingIds]=useState<string[]>([]);
  const [linkValue,setLinkValue]=useState('');
  // The import dialog opens on a way that works here: video links need the desktop app (IM-M1).
  const [linkMode,setLinkMode]=useState<LinkMode>(()=>isVideoImportAvailable()?'video':'web');
  const [importFormError,setImportFormError]=useState('');
  const [xImportProgress,setXImportProgress]=useState('');
  const [xCommitting,setXCommitting]=useState(false);
  const xRun=useRef<{controller:AbortController;requestId:string;committing:boolean}|null>(null);
  const cancelXImport=useCallback(()=>{
    const run=xRun.current;if(!run||run.committing)return;
    run.controller.abort();
    if(run.requestId)void window.fieldXImports?.cancel(run.requestId).catch(()=>{});
  },[]);
  const closeModal=useCallback(()=>{if(xRun.current?.committing)return;cancelXImport();setModal(null);},[cancelXImport]);
  /** CORE-07: an import that does not fit the view offers “查看全部”; running it (button, F, palette) takes the toast down. */
  const viewAllAction=useMemo(()=>({label:'查看全部',ariaLabel:'查看全部（F）',onAction:()=>fitCanvas()}),[fitCanvas]);
  const notifyImported=useCallback((message:string,overflow:boolean)=>{importToast.current=showToast(message,{tone:'info',key:'import-result',settle:true,...(overflow?{action:viewAllAction,duration:8000}:{})});},[viewAllAction]);
  const importXLinks=useCallback(async(text:string,point?:{x:number;y:number},sourceOnly=false):Promise<string|undefined>=>{
    if(xRun.current)return;
    const fail=(message:string)=>{setImportFormError(message);notify(message);};
    if(readOnlyRef.current){fail('当前窗口只读，请在正在编辑的窗口导入。');return;}
    if(!window.fieldXImports){setLinkValue(text.slice(0,12000));setLinkMode('x');setModal('import');fail('请在来处桌面版导入 X 正文与素材。');return;}
    if(busyRef.current){fail('当前素材还在处理中，请稍后再导入。');return;}
    let links:ReturnType<typeof extractXLinks>;
    try{links=extractXLinks(text);if(!links.length)throw new Error('请粘贴具体推文的完整链接。');if(links.length>10)throw new Error('一次最多导入 10 条推文，请分批粘贴。');if(sharedLinks(text).some(url=>!isXUrl(url)))throw new Error('请将 X 推文与其他平台链接分批导入。');}catch(error){fail(errorMessage(error));return;}
    const current=workspaceRef.current,target=current?.boards.find(item=>item.id===current.activeBoardId);if(!target)return;
    const view=visibleView();
    const boardId=target.id,position=point??{x:Math.round(view.x+view.width/2-145),y:Math.round(view.y+view.height/2-220)},run={controller:new AbortController(),requestId:'',committing:false};
    xRun.current=run;setImportFormError('');setLinkValue(text);setLinkMode('x');setModal('import');
    busyRef.current='正在导入 X 正文与素材';setBusy(busyRef.current);
    let imported=0,duplicates=0,videos=0;const warnings:string[]=[],selected:string[]=[];
    const check=()=>{if(run.controller.signal.aborted)throw new DOMException('X 导入已取消。','AbortError');if(readOnlyRef.current)throw new Error('当前窗口已变为只读，尚未添加这条推文。');};
    const cleanup=async(prepared:PreparedXImport)=>{for(const id of prepared.mediaIds)await removeMedia(id);};
    try{
      for(const [index,link] of links.entries()){
        check();run.requestId=uid();setXImportProgress(`正在读取第 ${index+1}/${links.length} 条推文的正文与原图…`);
        const result=await window.fieldXImports.resolve({url:link.url,requestId:run.requestId,sourceOnly});check();
        let prepared:PreparedXImport|undefined,original:Board|undefined;
        for(let attempt=0;attempt<3;attempt++){
          check();original=workspaceRef.current?.boards.find(item=>item.id===boardId);if(!original)throw new Error('目标画布已移除，尚未添加这条推文。');
          prepared=await prepareXImport(result,original,{position,measurements,originalText:text,sourceOnly,signal:run.controller.signal});
          if(run.controller.signal.aborted||readOnlyRef.current||workspaceRef.current?.boards.find(item=>item.id===boardId)!==original){await cleanup(prepared);prepared=undefined;check();continue;}
          if(!prepared.duplicate){
            const nodes=avoidCaptionObstacles(prepared.nodes,original.nodes,measurementsRef.current);
            const placed=new Map(nodes.map(node=>[node.id,node]));
            prepared={...prepared,nodes,board:{...prepared.board,nodes:prepared.board.nodes.map(node=>placed.get(node.id)??node)}};
          }
          break;
        }
        if(!prepared||!original)throw new Error('画布正在变化，请稍后重试。已保存的原有卡片未覆盖。');
        warnings.push(...prepared.warnings);selected.push(prepared.sourceNodeId,...prepared.nodes.map(node=>node.id));
        if(prepared.duplicate){duplicates++;continue;}
        // All local images and the queued video cards commit before any download starts.
        run.committing=true;setXCommitting(true);prepared.videoNodeIds.forEach(id=>pendingVideoSubmissions.current.add(id));
        const latest=workspaceRef.current!;const next={...latest,boards:latest.boards.map(item=>item.id===boardId?prepared!.board:item)};
        pushHistory(original);setNext(next);
        try{await persist(next,saveVersion.current);}catch(error){
          prepared.videoNodeIds.forEach(id=>pendingVideoSubmissions.current.delete(id));
          for(const id of prepared.videoNodeIds){const node=prepared.board.nodes.find(item=>item.id===id)!;updateImportCard(boardId,id,node.data.videoImport!.attemptId,{}, {status:'failed',message:'任务尚未开始',error:`导入结果保存失败，请解决保存问题后重试：${errorMessage(error)}`.slice(0,4096)});}
          throw new Error(`导入结果未保存成功，视频下载尚未开始：${errorMessage(error)}`);
        }
        for(const id of prepared.videoNodeIds){pendingVideoSubmissions.current.delete(id);const node=prepared.board.nodes.find(item=>item.id===id)!;launchVideoImport(boardId,id,node.data.videoImport!.attemptId);}
        imported++;videos+=prepared.videoNodeIds.length;run.committing=false;setXCommitting(false);
      }
      if(workspaceRef.current?.activeBoardId===boardId){const ids=[...new Set(selected)];setSelectedIds(ids);setSelectedEdgeIds([]);setView('canvas');if(ids.length)setCanvasReveal({boardId,ids,instant:false});}
      setModal(null);setLinkValue('');
      const summary=imported?`已导入 ${imported} 条 X 推文的正文与素材${duplicates?`，${duplicates} 条已在画布中`:''}。${videos?`${videos} 个视频在后台继续下载。`:''}`:'这些推文已在画布中，未重复添加。';
      notify(`${summary}${warnings.length?` ${[...new Set(warnings)].join('；').slice(0,600)}`:''}`);
      return selected[0];
    }catch(error){
      const cancelled=run.controller.signal.aborted||error instanceof DOMException&&error.name==='AbortError';
      const message=cancelled?`已取消 X 导入${imported?`，之前已保存的 ${imported} 条推文保留在画布中`:''}。`:`${imported?`已保存 ${imported} 条；`:''}${errorMessage(error)}`;
      setImportFormError(cancelled?'':message);notify(message);
    }finally{if(xRun.current===run){xRun.current=null;setXImportProgress('');setXCommitting(false);busyRef.current='';setBusy('');}}
  },[launchVideoImport,measurements,notify,persist,pushHistory,setNext,updateImportCard,visibleView]);
  const readXPost=useCallback(async(id:string)=>{
    const target=boardRef.current,node=target?.nodes.find(item=>item.id===id);if(!target||!node)return;
    const source=findXPostSource(target.nodes,node);
    const text=getStoredXPostText(node);
    const full=(status?:string)=>/正文完整|已保存完整原帖正文|原帖没有文字正文/.test(status??'');
    if(source&&full(source.data.sourceStatus)){
      if(!readOnlyRef.current&&node.data.videoImport){
        const patch=mergeXVideoSource(node,{sourceOriginalText:getStoredXPostText(source),sourceStatus:source.data.sourceStatus,sourceAuthor:source.data.sourceAuthor,sourceTitle:source.data.sourceTitle,sourceUrl:node.data.sourceUrl??node.data.videoImport.url});
        if(Object.keys(patch).length)updateImportCard(target.id,id,node.data.videoImport.attemptId,{...patch,sourceUrl:node.data.sourceUrl??node.data.videoImport.url});
      }
      openCard(source.id);return;
    }
    if(readOnlyRef.current){if(source)openCard(source.id);return;}
    setXPostErrors(previous=>({...previous,[id]:''}));
    if(text!==undefined&&full(node.data.sourceStatus)){
      try{
        const url=normalizeXLink(node.data.sourceUrl??node.data.videoImport?.url??'').url;
        const reading=createNode('link',{x:node.position.x+340,y:node.position.y});
        reading.data={...reading.data,title:node.data.sourceTitle||'X 原帖正文',body:text,url,sourceUrl:url,sourceOriginalText:text,sourceAuthor:node.data.sourceAuthor,sourceTitle:node.data.sourceTitle,sourceStatus:`正文完整；${node.data.sourceStatus??''}`};
        const raw=measurementsRef.current;
        const placed=placeCards([reading],target.nodes,{origin:reading.position,measurements:raw,bounds:captionPlacementBounds(target.nodes,raw)});
        const next={...target,nodes:[...target.nodes,...placed],edges:[...target.edges,{id:uid(),source:reading.id,target:id,type:'smoothstep',label:'原帖正文'}]};
        validateBoard(next);
        if(!changeBoard(current=>current===target?next:current))throw new Error('正文来源暂未保存，请重试。');
        const saved=workspaceRef.current!;await persist(saved,saveVersion.current);
        if(boardRef.current?.id===target.id)openCard(reading.id);
      }catch(error){const message=errorMessage(error);setXPostErrors(previous=>({...previous,[id]:message}));notify(message);}
      return;
    }
    if(xRun.current||busyRef.current){const message='当前素材还在处理中，请稍后补全正文。';setXPostErrors(previous=>({...previous,[id]:message}));notify(message);return;}
    setXPostLoadingIds(previous=>[...previous,id]);
    try{
      const url=normalizeXLink(node.data.sourceUrl??node.data.videoImport?.url??'').url;
      const sourceId=await importXLinks(url,{x:node.position.x+340,y:node.position.y},true);
      if(sourceId&&boardRef.current?.id===target.id)openCard(sourceId);
      else if(!sourceId)setXPostErrors(previous=>({...previous,[id]:'正文未补全，可重试；视频和观看笔记已保留。'}));
    }catch(error){setXPostErrors(previous=>({...previous,[id]:errorMessage(error)}));}
    finally{setXPostLoadingIds(previous=>previous.filter(item=>item!==id));}
  },[changeBoard,importXLinks,measurements,notify,openCard,persist,updateImportCard]);
  const queueVideoLinks=useCallback(async(text:string,point?:{x:number;y:number},selectedLinks?:string[])=>{
    setImportFormError('');
    if(readOnlyRef.current){notify('当前窗口只读，请在正在编辑的窗口导入。');return;}
    const fail=(message:string)=>{setImportFormError(message);notify(message);};
    if(!isVideoImportAvailable()){fail('自动下载与逐字稿需要来处桌面版。在浏览器里仍可导入本机视频、字幕，或保存网页资料。');return;}
    if(text.length>20000){fail('分享文案较长，请保留视频链接后重试（最多 20,000 字符）。');return;}
    const urls=selectedLinks??sharedLinks(text);if(!urls.length){fail('没有找到完整的 http 或 https 链接。可直接粘贴平台的分享文案。');return;}
    if(urls.some(isXUrl)){setLinkMode('x');await importXLinks(text,point);return;}
    if(urls.length>VIDEO_BATCH_LIMIT){fail(`一次最多导入 ${VIDEO_BATCH_LIMIT} 个视频，请分批粘贴。`);return;}
    const current=workspaceRef.current;const target=current?.boards.find(item=>item.id===current.activeBoardId);if(!current||!target)return;
    const existing=target.nodes.filter(node=>node.data.kind==='video'&&node.data.videoImport&&urls.includes(node.data.videoImport.url));
    const fresh=urls.filter(url=>!existing.some(node=>node.data.videoImport?.url===url));
    if(!fresh.length){setSelectedIds(existing.map(node=>node.id));setModal(null);setView('canvas');notify('这些视频已在画布中；未完成的任务可在原卡片重试。');return;}
    const base=point??center();const now=new Date().toISOString();
    const tasks=fresh.map(url=>{const node=createNode('video',base);node.style={width:320};node.data={...node.data,title:taskTitle(url),body:'',sourceUrl:url,sourceOriginalText:text,tags:[videoPlatform(url)],collectedAt:now,videoImport:{attemptId:uid(),url,originalText:text,status:'queued',message:'正在保存任务，随后开始下载',mediaReady:false,createdAt:now,updatedAt:now}};return node;});
    // Task cards follow the import rule: visible canvas, revealed and selected (§5.4).
    const raw=measurementsRef.current,bounds=captionPlacementBounds(target.nodes,raw);
    const nodes=point?placeCards(tasks,target.nodes,{origin:base,measurements:raw,preserveFirst:true,bounds}):placeBatchInView(tasks,target.nodes,visibleView(),raw,bounds);
    const updated={...target,nodes:[...target.nodes,...nodes],updatedAt:now};
    try{validateBoard(updated);}catch(error){fail(`视频任务未创建：${errorMessage(error)}`);return;}
    const next={...current,boards:current.boards.map(item=>item.id===target.id?updated:item)};
    nodes.forEach(node=>pendingVideoSubmissions.current.add(node.id));
    pushHistory(target);setNext(next);setSelectedIds(nodes.map(node=>node.id));setModal(null);setLinkValue('');setView('canvas');setCanvasReveal({boardId:target.id,ids:nodes.map(node=>node.id),instant:false});
    try{await persist(next,saveVersion.current);}catch(error){
      nodes.forEach(node=>pendingVideoSubmissions.current.delete(node.id));
      for(const node of nodes)updateImportCard(target.id,node.id,node.data.videoImport!.attemptId,{}, {status:'failed',message:'任务尚未开始',error:`任务卡保存失败，请解决保存问题后重试：${errorMessage(error)}`.slice(0,4096)});
      notify('任务卡没有保存成功，视频下载尚未开始。');return;
    }
    for(const node of nodes){pendingVideoSubmissions.current.delete(node.id);launchVideoImport(target.id,node.id,node.data.videoImport!.attemptId);}
    notify(`已加入 ${nodes.length} 个视频任务${existing.length?`，${existing.length} 个已在画布中`:''}。可继续创作或切换画布。`);
  },[center,importXLinks,launchVideoImport,notify,persist,pushHistory,setNext,updateImportCard,measurements,visibleView]);
  const importFiles=useCallback(async(files:File[],point?:{x:number;y:number})=>{
    if(readOnly)return;
    setBusy('正在保存素材…');
    const targetBoard=workspaceRef.current?.activeBoardId;
    try{
      const nodes:BoardNode[]=[];const failures:string[]=[];const converted:string[]=[];const base=point??center();let overflow=false;
      for(const file of files){
        try{
          if(isTextSourceFile(file)){
            const {encoding,...material}=await readTextSource(file);const node=createNode('note',base);node.data={...node.data,...material};nodes.push(node);
            if(encoding==='gb18030')converted.push(material.title);
            continue;
          }
          const kind=importKind(file);
          if(kind!=='image'&&kind!=='video')throw new ImportRefusal(importRefusal(file,kind));
          const video=kind==='video';
          // CORE-08: a file the browser cannot decode is not imported (no card that only says “未找到” or plays black).
          const preview=video?await readVideoPreview(file):undefined;
          const size=video?null:await readImageSize(file);
          if(preview?.undecodable||(!video&&!size))throw new ImportRefusal(`「${file.name}」无法解码，可能已损坏。换一个${video?'视频':'图片'}文件再试`);
          const media=await saveMedia(file,file.name);const node=createNode(video?'video':'image',base);
          // No default caption or "本地素材" tag is written into the material (CD-M3).
          node.data.title=file.name.replace(/\.[^.]+$/,'');node.data.mediaId=media.id;
          if(preview){
            // FV-M7: a poster frame at the film's own ratio and its running time, before the card is ever played.
            if(preview.poster)node.data.poster=preview.poster;
            if(preview.duration)node.data.duration=preview.duration;
          }else{
            // FC-04: the picture's own height from the start, so the batch is laid out (and later placed around) at its real size.
            const height=size&&imageCardHeight(size.width,size.height,node.style?.width);
            if(height)node.style={...node.style,height};
            if(size)rememberImageRatio(`media:${media.id}`,size.width,size.height);
          }
          nodes.push(node);
        }catch(error){failures.push(error instanceof ImportRefusal?error.message:importFailure(file,error));}
      }
      if(workspaceRef.current?.activeBoardId!==targetBoard)throw new Error('画布已切换，请回到原画布重新导入');
      // INSP-21: when these sources were collected into the board (notes, drafts and excerpts never carry it).
      const collectedAt=new Date().toISOString();for(const node of nodes)node.data.collectedAt=collectedAt;
      if(nodes.length){
        const current=boardRef.current;if(!current||current.id!==targetBoard)throw new Error('原画布已不存在');
        // §5.4: a drop keeps the batch together around the pointer (FC-02); other imports start in the largest empty
        // area of the visible canvas. Both use known sizes before React Flow measures anything (CV-B1), and the
        // viewport follows the batch either way (P5).
        const raw=measurementsRef.current,bounds=captionPlacementBounds(current.nodes,raw);
        const placed=point?placeBatchAtPoint(nodes,current.nodes,point,visibleView(),raw,bounds):placeBatchInView(nodes,current.nodes,visibleView(),raw,bounds);
        if(!changeBoard(b=>({...b,nodes:[...b.nodes,...placed]})))throw new Error('素材未写入画布，请检查保存状态后重试');
        setSelectedIds(placed.map(node=>node.id));setSelectedEdgeIds([]);setModal(null);markFresh(placed.map(node=>node.id));
        overflow=!batchFits(placed);setCanvasReveal({boardId:current.id,ids:placed.map(node=>node.id),instant:false});
      }
      const note=converted.length?`（${converted.length>1?`${converted.length} 份文字`:`「${converted[0]}」`}是 GBK 中文编码，已自动转换）`:'';
      // CORE-07: nothing imported says why and what to do, and stays until closed; a partial import names what was left out.
      if(!nodes.length&&failures.length)notify(`没有导入：${failures[0]}${failures.length>1?`（另有 ${failures.length-1} 个文件也未导入）`:''}。`,{tone:'error',duration:null,key:'import-result'});
      else if(failures.length)notify(`已导入 ${nodes.length} 个素材；${failures.length} 个未导入：${failures[0]}${failures.length>1?' 等':''}。${note}`,{tone:'error',duration:null,key:'import-result',settle:true,...(overflow?{action:viewAllAction}:{})});
      else notifyImported(`已导入 ${nodes.length} 个素材${note}`,overflow);
    }catch(error){notify(`导入失败：${errorMessage(error)}`);}finally{setBusy('');}
  },[batchFits,center,changeBoard,markFresh,notify,notifyImported,readOnly,viewAllAction,visibleView]);
  /**
   * CORE-08 (card side, integration request fix-canvas §1): a picture or film that is there but cannot be shown is
   * replaced by another file of the same kind. Same decode check and wording as the import; one undo step writes the
   * new mediaId (a film with its poster and running time; a picture with its own height). Nothing changes on refusal.
   */
  const replaceMedia=useCallback((id:string)=>{
    if(readOnlyRef.current)return;
    const target=boardRef.current?.nodes.find(node=>node.id===id);const boardId=boardRef.current?.id;
    const kind=target?.data.kind;if(!boardId||(kind!=='image'&&kind!=='video'))return;
    const video=kind==='video';
    const input=document.createElement('input');input.type='file';
    input.accept=video?'video/mp4,video/webm,video/quicktime':'image/png,image/jpeg,image/webp,image/gif';
    input.addEventListener('change',()=>{
      const file=input.files?.[0];if(!file)return;
      setBusy(video?'正在换视频…':'正在换图片…');
      void (async()=>{
        try{
          const found=importKind(file);
          if(found!==kind)throw new ImportRefusal(found==='image'||found==='video'?`「${file.name}」不是${video?'视频':'图片'}。换一个${video?'视频':'图片'}文件再试`:importRefusal(file,found));
          const preview=video?await readVideoPreview(file):undefined;
          const size=video?null:await readImageSize(file);
          if(preview?.undecodable||(!video&&!size))throw new ImportRefusal(`「${file.name}」无法解码，可能已损坏。换一个${video?'视频':'图片'}文件再试`);
          const media=await saveMedia(file,file.name);
          const current=boardRef.current;const node=current?.id===boardId?current.nodes.find(item=>item.id===id):undefined;
          if(!node){await removeMedia(media.id).catch(()=>{});throw new ImportRefusal('卡片已不在当前画布，没有换文件');}
          const patch:Partial<CardData>={mediaId:media.id};
          if(preview){if(preview.poster)patch.poster=preview.poster;if(preview.duration)patch.duration=preview.duration;}
          const height=size?imageCardHeight(size.width,size.height,node.style?.width):undefined;
          if(size)rememberImageRatio(`media:${media.id}`,size.width,size.height);
          if(!changeBoard(b=>({...b,nodes:b.nodes.map(item=>item.id===id?{...item,data:{...item.data,...patch},...(height?{style:{...item.style,height}}:{})}:item)}))){await removeMedia(media.id).catch(()=>{});return;}
          // A landscape picture swapped for a portrait one grows downwards: the card is selected and followed into the safe
          // area, and the toast waits for the camera, so it never sits on the card's lower edge (round 4, S7).
          setSelectedIds([id]);setSelectedEdgeIds([]);
          setCanvasReveal({boardId,ids:[id],instant:false});
          notify(`已换成「${file.name}」`,{settle:true});
        }catch(error){notify(error instanceof ImportRefusal?`没有换：${error.message}。`:`没有换：${importFailure(file,error)}。`,{tone:'error'});}
        finally{setBusy('');}
      })();
    },{once:true});
    input.click();
  },[changeBoard,notify]);
  const importUrl=useCallback((text=linkValue,point?:{x:number;y:number},selectedLinks?:string[])=>{
    if(readOnlyRef.current)return;
    const urls=selectedLinks??sharedLinks(text);
    if(urls.some(isXUrl)){void importXLinks(text,point);return;}
    if(!urls.length){const message='没有找到完整的 http 或 https 链接。';setImportFormError(message);notify(message);return;}
    if(urls.length>VIDEO_BATCH_LIMIT||text.length>20000){notify('请分批收集，每次最多 20 个链接和 20,000 字符。');return;}
    const base=point??center();const current=boardRef.current;if(!current)return;
    const collectedAt=new Date().toISOString();
    const links=urls.map(url=>{const node=createNode('link',base);node.data.url=url;node.data.collectedAt=collectedAt;node.data.title=new URL(url).hostname.replace(/^www\./,'');node.data.body=text.trim()===url?'':text;return node;});
    const raw=measurementsRef.current,bounds=captionPlacementBounds(current.nodes,raw);
    const nodes=point?placeCards(links,current.nodes,{origin:base,measurements:raw,preserveFirst:true,bounds}):placeBatchInView(links,current.nodes,visibleView(),raw,bounds);
    if(!changeBoard(b=>({...b,nodes:[...b.nodes,...nodes]})))return;
    setSelectedIds(nodes.map(node=>node.id));setModal(null);setLinkValue('');setImportFormError('');markFresh(nodes.map(node=>node.id));notify(`已加入 ${nodes.length} 个链接`,{settle:true});
    if(!point)setCanvasReveal({boardId:current.id,ids:nodes.map(node=>node.id),instant:false});
  },[center,changeBoard,importXLinks,linkValue,markFresh,measurements,notify,visibleView]);
  const runNative=useCallback(async(action:'project'|'files')=>{
    if(readOnlyRef.current){notify('这是只读窗口，请在正在编辑的窗口导入素材。');return;}
    const targetBoard=workspaceRef.current?.activeBoardId;
    setBusy(action==='project'?'正在打开原有素材库…':'正在处理本机素材…');
    try{if(action==='project'){const b=await importNativeProject();if(b)insertBoard(b);}else{const nodes=await importNativeFiles();const collectedAt=new Date().toISOString();for(const node of nodes)node.data.collectedAt??=collectedAt;if(nodes.length){const current=boardRef.current;if(!current||current.id!==targetBoard)throw new Error('画布已切换，请回到原画布重新导入');const placed=placeBatchInView(nodes,current.nodes,visibleView(),measurementsRef.current,captionPlacementBounds(current.nodes,measurementsRef.current));if(!changeBoard(b=>({...b,nodes:[...b.nodes,...placed]})))return;setSelectedIds(placed.map(node=>node.id));setModal(null);setCanvasReveal({boardId:current.id,ids:placed.map(node=>node.id),instant:false});notifyImported(`已导入 ${nodes.length} 个素材`,!batchFits(placed));}}}catch(error){notify(errorMessage(error));}finally{setBusy('');}
  },[batchFits,changeBoard,insertBoard,notify,notifyImported,visibleView]);
  /** Paste router (K9-11): X links, video links (desktop), web pages, or plain text as a note. */
  const pasteText=useCallback((text:string)=>{
      if(!text)return;
      const urls=sharedLinks(text);const videos=urls.filter(recognizableVideo);
      if(urls.some(isXUrl)){void importXLinks(text);return;}
      if(videos.length){
        if(!isVideoImportAvailable()){setLinkValue(text.slice(0,20000));setLinkMode('video');setImportFormError('自动下载与逐字稿需要来处桌面版。也可以切换为网页资料，先保存来源。');setModal('import');return;}
        if(urls.length>VIDEO_BATCH_LIMIT||text.length>20000){notify('请分批粘贴，每次最多 20 个链接和 20,000 字符。');return;}
        void queueVideoLinks(text,undefined,videos);
        const webpages=urls.filter(url=>!videos.includes(url));if(webpages.length)importUrl(text,undefined,webpages);
      }else if(urls.length)importUrl(text);
      else{if(text.length>300000){notify('这段文字较长，请分成不超过 300,000 字符的笔记。');return;}const current=boardRef.current;if(!current)return;const created=createNode('note');created.data.body=text;const node=placeInView(created,current.nodes,visibleView(),measurementsRef.current,'straddle',captionPlacementBounds(current.nodes,measurementsRef.current));if(!changeBoard(b=>({...b,nodes:[...b.nodes,node]})))return;setSelectedIds([node.id]);setSelectedEdgeIds([]);markFresh([node.id]);setCanvasReveal({boardId:current.id,ids:[node.id],instant:false});notify('已粘贴为笔记');}
    },[changeBoard,importUrl,importXLinks,markFresh,notify,queueVideoLinks,visibleView]);
  /** “从剪贴板粘贴” in the add menu and the canvas menu: the same router as Ctrl V (toolbar 2.3). */
  const pasteFromMenu=useCallback(async()=>{
    if(readOnlyRef.current)return;
    if(window.fieldLocalFiles){
      const target=workspaceRef.current?.activeBoardId;
      try{const result=await window.fieldLocalFiles.readClipboard();if(workspaceRef.current?.activeBoardId!==target){notify('画布已切换，请在目标画布重新粘贴。');return;}
        if(result.files.length)await importFiles(result.files.map(file=>new File([new Uint8Array(file.data)],file.name,{type:file.mime})));
        else if(!result.failures.length)pasteText(result.text.trim());
        if(result.failures.length)notify(`部分文件未粘贴：${result.failures[0]}`);
      }catch(error){notify(`剪贴板暂时无法读取：${errorMessage(error)}。也可以拖入文件或选择素材。`);}
      return;
    }
    try{
      const files:File[]=[];let text='';
      for(const item of await navigator.clipboard.read())for(const type of item.types){
        if(type==='text/plain')text=await (await item.getType(type)).text();
        else if(/^(image|video|audio)\//.test(type)){const blob=await item.getType(type);files.push(new File([blob],`粘贴的${type.startsWith('image/')?'图片':type.startsWith('video/')?'视频':'音频'}.${type.split('/')[1]}`,{type}));}
      }
      if(files.length)await importFiles(files);else if(text.trim())pasteText(text.trim());else notify('剪贴板里没有可以放进画布的内容。');
    }catch{notify('浏览器没有允许读取剪贴板。焦点在画布上时按 Ctrl V 即可粘贴。');}
  },[importFiles,notify,pasteText]);
  return {linkValue,setLinkValue,linkMode,setLinkMode,importFormError,setImportFormError,xImportProgress,xCommitting,xRun,closeModal,importXLinks,readXPost,xPostErrors,xPostLoadingIds,queueVideoLinks,importFiles,replaceMedia,importUrl,runNative,pasteText,pasteFromMenu};
}
