import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Board, Workspace } from '../model';
import { VideoPlaybackSession, type VideoPlayerSurface } from '../video-playback';
import { isNative, ensureNativeProject } from '../native';
import type { ToastOptions } from '../shell/Toasts';
import { videoIdentity } from './transcript-replacement';
import { errorMessage } from './utils';

/**
 * Which film plays where (FV-M4, CORE-10; CORE-32: moved out of App.tsx unchanged): one playback session shared by the
 * card player and the watching workbench, a request counter that drops stale plays, and the binding of players.
 */
export function usePlayback({board,workspaceRef,boardRef,pendingTranscriptEdits,notify,setBusy}:{
  board:Board|null;
  workspaceRef:RefObject<Workspace|null>;
  boardRef:RefObject<Board|null>;
  pendingTranscriptEdits:RefObject<Set<string>>;
  notify:(message:string,options?:ToastOptions)=>void;
  setBusy:Dispatch<SetStateAction<string>>;
}) {
  const [activeVideo,setActiveVideo] = useState<string|null>(null);
  const [videoPlaybackVersion,setVideoPlaybackVersion] = useState(0);
  // A hand-off nobody picks up within a second (the card is off the canvas) leaves the film paused (FV-M4).
  const playbackSession=useRef(new VideoPlaybackSession(run=>{window.setTimeout(run,1000);}));
  const playbackRequest=useRef(0);
  const playbackBoardId=board?.id;
  const setPendingTranscriptEdit=useCallback((id:string,dirty:boolean)=>{
    const key=JSON.stringify([playbackBoardId,id]);
    if(dirty)pendingTranscriptEdits.current.add(key);else pendingTranscriptEdits.current.delete(key);
  },[playbackBoardId]);
  const getVideoPlayback=useCallback((id:string)=>{
    const data=workspaceRef.current?.boards.find(item=>item.id===playbackBoardId)?.nodes.find(item=>item.id===id)?.data;
    return playbackSession.current.get(JSON.stringify([playbackBoardId,id]),data?videoIdentity(data):'');
  },[playbackBoardId]);
  const bindVideoPlayer=useCallback((id:string,surface:VideoPlayerSurface,player:HTMLVideoElement|null)=>{
    const data=workspaceRef.current?.boards.find(item=>item.id===playbackBoardId)?.nodes.find(item=>item.id===id)?.data;
    playbackSession.current.bind(JSON.stringify([playbackBoardId,id]),data?videoIdentity(data):'',surface,player);
  },[playbackBoardId]);
  const captureVideoPlayback=useCallback((id:string,surface:VideoPlayerSurface,player:HTMLVideoElement)=>playbackSession.current.capture(JSON.stringify([playbackBoardId,id]),surface,player),[playbackBoardId]);
  const restoreVideoPlayback=useCallback((id:string,surface:VideoPlayerSurface,player:HTMLVideoElement)=>playbackSession.current.restore(JSON.stringify([playbackBoardId,id]),surface,player),[playbackBoardId]);
  const playVideo=useCallback((id:string|null,time?:number)=>{
    const request=++playbackRequest.current;
    if(!id){playbackSession.current.stop();setActiveVideo(null);return;}
    const target=boardRef.current;const node=target?.nodes.find(n=>n.id===id);if(!node||!target)return;
    const identity=videoIdentity(node.data);
    const begin=()=>{
      const current=workspaceRef.current?.boards.find(item=>item.id===target.id)?.nodes.find(item=>item.id===id);
      if(request!==playbackRequest.current||workspaceRef.current?.activeBoardId!==target.id||!current||videoIdentity(current.data)!==identity)return;
      playbackSession.current.requestPlay(JSON.stringify([target.id,id]),identity,time);
      setActiveVideo(id);setVideoPlaybackVersion(value=>value+1);
    };
    if(node.data.url?.startsWith('media:')&&node.data.nativeAssetId&&!node.data.mediaId&&!node.data.nativeImportJobId&&isNative()){
      setBusy('正在连接原始素材…');
      void ensureNativeProject(node).then(begin).catch(error=>notify(`无法连接原素材：${errorMessage(error)}`)).finally(()=>setBusy(''));
    }else begin();
  },[notify]);
  return {activeVideo,setActiveVideo,videoPlaybackVersion,setVideoPlaybackVersion,playbackSession,playbackRequest,setPendingTranscriptEdit,getVideoPlayback,bindVideoPlayer,captureVideoPlayback,restoreVideoPlayback,playVideo};
}
