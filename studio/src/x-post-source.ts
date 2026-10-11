import { normalizeXLink } from '../shared/x-import';
import { getSourceUrl } from './media-source';
import type { BoardNode } from './model';

function postId(node: BoardNode): string | undefined {
  try { return normalizeXLink(getSourceUrl(node.data)).id; } catch { return undefined; }
}

function normalized(value: string): string { return value.replace(/\r\n?/g, '\n').trim(); }
function status(node: BoardNode): string { return typeof node.data.sourceStatus === 'string' ? node.data.sourceStatus : ''; }
function isComplete(node: BoardNode): boolean {
  return /(?:^|[；;])\s*(?:正文完整|已保存完整原帖正文|原帖没有文字正文)(?:[；;，。,]|$)/.test(status(node));
}
function collectedRecord(node: BoardNode): boolean {
  return /由第三方 (?:FxTwitter|X Syndication) 取得|由公开内容服务获取|已通过公开内容服务核对/.test(status(node));
}

function isShareInput(text: string, node: BoardNode): boolean {
  const value = normalized(text);
  const originalInput = node.data.videoImport?.originalText;
  if (originalInput?.trim() && value === normalized(originalInput)) return true;
  // A URL itself is provenance, never the post's prose, even after removing tracking.
  if (/^https?:\/\/\S+$/i.test(value)) {
    try { if (normalizeXLink(value).id === postId(node)) return true; } catch { /* Not a status URL. */ }
  }
  return false;
}

/**
 * Return the collected, unchanged post snapshot. Older video import share text
 * is intentionally excluded. This also accepts collected link source cards.
 * An empty string is meaningful only when the content service confirmed it.
 */
export function getStoredXPostText(video: BoardNode): string | undefined {
  if (!postId(video)) return undefined;
  const snapshot = video.data.sourceOriginalText;
  if (typeof snapshot === 'string') {
    if (!snapshot.trim()) return isComplete(video) && collectedRecord(video) ? snapshot : undefined;
    if (isShareInput(snapshot, video)) return undefined;
    if (/原帖正文尚未取得/.test(status(video))) return undefined;
    return snapshot;
  }
  // Legacy collected links may predate immutable snapshots. An ordinary URL
  // card, or user-written body without a collection record, is not a post source.
  if (video.data.kind === 'link' && collectedRecord(video) && (isComplete(video) || /仅取得(?:原帖)?正文预览/.test(status(video)))) {
    return isShareInput(video.data.body, video) ? undefined : video.data.body;
  }
  return undefined;
}

/** Match post identity, not editable tags, titles, handles or media suffixes. */
export function findXPostSource(nodes: readonly BoardNode[], video: BoardNode): BoardNode | undefined {
  const id = postId(video);
  if (!id) return undefined;
  const sources = nodes.filter(node => node.id !== video.id && node.data.kind === 'link' && postId(node) === id && getStoredXPostText(node) !== undefined);
  // The latest complete capture wins over any newer preview. Neither card is edited.
  return [...sources].reverse().find(isComplete) ?? sources.at(-1);
}
