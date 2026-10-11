import { timecode, type CardData, type Citation } from './model';
import { parseDraftReferences } from './draft-references';

/** One counted paragraph (or an uncounted heading) ending before `to`; offsets up to `to` belong to it. */
interface TextBlock { to: number; heading: boolean }
export interface LineRange { from: number; to: number }

const CHUNK_SEPARATOR = /\n[ \t]*\n(?:[ \t]*\n)*/g;
const FENCE_LINE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const QUOTE_LINE = /^[ \t]{0,3}>[ \t]?/;
const LIST_LINE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/;
const RULE_LINE = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LEAD_HEADING_LINE = /^[ \t]{0,3}#{1,6}\s+(?=\S)/;
/** Average line length (UTF-16 units) from which a paragraph chunk of several lines reads one paragraph per line. */
export const PROSE_LINE_AVERAGE = 24;

/** The LF-separated lines of [from, to). */
export function sourceLines(text: string, from: number, to: number): LineRange[] {
  const result: LineRange[] = [];
  let cursor = from;
  while (cursor <= to) {
    const newline = text.indexOf('\n', cursor);
    const end = newline === -1 || newline >= to ? to : newline;
    result.push({ from: cursor, to: end });
    if (end >= to) break;
    cursor = end + 1;
  }
  return result;
}

/**
 * TXT often breaks paragraphs with one newline (W-M1): a paragraph chunk whose body lines (after a leading `#` line)
 * are at least two and average 24+ characters counts, and reads, one paragraph per line; whitespace-only lines do not
 * count. Returns those lines, or null when the chunk is one paragraph. reading-markdown.ts uses the same rule.
 */
export function proseLineRanges(text: string, rows: readonly LineRange[]): LineRange[] | null {
  if (rows.length < 2) return null;
  if (rows.reduce((sum, row) => sum + row.to - row.from, 0) / rows.length < PROSE_LINE_AVERAGE) return null;
  const lines = rows.filter(row => text.slice(row.from, row.to).trim());
  return lines.length > 1 ? lines : null;
}

/** Counted units of one paragraph chunk: the whole chunk, or one unit per prose line (gaps join the next line). */
function chunkBlocks(text: string, from: number, to: number, openFence: string | null): { blocks: TextBlock[]; fence: string | null } {
  let end = to;
  while (end > from && /[ \t\n]/.test(text[end - 1])) end--;
  const rows = sourceLines(text, from, end);
  const first = text.slice(rows[0].from, rows[0].to);
  // Code: a fence opens on the first line or is still open from an earlier chunk; each chunk of it counts once.
  if (openFence || FENCE_LINE.test(first)) {
    let fence = openFence;
    rows.forEach((row, index) => {
      const line = text.slice(row.from, row.to);
      const marker = FENCE_LINE.exec(line);
      if (!fence && index === 0 && marker) { fence = marker[1][0].repeat(3); return; }
      if (fence && marker && marker[1].startsWith(fence) && !line.slice(marker[0].length).trim()) fence = null;
    });
    return { blocks: [{ to, heading: false }], fence };
  }
  if ((rows.length === 1 && RULE_LINE.test(first)) || QUOTE_LINE.test(first) || (LIST_LINE.test(first) && !RULE_LINE.test(first))) return { blocks: [{ to, heading: false }], fence: null };
  const bodyFrom = LEAD_HEADING_LINE.test(first) && rows.length > 1 ? rows[0].to + 1 : from;
  const prose = proseLineRanges(text, rows.filter(row => row.from >= bodyFrom));
  if (!prose) return { blocks: [{ to, heading: false }], fence: null };
  return { blocks: prose.map((line, index) => ({ to: index === prose.length - 1 ? to : line.to, heading: false })), fence: null };
}

const TITLE_LIMIT = 30;
const TITLE_END = /[。！？!?…；;：:，,、.]$/u;

/**
 * Chunks that are not paragraphs although they are not `#` headings (CORE-13, §6.18.3): a thematic break alone
 * (`---`, `***`, `___`), and a TXT title — the document's first chunk when it is one short line (at most 30
 * characters) that does not end like a sentence and is followed by more text. reading-markdown.ts can use the same
 * predicate so the reading view numbers exactly the same paragraphs.
 */
