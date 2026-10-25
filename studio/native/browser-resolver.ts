import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { MediaOptions } from '../../electron/media';
import type { VideoInput, PublicVideo } from './download';
import { playbackMatchesTarget, selectSplitPlayback } from './browser-evidence';
import { choosePageMedia, douyinBootstrap, emptyPageMedia, pageCaptureScript, type CapturedDouyin, type CapturedXhs } from './page-media';

const domainIs = (host: string, domain: string) => host === domain || host.endsWith('.' + domain);
const abortError = () => Object.assign(new Error('任务已取消'), { name: 'AbortError' });
const domSnapshot = `(() => {
  const candidates = [...document.querySelectorAll('video')].map(video => {
    const rect = video.getBoundingClientRect();
    const player = video.closest('[data-e2e="player-container"]');
    const detail = video.closest('[data-e2e="video-detail"]');
    const playerIds = player ? [...player.classList].filter(token => /^video_\\d+$/.test(token)).map(token => token.slice(6)) : [];
    const detailIds = detail ? [...detail.querySelectorAll('[data-e2e="detail-video-info"][data-e2e-aweme-id]')].map(node => node.getAttribute('data-e2e-aweme-id')) : [];
    return { url: video.currentSrc, width: video.videoWidth, height: video.videoHeight,
      playerIds, detailIds,
      duration: video.duration, readyState: video.readyState,
      visible: rect.width > 40 && rect.height > 40 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight,
      area: Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0)) };
  }).sort((a, b) => b.area - a.area);
  const mediaUrls = performance.getEntriesByType('resource').map(entry => entry.name)
    .filter(name => /douyinvod\\.com|xhscdn\\.com|xiaohongshu\\.com/.test(name) && /media-video|media-audio/.test(name)).slice(0, 12);
  ${pageCaptureScript}
  return { title: document.title, url: location.href, text: (document.body?.innerText || '').slice(0, 24000), candidates, mediaUrls, douyin, xhs };
})()`;

