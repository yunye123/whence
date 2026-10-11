import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Board } from '../model';
import { getMedia } from '../storage';
import { followsPictureRatio, imageRatioKey, knownImageRatio, rememberImageRatio } from '../card-placement';
import { isLocalPictureSource, readImageSizeAt } from './local-media';
import type { ToastOptions } from '../shell/Toasts';
import { errorMessage } from './utils';

/**
 * Object URLs for the open board's stored media, their load state and a retry, plus the natural ratio of pictures saved
 * without a height (FC-01). CORE-32: moved out of App.tsx unchanged.
 */
export function useMediaUrls({board,notify}:{board:Board|null;notify:(message:string,options?:ToastOptions)=>void}) {
  const [mediaUrls, setMediaUrls] = useState<Record<string,string>>({});
  const [mediaStatuses,setMediaStatuses]=useState<Record<string,'loading'|'ready'|'missing'|'error'>>({});
  const [mediaRetryVersion,setMediaRetryVersion]=useState(0);
  const mediaUrlsRef=useRef<Record<string,string>>({});
  const mediaLoads=useRef(new Map<string,ReturnType<typeof getMedia>>());
  const mediaKey=useMemo(()=>JSON.stringify([...new Set(board?.nodes.map(node=>node.data.mediaId).filter((id):id is string=>!!id)??[])].sort()),[board?.id,board?.nodes]);
  useEffect(()=>{
    const ids=JSON.parse(mediaKey) as string[];
    let active=true;
    const retained=new Set(ids);
    for(const [id,url] of Object.entries(mediaUrlsRef.current))if(!retained.has(id)){URL.revokeObjectURL(url);delete mediaUrlsRef.current[id];}
    const pending=ids.filter(id=>!mediaUrlsRef.current[id]);
    const outcomes:Record<string,'loading'|'ready'|'missing'|'error'>={};
    setMediaStatuses(previous=>Object.fromEntries(ids.map(id=>[id,mediaUrlsRef.current[id]?'ready':pending.includes(id)?'loading':previous[id]??'loading'])));
    void Promise.allSettled(pending.map(async id=>{
      let loading=mediaLoads.current.get(id);
      if(!loading){loading=getMedia(id);mediaLoads.current.set(id,loading);void loading.finally(()=>{if(mediaLoads.current.get(id)===loading)mediaLoads.current.delete(id);}).catch(()=>{});}
      try{const record=await loading;if(!active)return;if(!record){outcomes[id]='missing';return;}if(!(record.blob instanceof Blob)||!record.blob.size)throw new Error('素材记录无法读取');if(!mediaUrlsRef.current[id])mediaUrlsRef.current[id]=URL.createObjectURL(record.blob);outcomes[id]='ready';}catch(error){outcomes[id]='error';throw error;}
    })).then(results=>{if(!active)return;setMediaUrls(previous=>{const next=mediaUrlsRef.current;const keys=Object.keys(previous);return keys.length===Object.keys(next).length&&keys.every(id=>previous[id]===next[id])?previous:{...next};});setMediaStatuses(previous=>({...previous,...outcomes}));const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')notify(`素材读取失败：${errorMessage(failed.reason)}`);});
    return()=>{active=false;};
  },[mediaKey,mediaRetryVersion,notify]);
  const getMediaStatus=useCallback((id:string)=>mediaUrls[id]?'ready':mediaStatuses[id]??'loading',[mediaUrls,mediaStatuses]);
  const retryMedia=useCallback((id:string)=>{if(mediaUrlsRef.current[id]){URL.revokeObjectURL(mediaUrlsRef.current[id]);delete mediaUrlsRef.current[id];}mediaLoads.current.delete(id);setMediaUrls({...mediaUrlsRef.current});setMediaStatuses(previous=>({...previous,[id]:'loading'}));setMediaRetryVersion(value=>value+1);},[]);
  useEffect(()=>()=>{Object.values(mediaUrlsRef.current).forEach(URL.revokeObjectURL);},[]);
  /**
   * FC-01: image cards saved without a height (earlier versions) follow their picture's ratio. Read the natural
   * size of each such local picture once per session, so tray counts, the sidebar, the moodboard and placement
   * measure a card that has never been on screen at its real height. Nothing is written to the board; a new
   * ratio only re-renders what counts cards (imageRatioVersion).
   */
  const [imageRatioVersion,setImageRatioVersion]=useState(0);
  const imageRatioReads=useRef(new Set<string>());
  useEffect(()=>{
    const wanted=new Map<string,string>();
    for(const node of board?.nodes??[]){
      if(!followsPictureRatio(node)||knownImageRatio(node))continue;
      const key=imageRatioKey(node);if(!key||wanted.has(key)||imageRatioReads.current.has(key))continue;
      const source=node.data.mediaId?mediaUrls[node.data.mediaId]:[node.data.url,node.data.poster].find(isLocalPictureSource);
      if(source)wanted.set(key,source);
    }
    for(const [key,source] of wanted){
      imageRatioReads.current.add(key);
      void readImageSizeAt(source).then(size=>{if(size&&rememberImageRatio(key,size.width,size.height))setImageRatioVersion(value=>value+1);});
    }
  },[board?.nodes,mediaUrls]);
  return {mediaUrls,mediaUrlsRef,getMediaStatus,retryMedia,imageRatioVersion};
}