export function uncountedChunk(text: string, from: number, to: number, first: boolean, hasMore: boolean): 'rule' | 'title' | null {
  const chunk = text.slice(from, to).trim();
  if (!chunk || chunk.includes('\n')) return null;
  if (RULE_LINE.test(chunk)) return 'rule';
  if (!first || !hasMore || !titleLike(chunk)) return null;
  return 'title';
}

/** One trimmed line that reads as a title: at most 30 characters, no sentence ending, not Markdown block syntax. */
function titleLike(line: string): boolean {
  if (!line || [...line].length > TITLE_LIMIT || TITLE_END.test(line)) return false;
  return !(FENCE_LINE.test(line) || QUOTE_LINE.test(line) || LIST_LINE.test(line) || LEAD_HEADING_LINE.test(line) || RULE_LINE.test(line));
}

/**
 * A TXT title on a line of its own (NEXT_ROUND decision for INSP-11 / CORE-13): the document's first chunk starts with
 * a short line (at most 30 characters) that does not end like a sentence and is followed by exactly one newline and
 * more text. Returns the offset right after that newline (where the counted text begins), or null. The title takes no
 * paragraph number; the reading view (reading-markdown.ts) shows it as the title and the export keeps it apart, so the
 * paragraph labels, the reading numbers and the exported citations all agree. Guard: when the next line reads as a
 * title too (short lines without sentence endings — a poem without punctuation, an address, a list of names), the
 * first line is one of them, not a title above them.
 */
export function leadTitleEnd(text: string, from: number, to: number, first: boolean): number | null {
  if (!first) return null;
  const newline = text.indexOf('\n', from);
  if (newline < 0 || newline >= to) return null;
  if (!text.slice(newline + 1, to).trim()) return null;
  if (!titleLike(text.slice(from, newline).trim())) return null;
  const following = text.indexOf('\n', newline + 1);
  const next = text.slice(newline + 1, following < 0 || following > to ? to : following).trim();
  return titleLike(next) ? null : newline + 1;
}

function textBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const separator = new RegExp(CHUNK_SEPARATOR.source, 'g');
  let start = 0;
  let fence: string | null = null;
  let first = true;
  for (;;) {
    const match = separator.exec(text);
    const end = match ? match.index : text.length;
    const chunk = text.slice(start, end);
    if (chunk.trim()) {
      const trimmed = chunk.trim();
      const isFirst = first;
      first = false;
      const hasMore = !!match && !!text.slice(match.index + match[0].length).trim();
      if (!fence && /^#{1,6}\s/.test(trimmed) && !trimmed.includes('\n')) blocks.push({ to: end, heading: true });
      else if (!fence && uncountedChunk(text, start, end, isFirst, hasMore)) blocks.push({ to: end, heading: true });
      else {
        // A title line followed by one newline is a heading of its own; the rest of the chunk counts as usual.
        const titleEnd = fence ? null : leadTitleEnd(text, start, end, isFirst);
        if (titleEnd !== null) blocks.push({ to: titleEnd, heading: true });
        const result = chunkBlocks(text, titleEnd ?? start, end, fence);
        fence = result.fence;
        blocks.push(...result.blocks);
      }
    }
    if (!match) break;
    start = match.index + match[0].length;
  }
  return blocks;
}

/**
 * “第 N 段”的唯一定义（DESIGN_SYSTEM.md §6.18.3）：LF 规范化后的源文本按一个或多个空行切块，
 * 去掉只含空白的块；以 # 开头的单行标题块、单独的分隔线、TXT 首行标题（uncountedChunk：首块只有一行；
 * leadTitleEnd：首行后面只跟一个换行）不计数；列表、引用、代码块整体各算一段；普通段落块由多行长句组成时
 * （TXT 常见的单换行分段，见 proseLineRanges）逐行计段，否则整体算一段；N 从 1 起。
 * 落在标题、段间空行或行间换行时归入下一段；文本之外返回 undefined。
 */
export function paragraphIndexAt(body: string | undefined, offset: number): number | undefined {
  if (!body || offset < 0) return undefined;
  const text = body.replace(/\r\n?/g, '\n');
  if (offset > text.length) return undefined;
  let count = 0;
  for (const block of textBlocks(text)) {
    if (block.heading) continue;
    count++;
    if (offset < block.to) return count;
  }
  return count || undefined;
}

const DRAFT_HEADING = /^[ \t]{0,3}#{1,6}[ \t]+/;
const DRAFT_FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const draftNumberCache = new Map<string, { starts: number[]; owner: Uint32Array }>();

