import type { Board, CardData, VideoImportState } from '../model';
import { validateBoard } from '../storage';
import { mergeAutomaticTranscript } from '../transcript-tools';
import { mergeXVideoSource } from '../x-video-source-merge';
import { isXUrl, taskTitle } from './video-links';
import { errorMessage } from './utils';

export function differentNativeAsset(current:CardData,incoming:Partial<CardData>):boolean {
  return !!current.nativeProjectId&&!!current.nativeAssetId&&!!incoming.nativeProjectId&&!!incoming.nativeAssetId&&(current.nativeProjectId!==incoming.nativeProjectId||current.nativeAssetId!==incoming.nativeAssetId);
}
export function keepCachedImportMedia(current:CardData,incoming:Partial<CardData>,key:'mediaId'|'poster'|'nativeMediaWarning'):boolean {
  const sameAsset=!!current.nativeProjectId&&!!current.nativeAssetId&&(incoming.nativeProjectId??current.nativeProjectId)===current.nativeProjectId&&(incoming.nativeAssetId??current.nativeAssetId)===current.nativeAssetId;
  if(!sameAsset)return false;
  if(key==='mediaId')return !!current.mediaId;
  if(key==='poster')return !!current.poster?.startsWith('data:image/')&&!!incoming.poster?.startsWith('media:');
  return !!current.mediaId;
}
export function needsImportPosterRestore(data:CardData):boolean {
  return data.kind==='video'&&!!data.mediaId&&!!data.nativeProjectId&&!!data.nativeAssetId&&!!data.nativeImportJobId&&!!data.videoImport?.mediaReady&&!!data.url?.startsWith('media:')&&!!data.poster?.startsWith('media:');
}

/** A rejected native result becomes one visible failure, never a repeated save/render cycle. */
export function prepareVideoImportUpdate(target:Board,nodeId:string,attemptId:string,material:Partial<CardData>={},taskPatch:Partial<VideoImportState>={}):{board?:Board;valid:boolean;error?:string} {
  const node=target.nodes.find(item=>item.id===nodeId);
  if(!node?.data.videoImport||node.data.videoImport.attemptId!==attemptId)return {valid:false};
  const old=node.data.videoImport;
  const {body:_body,title:materialTitle,videoImport:_task,sourceUrl:_sourceUrl,sourceOriginalText:_sourceText,sourceStatus:_sourceStatus,sourceAuthor:_sourceAuthor,sourceTitle:_sourceTitle,sourceDescription:_sourceDescription,tags:_tags,...providedMedia}=material;
  let media:Partial<CardData>=Object.fromEntries(Object.entries(providedMedia).filter(([key,value])=>value!==undefined||key==='nativeImportJobId'));
  if(!isXUrl(old.url)){
    if(_sourceAuthor!==undefined)media.sourceAuthor=_sourceAuthor;
    if(_sourceTitle!==undefined)media.sourceTitle=_sourceTitle;
    if(_sourceStatus!==undefined)media.sourceStatus=_sourceStatus;
    if(_sourceDescription!==undefined)media.sourceDescription=_sourceDescription;
  }
  for(const key of ['mediaId','poster','nativeMediaWarning'] as const)if(keepCachedImportMedia(node.data,material,key))delete media[key];
  if(differentNativeAsset(node.data,material)){media.mediaId=material.mediaId;media.poster=material.poster;media.transcript=material.transcript;}
  const nextTask:VideoImportState={...old,...taskPatch,updatedAt:taskPatch.updatedAt??new Date().toISOString()};
  const title=materialTitle&&node.data.title===taskTitle(old.url)?materialTitle:node.data.title;
  let data:CardData=node.data;
  const comparable=(value:CardData)=>JSON.stringify({...value,videoImport:value.videoImport?{...value.videoImport,updatedAt:''}:undefined});
  const changed=()=>({...target,nodes:target.nodes.map(item=>item.id===nodeId?{...item,data}:item),updatedAt:new Date().toISOString()});
  try{
    media=mergeAutomaticTranscript(node.data,media,differentNativeAsset(node.data,material));
    data={...node.data,...media,...mergeXVideoSource(node,material),title,body:node.data.body,videoImport:nextTask};
    if(comparable(data)===comparable(node.data))return {valid:true};
    const next=changed();validateBoard(next);return {board:next,valid:true};
  }catch(error){
    const reason=`导入结果暂未保存：${errorMessage(error)}`;
    data={...node.data,videoImport:{...old,status:'failed',message:'请检查素材后重试',error:reason,updatedAt:new Date().toISOString()}};
    if(comparable(data)===comparable(node.data))return {valid:false};
    return {board:changed(),valid:false,error:reason};
  }
}

const carriedKeys = ['sourceUrl', 'sourceTitle', 'sourceAuthor', 'sourceDescription', 'sourceStatus', 'sourceOriginalText', 'nativeAssetId', 'nativeProjectId', 'nativeDirectory', 'nativeSourceId', 'nativeImportJobId', 'collectedAt'] as const;
const videoOnlyKeys = ['url', 'poster', 'mediaId', 'duration', 'transcript', 'transcriptRevision', 'nativeAssetId', 'nativeHasAudio', 'nativeTranscriptId', 'nativeSegmentIds', 'nativeWordIds', 'nativeRanges', 'nativeCapture'] as const;

