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
