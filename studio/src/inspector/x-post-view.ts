import { useMemo } from 'react';
import type { BoardNode } from '../model';
import { useBoard } from '../board-context';
import { normalizeXLink } from '../../shared/x-import';
import { findXPostSource, getStoredXPostText } from '../x-post-source';

/**
 * Derives what the Inspector shows about an X post: provenance, the post prose for
 * an X video (preferring a complete immutable snapshot), and whether a link card's
 * prose was edited after import. Pure view derivation; it never writes data.
 */
export function useXPostView(node: BoardNode, savedSourceUrl: string, xPostExpanded: boolean) {
  const board = useBoard();
  const { data } = node;
  const isVideo = data.kind === 'video';
  const xSourceAuthor = typeof data.sourceAuthor === 'string' ? data.sourceAuthor.trim() : '';
  const xSourceStatus = typeof data.sourceStatus === 'string' ? data.sourceStatus.trim() : '';
  const xPostIdentity = useMemo(() => { try { return normalizeXLink(savedSourceUrl || '').id; } catch { return undefined; } }, [savedSourceUrl]);
  const showXProvenance = !!xPostIdentity && (data.kind === 'link' || data.kind === 'image' || isVideo) && !!(xSourceAuthor || xSourceStatus);
  const xPostSource = useMemo(() => isVideo && xPostIdentity ? findXPostSource(board.nodes, node) : undefined, [isVideo, xPostIdentity, board.nodes, node]);
  const xLinkedText = xPostSource ? getStoredXPostText(xPostSource) : undefined;
  const xVideoText = isVideo && xPostIdentity ? getStoredXPostText(node) : undefined;
  const xLinkedStatus = typeof xPostSource?.data.sourceStatus === 'string' ? xPostSource.data.sourceStatus : '';
  const xLinkedComplete = /已保存完整原帖正文|(?:^|[；;])正文完整(?:[；;]|$)|原帖没有文字正文/.test(xLinkedStatus);
  const xVideoComplete = /已保存完整原帖正文|(?:^|[；;])正文完整(?:[；;]|$)|原帖没有文字正文/.test(xSourceStatus);
  const preferVideoText = xVideoText !== undefined && xVideoComplete && !xLinkedComplete;
  const xPostText = preferVideoText ? xVideoText : xLinkedText ?? xVideoText;
  const xPostStatus = preferVideoText || xLinkedText === undefined ? xSourceStatus : xLinkedStatus;
  const xPostPartial = /仅取得(?:原帖)?正文预览/.test(xPostStatus);
  const xPostHasSnapshot = preferVideoText || xLinkedText === undefined
    ? typeof data.sourceOriginalText === 'string'
    : typeof xPostSource?.data.sourceOriginalText === 'string';
  const xPostCharacters = useMemo(() => xPostText === undefined ? [] : Array.from(xPostText), [xPostText]);
  const xPostLong = xPostCharacters.length > 800;
  const xPostPreview = xPostLong && !xPostExpanded ? `${xPostCharacters.slice(0, 600).join('')}…` : xPostText;
  const xPostLoading = isVideo && !!xPostIdentity && !!board.xPostLoading?.(node.id);
  const xPostError = isVideo && xPostIdentity ? board.xPostError?.(node.id) : undefined;
  const xSnapshotEdited = !!xPostIdentity
    && data.kind === 'link'
    && typeof data.sourceOriginalText === 'string'
    && getStoredXPostText(node) !== undefined
    && data.sourceOriginalText.replace(/\r\n?/g, '\n') !== data.body.replace(/\r\n?/g, '\n');
  return {
    xSourceAuthor, xSourceStatus, xPostIdentity, showXProvenance, xPostSource, preferVideoText,
    xPostText, xPostStatus, xPostPartial, xPostHasSnapshot, xPostLong, xPostPreview, xPostLoading, xPostError, xSnapshotEdited,
  };
}

export type XPostView = ReturnType<typeof useXPostView>;