/**
 * 文稿的段号，按写作页左侧显示的规则（draft-editor/markdown.ts 的 analyzeDraftStructure，测试逐行比对）：
 * 按空行切块（代码围栏内的空行不切）；块内第一行“不是只有引用链接的行、不是围栏行、不是单行标题”处计一段；
 * 只有引用链接的行折进上一段（写作页把它显示成上一段末尾的上标），所以不计。
 * 返回每行的起点与“这一行所在块的段号”（块不计段时为 0）。
 */
export function draftParagraphNumbers(text: string): { starts: number[]; owner: Uint32Array } {
  const cached = draftNumberCache.get(text);
  if (cached) return cached;
  const starts = [0];
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) starts.push(index + 1);
  const count = starts.length;
  const lineText = (line: number) => text.slice(starts[line], line + 1 < count ? starts[line + 1] - 1 : text.length);
  // Lines holding nothing but reference links (several on one line count together).
  const referencesByLine = new Map<number, { from: number; to: number }[]>();
  for (const reference of parseDraftReferences(text)) {
    let line = count - 1;
    while (line > 0 && starts[line] > reference.from) line--;
    referencesByLine.set(line, [...(referencesByLine.get(line) ?? []), reference]);
  }
  const referenceOnly = new Set<number>();
  for (const [line, references] of referencesByLine) {
    let rest = lineText(line), shift = starts[line];
    for (const reference of [...references].sort((a, b) => b.from - a.from)) rest = rest.slice(0, reference.from - shift) + rest.slice(reference.to - shift);
    if (!rest.trim()) referenceOnly.add(line);
  }
  type Kind = 'blank' | 'heading' | 'fence' | 'code' | 'reference' | 'text';
  const kinds: Kind[] = new Array(count);
  let fence: string | null = null;
  for (let line = 0; line < count; line++) {
    const value = lineText(line);
    const marker = DRAFT_FENCE.exec(value);
    if (fence) {
      kinds[line] = marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !value.slice(marker[0].length).trim() ? 'fence' : 'code';
      if (kinds[line] === 'fence') fence = null;
      continue;
    }
    if (marker) { fence = marker[1]; kinds[line] = 'fence'; continue; }
    kinds[line] = !value.trim() ? 'blank' : referenceOnly.has(line) ? 'reference' : DRAFT_HEADING.test(value) ? 'heading' : 'text';
  }
  const owner = new Uint32Array(count);
  let counter = 0;
  for (let line = 0; line < count;) {
    if (kinds[line] === 'blank') { line++; continue; }
    let end = line;
    while (end < count && kinds[end] !== 'blank') end++;
    let number = 0;
    for (let at = line; at < end && !number; at++) {
      const single = kinds[at] === 'heading' && at === line && end === line + 1;
      if (kinds[at] !== 'reference' && kinds[at] !== 'fence' && !single) number = ++counter;
    }
    owner.fill(number, line, end);
    line = end;
  }
  const result = { starts, owner };
  if (draftNumberCache.size >= 200) draftNumberCache.delete(draftNumberCache.keys().next().value!);
  draftNumberCache.set(text, result);
  return result;
}

/**
 * 文稿里某个位置写在第几段——与写作页左侧的段号一致（CORE-01）。引用线“写进第 N 段”、观看页来历、提示条都用它。
 * 落在不计段的块里（只有引用链接、单行标题、围栏）或空行上时，归到它前面最近的一段；前面没有时归到后面第一段。
 */
export function draftParagraphIndexAt(body: string | undefined, offset: number): number | undefined {
  if (!body || offset < 0) return undefined;
  const text = body.replace(/\r\n?/g, '\n');
  if (offset > text.length) return undefined;
  const { starts, owner } = draftParagraphNumbers(text);
  let line = starts.length - 1;
  while (line > 0 && starts[line] > offset) line--;
  for (let at = line; at >= 0; at--) if (owner[at]) return owner[at];
  for (let at = line + 1; at < owner.length; at++) if (owner[at]) return owner[at];
  return undefined;
}

