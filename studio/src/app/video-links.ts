import type { VideoImportStatus } from '../model';
import type { VideoImportStage } from '../video-import';
import { safeUrl } from '../board-utils';

export const VIDEO_BATCH_LIMIT = 20;
export const pendingImport = (status?: VideoImportStatus) => status === 'queued' || status === 'downloading' || status === 'transcribing';
export const importStatusLabel: Record<VideoImportStatus,string> = { queued:'等待处理',downloading:'下载视频',transcribing:'提取逐字稿',completed:'已完成',failed:'需要处理',cancelled:'已取消',interrupted:'已中断' };
export function importStageStatus(stage: VideoImportStage): VideoImportStatus { return stage === 'processing' ? 'downloading' : stage === 'media-ready' ? 'transcribing' : stage; }
export function sharedLinks(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"`，。！？、；：…（）【】「」『』《》]+/gi) ?? [];
  return [...new Set(matches.map(value => safeUrl(value.replace(/[),.;!\]}]+$/g,''))).filter((value):value is string => !!value))];
}
export function isXUrl(value:string):boolean { try{return ['x.com','www.x.com','mobile.x.com','twitter.com','www.twitter.com','mobile.twitter.com'].includes(new URL(value).hostname.toLowerCase());}catch{return false;} }
export function videoPlatform(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  const belongs = (domain:string) => host === domain || host.endsWith(`.${domain}`);
  if (belongs('douyin.com') || belongs('iesdouyin.com')) return '抖音';
  if (belongs('xiaohongshu.com') || belongs('xhslink.com')) return '小红书';
  if (belongs('bilibili.com') || belongs('b23.tv')) return '哔哩哔哩';
  if (belongs('youtube.com') || belongs('youtu.be')) return 'YouTube';
  return host.replace(/^www\./,'');
}
export function recognizableVideo(url: string): boolean {
  const parsed = new URL(url); const host = parsed.hostname.toLowerCase();
  const sites = ['douyin.com','iesdouyin.com','xiaohongshu.com','xhslink.com','bilibili.com','b23.tv','youtube.com','youtu.be'];
  return sites.some(domain => host === domain || host.endsWith(`.${domain}`)) || /\.(mp4|webm|mov|m4v|mkv|m3u8)$/i.test(parsed.pathname);
}
export function taskTitle(url:string) { return `正在导入 · ${videoPlatform(url)}`; }
