import { normalizeXLink } from '../shared/x-import';
import type { BoardNode, CardData } from './model';
import { getStoredXPostText } from './x-post-source';

const complete = (value?: string) => /(?:正文完整|已保存完整原帖正文|原帖没有文字正文)/.test(value ?? '');
const partial = (value?: string) => /仅取得(?:原帖)?正文预览|正文部分|部分正文/.test(value ?? '');

/** Source hydration never overwrites viewing notes or a complete saved capture. */
export function mergeXVideoSource(node: BoardNode, incoming: Partial<CardData>): Partial<CardData> {
  let currentId: string, incomingId: string;
  try {
    currentId = normalizeXLink(node.data.sourceUrl ?? node.data.videoImport?.url ?? '').id;
    incomingId = normalizeXLink(incoming.sourceUrl ?? '').id;
  } catch { return {}; }
  if (currentId !== incomingId) return {};
  const patch: Partial<CardData> = {};
  const cached = getStoredXPostText(node);
  const candidate = getStoredXPostText({...node, data: {...node.data, ...incoming}});
  const fillsCapture = cached === undefined || (partial(node.data.sourceStatus) && complete(incoming.sourceStatus));
  const confirmsCapture = cached !== undefined && candidate === cached && !complete(node.data.sourceStatus) && complete(incoming.sourceStatus);
  if (fillsCapture || confirmsCapture) {
    if (fillsCapture && candidate !== undefined) patch.sourceOriginalText = candidate;
    if (incoming.sourceStatus !== undefined) {
      // Article video ordinals and original CDN provenance remain part of identity.
      const article = node.data.sourceStatus?.match(/^文章视频 [1-9]\d*；视频源：[^；]+/)?.[0];
      patch.sourceStatus = article && !incoming.sourceStatus.startsWith(`${article}；`)
        ? `${article}；${incoming.sourceStatus}` : incoming.sourceStatus;
    }
  }
  if (!node.data.sourceUrl) patch.sourceUrl = incoming.sourceUrl;
  if (!node.data.sourceAuthor && incoming.sourceAuthor) patch.sourceAuthor = incoming.sourceAuthor;
  if (!node.data.sourceTitle && incoming.sourceTitle) patch.sourceTitle = incoming.sourceTitle;
  return Object.fromEntries(Object.entries(patch).filter(([key, value]) => value !== node.data[key as keyof CardData]));
}