/** 签上的视频时间：`mm:ss–mm:ss`，终点向上取整到秒；≥1 小时用 `H:MM:SS`。 */
export function timeRangeLabel(start?: number, end?: number): string | undefined {
  if (start === undefined) return undefined;
  const clock = (seconds: number) => {
    const whole = Math.max(0, Math.floor(seconds));
    if (whole < 3600) return timecode(whole);
    return `${Math.floor(whole / 3600)}:${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  };
  if (end === undefined || end <= start) return clock(start);
  return `${clock(start)}–${clock(Math.ceil(end))}`;
}

/** 摘录签上只写位置：视频时间段或“第 N 段”；无法定位时返回 undefined。 */
export function citationLocationLabel(citation: Citation | undefined, paragraph?: number): string | undefined {
  if (!citation) return undefined;
  const time = timeRangeLabel(citation.start, citation.end);
  if (time) return time;
  if (paragraph) return `第 ${paragraph} 段`;
  return citation.textAnchor ? '原文' : undefined;
}

/** Stored default titles (K11): `摘录`, `摘录 · mm:ss`, `摘录 · mm:ss–mm:ss` (createQuoteBatch) and `摘录 · 第 N 段`. */
const DEFAULT_QUOTE_TITLE = /^摘录(?: · (?:\d{1,2}:\d{2}(?::\d{2})?(?:\s*[–-]\s*\d{1,2}:\d{2}(?::\d{2})?)?|第 \d+ 段))?$/;

/** A text excerpt stores `摘录 · <source title>` (createTextQuoteBatch, possibly shortened); that is a default too. */
function isStoredDefaultTitle(title: string, sourceTitle?: string): boolean {
  if (DEFAULT_QUOTE_TITLE.test(title)) return true;
  const named = title.startsWith('摘录 · ') ? title.slice(5).replace(/…$/, '').trim() : '';
  const source = sourceTitle?.trim();
  return !!named && !!source && source.startsWith(named);
}

type WordSegmenter = { segment(input: string): Iterable<{ segment: string }> };
type SegmenterConstructor = new (locale: string, options: { granularity: 'word' }) => WordSegmenter;

const CJK = '[\\u2E80-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF\\u3000-\\u303F]';
const CJK_BREAK = new RegExp(`(${CJK})[ \\t]*\\r?\\n\\s*(?=${CJK})`, 'gu');

/**
 * Text that spans lines (a transcript excerpt, a TXT paragraph) on one line (CORE-35): a line break between two CJK
 * characters or punctuation marks simply disappears (“赚钱，是…”, not “赚钱， 是…”); between Western words it becomes a
 * space; runs of whitespace collapse.
 */
/** Line breaks between two CJK characters (a quotation kept sentence by sentence) read as nothing, not as a space. */
export function joinCjkLines(text: string): string {
  return text.replace(CJK_BREAK, '$1');
}

export function singleLineText(text: string): string {
  return text.replace(CJK_BREAK, '$1').replace(/\s+/g, ' ').trim();
}

/** 摘录的显示标题：默认标题时取原句开头（≤18 字，按词边界截断）；用户改过的标题原样返回（C13）。 */
export function quoteDisplayTitle(data: Pick<CardData, 'title' | 'body' | 'citation'>, limit = 18): string {
  const title = data.title?.trim() ?? '';
  if (title && !isStoredDefaultTitle(title, data.citation?.title)) return title;
  const text = singleLineText(data.citation?.text ?? data.body ?? '');
  if (!text) return title || '摘录';
  if ([...text].length <= limit) return text;
  let result = '';
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
  if (Segmenter) {
    for (const { segment } of new Segmenter('zh-CN', { granularity: 'word' }).segment(text)) {
      if ([...(result + segment)].length > limit) break;
      result += segment;
    }
  }
  if (!result) result = [...text].slice(0, limit).join('');
  return `${result.replace(/[，。、；：,.;:\s]+$/u, '')}…`;
}

export interface DraftFootnote {
  index: number;
  label: string;
  location?: string;
  sourceNodeId: string;
  quoteNodeId?: string;
  time?: number;
  from: number;
  to: number;
}

/** 文稿里的引用 → 脚注（序号、来源标题、位置）。不暴露 field:// 链接。 */
export function draftFootnotes(body: string): DraftFootnote[] {
  return parseDraftReferences(body).map((reference, index) => {
    const raw = reference.label.replace(/^来源[：:]\s*/, '').replace(/\\([\\[\]()`])/g, '$1').trim();
    const timeMatch = raw.match(/\s(\d{1,2}:\d{2}(?::\d{2})?)$/);
    return {
      index: index + 1,
      label: timeMatch ? raw.slice(0, timeMatch.index).trim() : raw,
      location: reference.time !== undefined ? timeRangeLabel(reference.time) : timeMatch?.[1],
      sourceNodeId: reference.sourceNodeId,
      quoteNodeId: reference.quoteNodeId,
      time: reference.time,
      from: reference.from,
      to: reference.to,
    };
  });
}