/** Isolated page. The picture and sound addresses are the ones the page itself loaded. Account cookies are not used. */
export async function resolvePublicPageVideo(input: VideoInput, options: MediaOptions = {}): Promise<PublicVideo> {
  if (!['抖音', '小红书'].includes(input.platform)) throw new Error('该平台暂未提供公开网页获取方式。');
  if (options.signal?.aborted) throw abortError();
  const partition = `field-public-video-${randomUUID()}`;
  const isolated = session.fromPartition(partition, { cache: false });
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({ show: false, width: 1280, height: 900,
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
  });
  window.webContents.setAudioMuted(true);
  // Websites receive this Chromium runtime's ordinary UA, without an app-specific product marker.
  window.webContents.setUserAgent(window.webContents.getUserAgent().replace(/\sElectron\/[^\s]+/g, '').replace(/\sfield-creator-canvas\/[^\s]+/g, ''));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const allowedPage = (value: string) => {
    try {
      const url = new URL(value);
      const domains = input.platform === '抖音' ? ['douyin.com', 'iesdouyin.com'] : ['xiaohongshu.com', 'xhslink.com'];
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && domains.some(domain => domainIs(url.hostname, domain));
    } catch { return false; }
  };
  const navigationGuard = (event: { preventDefault(): void }, url: string) => { if (!allowedPage(url)) event.preventDefault(); };
  window.webContents.on('will-navigate', navigationGuard);
  window.webContents.on('will-redirect', navigationGuard);
  const closeWindow = () => {
    try { if (!window.isDestroyed() && window.webContents.debugger.isAttached()) window.webContents.debugger.detach(); } catch { /* The page is already gone. */ }
    if (!window.isDestroyed()) window.destroy();
  };
  let rejectStopped!: (error: Error) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  void stopped.catch(() => undefined);
  const cancel = () => { rejectStopped(abortError()); closeWindow(); };
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const deadline = Date.now() + 45_000;
  const timeoutError = () => new Error(`${input.platform}公开网页未在 45 秒内提供可播放视频，可能需要登录或该链接已失效。请在原平台确认后重试。`);
  const timeout = setTimeout(() => { rejectStopped(timeoutError()); closeWindow(); }, 45_000); timeout.unref();
  let expectedContentId = input.url.match(/\/(?:video|explore|discovery\/item)\/([\w-]+)/)?.[1];
  let sawEmptyPage = false;
  try {
    try {
      const debug = window.webContents.debugger;
      debug.attach('1.3');
      await debug.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: douyinBootstrap });
    } catch { /* Xiaohongshu is still read from the page after it loads. */ }
    await Promise.race([window.loadURL(input.url).catch(error => { if (!/ERR_ABORTED/.test(String(error))) throw error; }), stopped]);
    while (Date.now() < deadline) {
      if (options.signal?.aborted) throw abortError();
      if (window.isDestroyed()) break;
      let snapshot: { title: string; url: string; text: string; mediaUrls?: string[]; douyin?: CapturedDouyin | null; xhs?: CapturedXhs | null; candidates: { url: string; width: number; height: number; duration: number; readyState: number; visible: boolean; playerIds: string[]; detailIds: string[] }[] };
      try { snapshot = await Promise.race([window.webContents.executeJavaScript(domSnapshot), stopped]); }
      catch { await new Promise(resolve => setTimeout(resolve, 400)); continue; }
      const finalPage = new URL(snapshot.url);
      const resolvedContentId = finalPage.pathname.match(/\/(?:video|explore|discovery\/item)\/([\w-]+)/)?.[1] || finalPage.searchParams.get('modal_id') || undefined;
      // Short links acquire their identity only after normal navigation. Never accept a recommendation for a different page ID.
      if (!expectedContentId && resolvedContentId) expectedContentId = resolvedContentId;
      if (expectedContentId && resolvedContentId && expectedContentId !== resolvedContentId) throw new Error('分享链接跳转到了另一个视频，请重新复制原视频链接。');
      if (/当前笔记暂时无法浏览|视频已删除|该视频已被删除|作品不存在/.test(snapshot.text)) throw new Error(`${input.platform}公开页暂时无法播放这个内容，请重新复制当前可打开的分享链接。`);
      const chosen = choosePageMedia(input.platform, resolvedContentId, snapshot.douyin, snapshot.xhs);
      if (chosen?.kind === 'video' && chosen.mediaUrl) return { mediaUrl: chosen.mediaUrl, ...(chosen.author ? { author: chosen.author } : {}), ...(chosen.description ? { description: chosen.description } : {}), title: chosen.title, contentId: chosen.contentId, referer: snapshot.url, ...(chosen.durationSeconds ? { durationSeconds: chosen.durationSeconds } : {}) };
      if (chosen?.kind === 'images' && chosen.images?.length) return { mediaUrl: '', images: chosen.images, ...(chosen.author ? { author: chosen.author } : {}), ...(chosen.description ? { description: chosen.description } : {}), title: chosen.title, contentId: chosen.contentId, referer: snapshot.url };
      if (emptyPageMedia(input.platform, resolvedContentId, snapshot.douyin, snapshot.xhs)) sawEmptyPage = true;
      for (const candidate of snapshot.candidates) {
        if (!candidate.visible || candidate.readyState < 1 || candidate.width < 100 || candidate.height < 100 || !Number.isFinite(candidate.duration) || candidate.duration <= 0) continue;
        let media: URL; try { media = new URL(candidate.url); } catch { continue; }
        const mediaDomains = input.platform === '抖音' ? ['douyinvod.com', 'douyin.com', 'douyinpic.com'] : ['xhscdn.com', 'xiaohongshu.com'];
        // The player matches this page, but Douyin now feeds it through a blob address.
        // The picture and sound are still the public files the page already requested.
        if (media.protocol === 'blob:' && resolvedContentId && candidate.playerIds.includes(resolvedContentId) && candidate.detailIds.includes(resolvedContentId)) {
          const split = selectSplitPlayback(input.platform, snapshot.mediaUrls || []);
          if (!split) continue;
          return { mediaUrl: split.videoUrl, ...(split.audioUrl ? { audioUrl: split.audioUrl } : {}), title: snapshot.title.replace(/\s*[-–|]\s*(抖音|小红书).*$/, '').trim(), contentId: resolvedContentId, referer: snapshot.url, durationSeconds: candidate.duration };
        }
        if (!['https:', 'http:'].includes(media.protocol) || !mediaDomains.some(domain => domainIs(media.hostname, domain))) continue;
        if (!resolvedContentId) continue;
        if (!playbackMatchesTarget(input.platform, resolvedContentId, media.href, candidate.playerIds, candidate.detailIds)) continue;
        return { mediaUrl: media.href, title: snapshot.title.replace(/\s*[-–|]\s*(抖音|小红书).*$/, '').trim(), contentId: resolvedContentId, referer: snapshot.url, durationSeconds: candidate.duration };
      }
      // A login promotion does not invalidate a playable anonymous video. Only stop at an actual barrier.
      if (/IP存在风险|安全限制|请完成安全验证|请完成下方验证|拖动滑块完成|访问过于频繁/.test(snapshot.text)) throw new Error(`${input.platform}当前网页要求安全验证或限制了网络访问，请在原平台处理后重试。`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw sawEmptyPage ? new Error(`${input.platform}这篇公开内容没有可下载的视频或图片。`) : timeoutError();
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    throw error;
  } finally {
    clearTimeout(timeout); options.signal?.removeEventListener('abort', cancel); closeWindow();
    await isolated.clearStorageData().catch(() => undefined);
    await isolated.clearCache().catch(() => undefined);
  }
}
