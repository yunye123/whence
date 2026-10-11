import { useCallback, useRef, useState, type RefObject } from 'react';
import type { Board, CardData, TranscriptLine, Workspace } from '../model';
import { parseSubtitles } from '../board-utils';
import { transcribeNative, transcribePastedVideo } from '../native';
import { TRANSCRIBE_STARTING, transcribeProgressMessage } from '../../native/transcribe-progress';
import type { ToastOptions } from '../shell/Toasts';
import { pendingImport } from './video-links';
import { transcriptTarget, prepareTranscriptReplacement, type TranscriptReplacementTarget } from './transcript-replacement';
import { errorMessage } from './utils';

/**
 * A film's transcript (CORE-32: moved out of App.tsx unchanged): subtitles from a file (CORE-34), local transcription
 * with its progress, and the one undo step that replaces the lines and their excerpts' references.
 */
export function useTranscripts({boardRef,workspaceRef,readOnlyRef,notify,pushHistory,setNext,changeBoard,setVideoAction,videoActions,subtitleFile}:{
  boardRef:RefObject<Board|null>;
  workspaceRef:RefObject<Workspace|null>;
  readOnlyRef:RefObject<boolean>;
  notify:(message:string,options?:ToastOptions)=>void;
  pushHistory:(old:Board,key?:string)=>void;
  setNext:(next:Workspace)=>void;
  changeBoard:(fn:(value:Board)=>Board,options?:{history?:boolean;key?:string})=>boolean;
  setVideoAction:(id:string,pending:boolean)=>void;
  videoActions:RefObject<Set<string>>;
  subtitleFile:RefObject<HTMLInputElement|null>;
}) {
  const [transcriptionMessages,setTranscriptionMessages]=useState<Record<string,string>>({});
  const subtitleTarget=useRef<TranscriptReplacementTarget|null>(null);
  const commitTranscriptReplacement=useCallback((target:TranscriptReplacementTarget,lines:TranscriptLine[],media?:Partial<CardData>)=>{
    if(readOnlyRef.current)throw new Error('另一个窗口正在编辑，本次字幕尚未保存。');
    const current=workspaceRef.current;const original=current?.boards.find(item=>item.id===target.boardId);
    if(!current||!original)throw new Error('来源画布已移除，本次字幕未覆盖其他卡片。');
    const next=prepareTranscriptReplacement(original,target,lines,media);
    pushHistory(original);
    setNext({...current,boards:current.boards.map(item=>item.id===target.boardId?{...next,updatedAt:new Date().toISOString()}:item)});
  },[pushHistory,setNext]);
  const chooseSubtitles=useCallback((id:string)=>{
    const target=boardRef.current;const node=target?.nodes.find(item=>item.id===id);if(!target||!node)return;
    subtitleTarget.current=transcriptTarget(target,node);subtitleFile.current?.click();
  },[]);
  const loadSubtitle=useCallback(async(file:File)=>{
    const target=subtitleTarget.current;subtitleTarget.current=null;if(!target)return;
    try{
      if(file.size>2*1024*1024)throw new Error('字幕文件请小于 2 MB');
      // CORE-34: the subtitles belong to the card, not the video file; a file without time codes says what it lacks.
      const lines=parseSubtitles(await file.text());if(!lines.length)throw new Error('这个文件里没有带时间的字幕行（例如 00:00:01,000 --> 00:00:03,000），请换一个字幕文件');
      const title=workspaceRef.current?.boards.find(item=>item.id===target.boardId)?.nodes.find(item=>item.id===target.nodeId)?.data.title.trim()||'未命名视频';
      commitTranscriptReplacement(target,lines);notify(`已为「${title}」导入 ${lines.length} 句字幕`);
    }catch(error){notify(errorMessage(error),{tone:'error'});}
  },[commitTranscriptReplacement,notify]);
  /** FD-07: no audio track is a property of that video, not a failure of the app: name it and offer its subtitles. */
  const notifyNoAudio=useCallback((id:string,title:string)=>{
    notify(`「${title.trim()||'未命名视频'}」没有声音，不能生成逐字稿。可以导入它的 SRT 或 VTT 字幕。`,{tone:'info',duration:8000,key:`no-audio:${id}`,action:{label:'导入字幕',ariaLabel:`为「${title.trim()||'未命名视频'}」导入字幕`,onAction:()=>chooseSubtitles(id)}});
  },[chooseSubtitles,notify]);
  const transcribe=useCallback(async(id:string)=>{
    if(readOnlyRef.current){notify('这是只读窗口，请在正在编辑的窗口生成逐字稿。');return;}
    const original=boardRef.current;const node=original?.nodes.find(n=>n.id===id);if(!node||!original)return;
    if(node.data.nativeHasAudio===false){notifyNoAudio(id,node.data.title);return;}
    if(pendingImport(node.data.videoImport?.status)||videoActions.current.has(id)){notify('这条视频正在自动提取逐字稿，请等待当前任务结束。');return;}
    const target=transcriptTarget(original,node);setVideoAction(id,true);
    const progress=(message:string)=>setTranscriptionMessages(current=>({...current,[id]:transcribeProgressMessage(message,node.data.duration)}));progress(TRANSCRIBE_STARTING);
    try{
      if(node.data.nativeAssetId){const lines=await transcribeNative(node,progress);commitTranscriptReplacement(target,lines);notify(`「${node.data.title.trim()||'未命名视频'}」的逐字稿已生成，共 ${lines.length} 句`);}
      else {
        const patch=await transcribePastedVideo(node,original.id,progress);
        if(patch.nativeHasAudio===false){
          // Remembered without an undo step, like the duration the player fills in.
          changeBoard(b=>({...b,nodes:b.nodes.map(item=>item.id===id?{...item,data:{...item.data,nativeHasAudio:false}}:item)}),{history:false});
          notifyNoAudio(id,node.data.title);return;
        }
        commitTranscriptReplacement(target,patch.transcript??[],patch);
        notify(`「${node.data.title.trim()||'未命名视频'}」的逐字稿已生成，共 ${patch.transcript?.length??0} 句`);
      }
    }catch(error){
      if(/没有音轨/.test(errorMessage(error))){notifyNoAudio(id,node.data.title);return;}
      notify(`「${node.data.title.trim()||'未命名视频'}」的逐字稿未完成：${errorMessage(error)}`);
    }finally{setVideoAction(id,false);setTranscriptionMessages(current=>{const next={...current};delete next[id];return next;});}
  },[changeBoard,commitTranscriptReplacement,notify,notifyNoAudio,setVideoAction]);
  return {chooseSubtitles,loadSubtitle,transcribe,transcriptionMessages};
}