export type DraftSegment = { text: string } | { footnote: number };

/** 文稿正文的可读片段：引用链接换成上标序号，去掉引用块的“> ”、图片与常见 Markdown 记号。 */
export function draftReadableSegments(body: string): DraftSegment[] {
  const references = parseDraftReferences(body);
  const segments: DraftSegment[] = [];
  let cursor = 0;
  references.forEach((reference, index) => {
    if (reference.from > cursor) segments.push({ text: plainMarkdown(body.slice(cursor, reference.from)) });
    segments.push({ footnote: index + 1 });
    cursor = reference.to;
  });
  if (cursor < body.length) segments.push({ text: plainMarkdown(body.slice(cursor)) });
  return segments.filter(segment => !('text' in segment) || segment.text.length > 0);
}

/** 只给预览与计数用：去掉常见 Markdown 记号，保留文字与段落。 */
export function plainMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, (_match, label: string) => label || '')
    .replace(/\[([^\]\n]*)\]\(\s*<?https?:\/\/[^)\n]*\)/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n');
}

/** 字数：只数正文文字（不含引用链接、Markdown 记号与空白），PW-B2。 */
export function draftCharacterCount(body: string): number {
  const text = draftReadableSegments(body).map(segment => ('text' in segment ? segment.text : '')).join('');
  return [...text.replace(/\s/g, '')].length;
}

export interface SourcePreviewParagraph {
  readonly from: number;
  readonly to: number;
  readonly number: number;
  readonly heading: boolean;
  /** Exactly the LF-normalized source slice [from, to), including indentation and trailing whitespace. */
  readonly text: string;
}

export interface DraftPreviewParagraph {
  readonly from: number;
  readonly to: number;
  readonly number: number;
  readonly heading: boolean;
  /** Same readable-text rules as draftReadableSegments; footnotes are numbered over the entire draft. */
  readonly parts: readonly DraftSegment[];
}

const PREVIEW_CACHE_LIMIT = 200;
const sourcePreviewCache = new Map<string, readonly SourcePreviewParagraph[]>();
const draftPreviewCache = new Map<string, readonly DraftPreviewParagraph[]>();