function carriedFields(data: Partial<CardData>): Partial<CardData> {
  const result: Partial<CardData> = {};
  for (const key of carriedKeys) if (data[key] !== undefined) result[key] = data[key] as never;
  return result;
}

export function collectNotePictures(existing: string[] | undefined, extras: string[]): string[] {
  const pictures: string[] = [];
  for (const url of [...(existing || []), ...extras]) {
    if (!url || pictures.includes(url)) continue;
    pictures.push(url);
  }
  return pictures;
}

function samePictures(left: string[] | undefined, right: string[]): boolean {
  const current = left || [];
  return current.length === right.length && current.every((url, index) => url === right[index]);
}

/** Pull image cards that share a note's source onto that note, in left-to-right order. */
export function foldNotePictures(board: Board): Board | undefined {
  const drop = new Set<string>();
  const picturesByNote = new Map<string, string[]>();
  for (const note of board.nodes) {
    if (note.data.kind !== 'note' || !note.data.sourceUrl) continue;
    const images = board.nodes
      .filter(item => item.data.kind === 'image' && item.data.sourceUrl === note.data.sourceUrl && item.data.url && !drop.has(item.id))
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
    if (!images.length) continue;
    for (const image of images) drop.add(image.id);
    picturesByNote.set(note.id, collectNotePictures(note.data.pictures, images.map(item => item.data.url || '')));
  }
  if (!drop.size) return undefined;
  const next: Board = {
    ...board,
    nodes: board.nodes.filter(item => !drop.has(item.id)).map(item => {
      const pictures = picturesByNote.get(item.id);
      return pictures ? { ...item, data: { ...item.data, pictures } } : item;
    }),
    edges: board.edges.filter(edge => !drop.has(edge.source) && !drop.has(edge.target)),
    updatedAt: new Date().toISOString(),
  };
  return validateBoard(next);
}

/** Turn the waiting video card into the note, and keep that note's pictures on it. */
export function placeImageNote(board: Board, nodeId: string, note: Partial<CardData>, companions: { id: string; data: Partial<CardData> }[] = []): { board?: Board; valid: boolean; error?: string } {
  const node = board.nodes.find(item => item.id === nodeId);
  if (!node) return { valid: false, error: '原来的卡片已经不在这张画布上。' };
  const converting = node.data.kind !== 'note' && !!node.data.videoImport;
  if (!converting && node.data.kind !== 'note') return { valid: false, error: '图文笔记没有放到原来的卡片上。' };
  const sourceUrl = (typeof note.sourceUrl === 'string' && note.sourceUrl) || node.data.sourceUrl || '';
  const siblings = board.nodes
    .filter(item => item.id !== node.id && item.data.kind === 'image' && !!sourceUrl && item.data.sourceUrl === sourceUrl && item.data.url)
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const fromNote = Array.isArray(note.pictures) ? note.pictures.filter((url): url is string => typeof url === 'string') : [];
  const incoming = companions.filter(item => item?.data?.kind === 'image' && item.data.url).map(item => item.data.url || '');
  const pictures = collectNotePictures(converting ? undefined : node.data.pictures, [...fromNote, ...incoming, ...siblings.map(item => item.data.url || '')]);
  if (!converting && !siblings.length && samePictures(node.data.pictures, pictures)) return { valid: true };
  let data = node.data;
  let style = node.style;
  if (converting) {
    const own = node.data.body.trim();
    const incomingBody = (note.body || '').trim();
    const body = own && incomingBody && !own.includes(incomingBody.slice(0, 24)) ? `${own}\n\n${incomingBody}` : (own || incomingBody);
    const waiting = node.data.videoImport ? taskTitle(node.data.videoImport.url) : '';
    const title = note.title && (!waiting || node.data.title === waiting) ? note.title : node.data.title;
    data = { ...node.data, ...carriedFields(note), kind: 'note', title: title.slice(0, 500), body: body.slice(0, 300_000) };
    delete data.videoImport;
    for (const key of videoOnlyKeys) delete data[key];
    if (!node.style?.width || node.style.width === 320) style = { ...(node.style || {}), width: 420 };
  }
  if (pictures.length) data = { ...data, pictures };
  const drop = new Set(siblings.map(item => item.id));
  const next: Board = {
    ...board,
    nodes: board.nodes.filter(item => !drop.has(item.id)).map(item => item.id === nodeId ? { ...item, data, ...(style ? { style } : {}) } : item),
    edges: board.edges.filter(edge => !drop.has(edge.source) && !drop.has(edge.target)),
    updatedAt: new Date().toISOString(),
  };
  try { return { board: validateBoard(next), valid: true }; }
  catch (error) { return { valid: false, error: `图文笔记暂未放进画布：${errorMessage(error)}` }; }
}
