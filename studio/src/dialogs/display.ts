import type { BoardNode, CardData, CardKind } from '../model';
import { paragraphIndexAt, quoteDisplayTitle, timeRangeLabel } from '../source-location';

/** 界面显示名（DESIGN_SYSTEM §8.1）；`cardLabels` 的数据值不改（K1）。 */
export const KIND_DISPLAY: Record<CardKind, string> = { video: '视频', image: '图片', note: '笔记', quote: '摘录', draft: '文稿', link: '链接', frame: '分组' };

/** 文字资料 = 导入的文章：`note` + 标签“文字资料”（与 readTextSource 写入的字段一致）。 */
export const isTextSource = (node?: Pick<BoardNode, 'data'>) => node?.data.kind === 'note' && !!node.data.tags?.includes('文字资料');
export const kindDisplay = (kind: CardKind, node?: Pick<BoardNode, 'data'>) => isTextSource(node) ? '文字资料' : KIND_DISPLAY[kind];

// 摘录存储标题的默认格式（K11/C13）：时间点、时间段、第 N 段，或“摘录 · 来源标题”。
const DEFAULT_TITLE = /^摘录(?: · (?:\d{1,2}:\d{2}(?::\d{2})?(?:[–-]\d{1,2}:\d{2}(?::\d{2})?)?|第 \d+ 段))?$/;

/** 摘录的显示标题：仍是默认格式时用原句开头，用户改过的标题原样返回（C13）。 */
export function quoteTitle(data: Pick<CardData, 'title' | 'body' | 'citation'>): string {
  const title = data.title?.trim() ?? '';
  const isDefault = DEFAULT_TITLE.test(title) || (!!data.citation?.title && title === `摘录 · ${data.citation.title}`);
  return isDefault ? quoteDisplayTitle({ ...data, title: '' }) : quoteDisplayTitle(data);
}

export const cardTitle = (node: Pick<BoardNode, 'data'>) => node.data.kind === 'quote' ? quoteTitle(node.data) : node.data.title?.trim() || kindDisplay(node.data.kind, node);

/** 摘录签上的位置：视频写时间段，文字写“第 N 段”（需要来源正文）。 */
export function quoteLocation(data: Pick<CardData, 'citation'>, sourceBody?: string): string | undefined {
  const citation = data.citation;
  if (!citation) return undefined;
  const time = timeRangeLabel(citation.start, citation.end);
  if (time) return time;
  if (citation.textAnchor && sourceBody) { const paragraph = paragraphIndexAt(sourceBody, citation.textAnchor.from); if (paragraph) return `第 ${paragraph} 段`; }
  return undefined;
}

/** 记录存在哪里，欢迎页页脚与使用指南用同一个判断（FD-05）：桌面版带本机目录存储接口。 */
export const isDesktopWorkspace = () => typeof window !== 'undefined' && !!window.fieldBoardStorage;
