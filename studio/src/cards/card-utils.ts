import { FileText, Film, Image, Link2, Maximize2, Quote, StickyNote } from 'lucide-react';
import { timecode, type CardData, type CardKind, type Citation, type TranscriptLine, type VideoImportState, type VideoImportStatus } from '../model';
import { plainMarkdown, quoteDisplayTitle } from '../source-location';
import type { ExcerptMark, StationeryKind } from './types';

export const kindIcons = {
  video: Film,
  image: Image,
  note: StickyNote,
  quote: Quote,
  draft: FileText,
  link: Link2,
  frame: Maximize2,
} satisfies Record<CardKind, unknown>;

export const importLabels: Record<VideoImportStatus, string> = {
  queued: '等待处理',
  downloading: '下载视频',
  transcribing: '提取逐字稿',
  completed: '已完成',
  failed: '导入未完成',
  cancelled: '已取消',
  interrupted: '任务已中断',
};

/** The one status line on the card's meta row while a link import runs (§6.8 “下载中 34%”). */
export const importStateLabels: Record<VideoImportStatus, string> = {
  queued: '等待处理',
  downloading: '下载中',
  transcribing: '转写中',
  completed: '已导入',
  failed: '导入未完成',
  cancelled: '已取消',
  interrupted: '已中断',
};

const pendingImportStatuses: readonly VideoImportStatus[] = ['queued', 'downloading', 'transcribing'];

/** A queued, downloading or transcribing import still owns the card's media slot. */
export function isImportPending(task?: VideoImportState) {
  return !!task && pendingImportStatuses.includes(task.status);
}

/** A failed or interrupted import: the card title says so and the media area offers one retry. */
export function isImportStopped(task?: VideoImportState) {
  return !!task && (task.status === 'failed' || task.status === 'interrupted');
}

/** Only http(s) URLs become clickable links. */
export function webLink(url?: string) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Strips Markdown image and link syntax so the canvas preview reads as plain prose. */
export function draftPreviewText(body: string) {
  return body
    .replace(/!\[([^\]\n]*)\]\((?:\([^()\n]*\)|[^()\n])*\)/g, (_match, label: string) => label || '图片')
    .replace(
      /\[([^\]\n]*)\]\(\s*<?(?:field:\/\/node\/|https?:\/\/)(?:\([^()\n]*\)|[^()\n])*\)/g,
      (_match, label: string) => label,
    );
}

/** `mm:ss – mm:ss` for timed citations, otherwise a generic source action. */
export function citationTimeLabel(citation: Citation) {
  if (citation.start === undefined) return '查看来源';
  return `${timecode(citation.start)}${citation.end !== undefined ? ` – ${timecode(citation.end)}` : ''}`;
}

/** Imported text (Markdown / TXT) is stored as a note tagged “文字资料”; it renders as a text source (§6.10). */
export function isTextSource(data: Pick<CardData, 'kind' | 'tags'>) {
  return data.kind === 'note' && !!data.tags?.includes('文字资料');
}

/** Display material only; the stored CardKind and field identifiers remain unchanged. */
export function stationeryKind(data: Pick<CardData, 'kind' | 'tags'>): StationeryKind {
  if (isTextSource(data)) return 'folder';
  return ({ video: 'print', link: 'folder', quote: 'index', draft: 'manuscript', note: 'note', image: 'photo', frame: 'lighttable' } as const)[data.kind];
}

/** A default or empty note name stays off the face; a user supplied title stays visible. */
export function hasNoteTitle(data: Pick<CardData, 'kind' | 'tags' | 'title'>): boolean {
  return data.kind === 'note' && !isTextSource(data) && !!data.title.trim() && data.title.trim() !== '笔记';
}

/** Interface name of a card kind (§8.1). `cardLabels` stays the stored value (K1). */
export function kindDisplayName(data: Pick<CardData, 'kind' | 'tags'>): string {
  if (isTextSource(data)) return '文字资料';
  return ({ video: '视频', image: '图片', note: '笔记', quote: '摘录', draft: '文稿', link: '链接', frame: '分组' } as const)[data.kind];
}

