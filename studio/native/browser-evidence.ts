const mediaDomains = (platform: string) => platform === '抖音' ? ['douyinvod.com'] : platform === '小红书' ? ['xhscdn.com', 'xiaohongshu.com'] : [];
const hostMatches = (host: string, domain: string) => host === domain || host.endsWith('.' + domain);

/**
 * Douyin's web player often plays through a blob: address while the picture and sound
 * are two public CDN files it already requested. Use those files only when they are one pair.
 */
export function selectSplitPlayback(platform: string, urls: readonly string[]): { videoUrl: string; audioUrl?: string } | undefined {
  const domains = mediaDomains(platform);
  if (!domains.length) return undefined;
  const items: { href: string; kind: 'video' | 'audio'; bitrate: number; group: string }[] = [];
  for (const value of urls) {
    let url: URL;
    try { url = new URL(value); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) continue;
    if (!domains.some(domain => hostMatches(url.hostname, domain))) continue;
    const kind = /media-video/i.test(url.pathname) ? 'video' : /media-audio/i.test(url.pathname) ? 'audio' : '';
    if (!kind) continue;
    const bitrate = Number(url.searchParams.get('br'));
    items.push({ href: url.href, kind, bitrate: Number.isFinite(bitrate) ? bitrate : 0, group: url.searchParams.get('l') || url.pathname });
  }
  const groups = [...new Set(items.filter(item => item.kind === 'video').map(item => item.group))];
  if (groups.length !== 1) return undefined;
  const chosen = items.filter(item => item.group === groups[0]);
  const video = chosen.filter(item => item.kind === 'video').sort((a, b) => b.bitrate - a.bitrate)[0];
  const audio = chosen.filter(item => item.kind === 'audio').sort((a, b) => b.bitrate - a.bitrate)[0];
  if (!video) return undefined;
  return { videoUrl: video.href, ...(audio ? { audioUrl: audio.href } : {}) };
}

/** Public DOM evidence needed before associating a playable source with a requested video. */
export function playbackMatchesTarget(platform: string, contentId: string, mediaUrl: string, playerIds: string[], detailIds: string[]): boolean {
  let media: URL; try { media = new URL(mediaUrl); } catch { return false; }
  if (!['http:', 'https:'].includes(media.protocol)) return false;
  const declaredId = media.searchParams.get('__vid') || media.searchParams.get('note_id');
  if (declaredId && declaredId !== contentId) return false;
  if (playerIds.length && !playerIds.includes(contentId)) return false;
  if (declaredId === contentId) return true;
  // Douyin's public player DOM binds the current player to its public detail section.
  if (platform === '抖音') return playerIds.includes(contentId) && detailIds.includes(contentId);
  // For a site without a verified DOM contract, do not assign an unrelated visible player to the page.
  return false;
}