function cachePreview<T>(cache: Map<string, readonly T[]>, text: string, paragraphs: T[]): readonly T[] {
  const result = Object.freeze(paragraphs);
  if (cache.size >= PREVIEW_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(text, result);
  return result;
}

/**
 * Lightweight source preview, using textBlocks as the sole numbering definition (also used by paragraphIndexAt).
 * All offsets are LF-normalized UTF-16 offsets. Blank separators and gaps between long TXT lines are excluded;
 * whitespace inside a block is kept verbatim. A leading TXT title includes its terminating LF, as in reading.
 * Uncounted titles/rules have number 0 and heading true. Frozen results survive card unmounts, with a FIFO bound.
 */
export function sourcePreviewParagraphs(body: string): readonly SourcePreviewParagraph[] {
  const text = body.replace(/\r\n?/g, '\n');
  const cached = sourcePreviewCache.get(text);
  if (cached) return cached;
  const separator = new RegExp(CHUNK_SEPARATOR.source, 'g');
  let gap = separator.exec(text);
  let cursor = 0;
  let number = 0;
  let previousHeading = true;
  const paragraphs: SourcePreviewParagraph[] = [];
  for (const block of textBlocks(text)) {
    let from = cursor;
    while (gap && gap.index < block.to) {
      from = gap.index + gap[0].length;
      gap = separator.exec(text);
    }
    // Inside a prose chunk, the next block starts on its nonblank line, after the previous line's LF/gap.
    if (from === cursor && !previousHeading) {
      while (from < block.to) {
        const newline = text.indexOf('\n', from);
        if (newline < 0 || newline >= block.to || text.slice(from, newline).trim()) break;
        from = newline + 1;
      }
    }
    paragraphs.push(Object.freeze({ from, to: block.to, number: block.heading ? 0 : ++number,
      heading: block.heading, text: text.slice(from, block.to) }));
    cursor = block.to;
    previousHeading = block.heading;
  }
  return cachePreview(sourcePreviewCache, text, paragraphs);
}

/**
 * Draft preview, using draftParagraphNumbers' line owners without importing the writing editor.
 * Reference-only blocks fold into the preceding counted paragraph, or the first following one when none precedes.
 * from/to enclose the owned lines and folded references. If a separate heading lies between them, the envelope
 * overlaps that heading but parts exclude it: parts are a readable projection, never an offset map for citations.
 * A draft with only references/fences retains number-0 items. Inputs are never rewritten; cached output is frozen.
 */
export function draftPreviewParagraphs(body: string): readonly DraftPreviewParagraph[] {
  const text = body.replace(/\r\n?/g, '\n');
  const cached = draftPreviewCache.get(text);
  if (cached) return cached;
  const { starts, owner } = draftParagraphNumbers(text);
  // Resolve references over the full draft: parsing each slice would reset footnotes and lose fence context.
  const references = parseDraftReferences(text);
  type PreviewBlock = { from: number; to: number; number: number; heading: boolean; parts: DraftSegment[]; referenceOnly: boolean };
  const blocks: PreviewBlock[] = [];
  const lineEnd = (line: number) => line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
  let referenceIndex = 0;
  for (let line = 0; line < starts.length;) {
    const from = starts[line];
    if (!owner[line] && !text.slice(from, lineEnd(line)).trim()) { line++; continue; }
    const zeroFence = !owner[line] && DRAFT_FENCE.test(text.slice(from, lineEnd(line)));
    let end = line + 1;
    while (end < starts.length && owner[end] === owner[line]
      && (owner[line] || (text.slice(starts[end], lineEnd(end)).trim()
        && DRAFT_FENCE.test(text.slice(starts[end], lineEnd(end))) === zeroFence))) end++;
    const to = lineEnd(end - 1);
    const parts: DraftSegment[] = [];
    let cursor = from;
    let hasReference = false;
    let referenceOnly = !owner[line];
    while (referenceIndex < references.length && references[referenceIndex].from < to) {
      const reference = references[referenceIndex];
      const before = text.slice(cursor, reference.from);
      if (before) parts.push({ text: plainMarkdown(before) });
      referenceOnly &&= !before.trim();
      parts.push({ footnote: ++referenceIndex });
      hasReference = true;
      cursor = reference.to;
    }
    const after = text.slice(cursor, to);
    if (after) parts.push({ text: plainMarkdown(after) });
    referenceOnly &&= hasReference && !after.trim();
    blocks.push({ from, to, number: owner[line], heading: !owner[line] && DRAFT_HEADING.test(text.slice(from, to)),
      parts: parts.filter(part => !('text' in part) || part.text.length > 0), referenceOnly });
    line = end;
  }
  const firstCounted = blocks.find(block => block.number > 0);
  const folded = new Map<PreviewBlock, PreviewBlock[]>();
  let previousCounted: PreviewBlock | undefined;
  const paragraphs: PreviewBlock[] = [];
  for (const block of blocks) {
    const target = block.referenceOnly ? previousCounted ?? firstCounted : undefined;
    if (target) {
      const references = folded.get(target) ?? [];
      references.push(block);
      folded.set(target, references);
    }
    else paragraphs.push(block);
    if (block.number) previousCounted = block;
  }
  return cachePreview(draftPreviewCache, text, paragraphs.map(block => {
    const pieces = [block, ...(folded.get(block) ?? [])].sort((a, b) => a.from - b.from);
    const parts: DraftSegment[] = [];
    const append = (part: DraftSegment) => {
      const previous = parts[parts.length - 1];
      if ('text' in part && previous && 'text' in previous) previous.text += part.text;
      else parts.push({ ...part });
    };
    pieces.forEach((piece, index) => {
      if (index) {
        const gap = text.slice(pieces[index - 1].to, piece.from);
        if (gap && !gap.trim()) append({ text: plainMarkdown(gap) });
      }
      piece.parts.forEach(append);
    });
    return Object.freeze({ from: pieces[0].from, to: pieces[pieces.length - 1].to, number: block.number,
      heading: block.heading, parts: Object.freeze(parts.map(part => Object.freeze(part))) });
  }));
}