const PLATFORMS: Array<[RegExp, string]> = [
  [/(?:^|\.)(?:douyin|iesdouyin)\.com$/, '抖音'],
  [/(?:^|\.)(?:bilibili\.com|b23\.tv)$/, '哔哩哔哩'],
  [/(?:^|\.)(?:youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(?:^|\.)(?:xiaohongshu\.com|xhslink\.com)$/, '小红书'],
  [/(?:^|\.)(?:kuaishou\.com|gifshow\.com)$/, '快手'],
  [/(?:^|\.)weibo\.(?:com|cn)$/, '微博'],
  [/(?:^|\.)(?:x\.com|twitter\.com)$/, 'X'],
  [/(?:^|\.)mp\.weixin\.qq\.com$/, '公众号'],
  [/(?:^|\.)vimeo\.com$/, 'Vimeo'],
  [/(?:^|\.)zhihu\.com$/, '知乎'],
];

/** Host name without `www.`, or undefined when the value is not an http(s) URL. */
export function hostName(url?: string) {
  return webLink(url)?.hostname.replace(/^www\./, '');
}

/**
 * The material's own platform, written as plain meta text (never a tag shape, §6.7):
 * “抖音”, “公众号”, “本机视频”, “Markdown 文件”…（这台电脑上的文件一律写“本机”，§8.1）
 */
export function platformLabel(data: CardData, sampleAsset = false): string {
  const host = hostName(data.sourceUrl) ?? hostName(data.videoImport?.url) ?? hostName(data.url);
  if (host) return PLATFORMS.find(([pattern]) => pattern.test(host))?.[1] ?? host;
  if (sampleAsset) return data.kind === 'video' ? '示例短片' : '示例图片';
  if (isTextSource(data)) return data.tags?.includes('Markdown') ? 'Markdown 文件' : data.tags?.includes('纯文本') ? '纯文本' : '文字资料';
  if (data.kind === 'video') return data.mediaId || data.nativeAssetId || data.url ? '本机视频' : '视频';
  if (data.kind === 'image') return data.mediaId || data.nativeAssetId ? '本机图片' : '图片';
  return '';
}

/** Thousands separators (§8.2: 1,860). */
export function formatCount(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

/** “约 6,200 字” for long material (rounded), the exact number for short text. */
export function approxCharacters(count: number, step = 100) {
  if (count < 1000) return `${formatCount(count)} 字`;
  return `约 ${formatCount(Math.round(count / step) * step)} 字`;
}

const STAGE_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
/** Draft stage from saved versions: no version → 第一稿, one saved version → 第二稿 … (§6.13). */
export function draftStage(versionCount: number) {
  const stage = Math.max(0, versionCount) + 1;
  return stage <= STAGE_NUMERALS.length ? `第${STAGE_NUMERALS[stage - 1]}稿` : `第 ${stage} 稿`;
}

/**
 * Plain text of an imported article without its headings and byline, for the two-line summary (§6.10).
 * Read line by line: a line that repeats the card title (a TXT file starts with its title and often no blank
 * line after it), a heading and a byline are left out, and the full-width indent that opens a paragraph goes
 * too.
 */
export function articleSummary(data: Pick<CardData, 'title' | 'body'>, limit = 160) {
  const title = data.title.trim();
  const parts = data.body.slice(0, 4000).replace(/\r\n?/g, '\n').split('\n')
    .filter(line => !/^\s*#{1,6}\s/.test(line))
    .map(line => plainMarkdown(line).replace(/\s+/g, ' ').trim())
    .filter(part => part && part !== title && !/^文\s*\/\s*\S+$/.test(part) && !/^(?:作者|来源)[：:]/.test(part));
  // Paragraphs join like any line break on one run (joinLines): nothing between two CJK characters, so a
  // full stop is not followed by a gap (“冬夜。 地铁站”), one space anywhere else.
  return joinLines(parts.join('\n')).slice(0, limit);
}

/** Readable characters of an imported article (no Markdown marks, no whitespace). */
export function articleCharacters(body: string) {
  return [...plainMarkdown(body).replace(/\s/g, '')].length;
}

/** CJK characters and the punctuation set in CJK text (full-width forms, CJK symbols, curly quotes, …, —). */
const CJK_EDGE = /[⺀-鿿가-힯豈-﫿︰-﹏＀-￯—‘’“”…]/u;

/**
 * Text on one run of lines (the note's simple-tier preview, CANVAS-15): a line break between two CJK
 * characters or punctuation marks disappears, any other line break becomes one space, and blank lines go.
 * `white-space: normal` turned every break into a space, so “小时。 冷青蓝打底” showed a gap after the full
 * stop. Same rule as CORE-35's shared helper; switch to it when that lands.
 */
export function joinLines(text: string): string {
  return text.trim().replace(/[ \t　]*\n\s*/g, (match: string, offset: number, whole: string) => {
    const before = whole[offset - 1] ?? '', after = whole[offset + match.length] ?? '';
    return CJK_EDGE.test(before) && CJK_EDGE.test(after) ? '' : ' ';
  });
}

const CJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/g;
/** CJK share below 10% → the element gets lang="en" and the Latin UI face (§3.4). */
export function isLatinText(text: string) {
  const letters = text.replace(/\s/g, '');
  if (!letters) return false;
  return (letters.match(CJK)?.length ?? 0) / letters.length < .1;
}

export interface RailSegment { key: string; grow: number; marked: boolean }

const overlaps = (start: number, end: number, mark: ExcerptMark) =>
  mark.start !== undefined && start < (mark.end ?? mark.start + .001) && end > mark.start;

/**
 * Sentence rail (§6.9): one cell per transcript line, sized by its duration and blue where an excerpt
 * covers it. Long transcripts merge into at most `max` cells so the card never renders hundreds of spans.
 */
export function railSegments(lines: readonly TranscriptLine[] | undefined, marks: readonly ExcerptMark[] = [], max = 96): RailSegment[] {
  if (!lines?.length) return [];
  const per = Math.ceil(lines.length / max);
  const segments: RailSegment[] = [];
  for (let index = 0; index < lines.length; index += per) {
    const group = lines.slice(index, index + per);
    const start = group[0].start, end = group.at(-1)!.end;
    segments.push({
      key: group[0].id,
      grow: Math.max(.2, end - start),
      marked: marks.some(mark => group.some(line => overlaps(line.start, line.end, mark))),
    });
  }
  return segments;
}

/**
 * Key of the rail segment (same grouping as `railSegments`) whose sentence is playing at `time`, or undefined
 * between sentences and before the first one: the rail lights only a sentence that is really being said.
 */
export function railKeyAt(lines: readonly TranscriptLine[] | undefined, time: number, max = 96): string | undefined {
  if (!lines?.length || !Number.isFinite(time)) return undefined;
  const index = lines.findIndex(line => time >= line.start && time < Math.max(line.end, line.start + .2));
  if (index < 0) return undefined;
  const per = Math.ceil(lines.length / max);
  return lines[Math.floor(index / per) * per].id;
}

/** Excerpted spans of a text source as left/width shares of the body length (§6.10 篇幅轨). */
export function lengthMarks(bodyLength: number, marks: readonly ExcerptMark[] = []) {
  if (bodyLength <= 0) return [];
  return marks.flatMap(mark => {
    if (mark.from === undefined || mark.to === undefined || mark.to <= mark.from) return [];
    const left = Math.max(0, Math.min(1, mark.from / bodyLength));
    const width = Math.max(.012, Math.min(1 - left, (mark.to - mark.from) / bodyLength));
    return [{ left, width, key: `${mark.from}-${mark.to}` }];
  });
}

const STORED_TIME_TITLE = /^摘录 · \d{1,2}:\d{2}(?::\d{2})?(?:\s*[–-]\s*\d{1,2}:\d{2}(?::\d{2})?)?$/;

/**
 * C13 display title of an excerpt. `quoteDisplayTitle` recognises `摘录 · mm:ss` and `摘录 · 第 N 段`; the
 * stores also write `摘录 · mm:ss–mm:ss` (createQuoteBatch runs) and `摘录 · <来源标题>` (text excerpts,
 * cut at 120 characters), which are defaults too and must show the sentence opening. A title the user
 * wrote is returned unchanged.
 */
export function excerptDisplayTitle(data: Pick<CardData, 'title' | 'body' | 'citation'>): string {
  const title = data.title?.trim() ?? '';
  const sourceTitle = data.citation?.title?.trim();
  const named = title.startsWith('摘录 · ') ? title.slice(5) : undefined;
  const stored = STORED_TIME_TITLE.test(title) || (!!named && !!sourceTitle && sourceTitle.startsWith(named));
  return quoteDisplayTitle(stored ? { ...data, title: '摘录' } : data);
}
