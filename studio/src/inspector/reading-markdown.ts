import { PROSE_LINE_AVERAGE, leadTitleEnd, proseLineRanges, uncountedChunk } from '../source-location';
import { safeWebUrl } from './shared';

/**
 * Markdown for the reading view without moving a single character (DESIGN_SYSTEM §6.18.3, PR-M2, K9-13).
 *
 * The parser never produces new text. It slices the LF-normalized source into blocks and inline runs that tile
 * the source exactly; Markdown syntax (`#`, `**`, `>`, `- `, `[`, `](…)`, block gaps…) becomes `hidden` runs that
 * the renderer keeps in the DOM but does not display. So `.inspector-reading-body` keeps `textContent === source`
 * and a DOM point maps to a source offset by adding up text node lengths (reading-selection.ts).
 *
 * Blocks follow `paragraphIndexAt` (source-location.ts) exactly: the source splits at runs of blank lines,
 * whitespace-only chunks are dropped, a chunk that is one `#` line is a heading and is not counted; every other
 * chunk (list, quote and code chunks included) is one paragraph, numbered from 1 — except a prose chunk of several
 * long lines (TXT with one newline between paragraphs, `proseLineRanges`), which is one paragraph block per line.
 */

export interface InlineRun {
  from: number;
  to: number;
  /** Markdown syntax: in the DOM for exact offsets, never displayed or copied. */
  hidden?: boolean;
  strong?: boolean;
  em?: boolean;
  code?: boolean;
  strike?: boolean;
  /** Link text; `href` is set only for http(s) targets (internal links stay plain text). */
  link?: boolean;
  href?: string;
  /** The alt text of an image (the image itself is not loaded). */
  imageAlt?: boolean;
  /** A visible line break inside a paragraph, list item or quote. */
  soft?: boolean;
  /** Text of a heading line that opens a paragraph chunk (`## 小标题` followed by text without a blank line). */
  headingLine?: number;
}

export interface ListItem { from: number; to: number; runs: InlineRun[]; depth: number; task?: 'open' | 'done' }

interface BlockBase { from: number; to: number }
export interface HeadingBlock extends BlockBase { kind: 'heading'; level: number; runs: InlineRun[]; text: string }
export interface ParagraphBlock extends BlockBase {
  kind: 'paragraph'; para: number; runs: InlineRun[];
  /** Several long lines (TXT files often break paragraphs with one newline): such a chunk becomes one block per line. */
  prose: boolean;
  /** A short numbered line such as “一、谁在走” in plain text: styled and listed in the contents, still counted. */
  sectionTitle?: string;
  leadHeading?: { level: number; text: string };
}
export interface QuoteBlock extends BlockBase { kind: 'quote'; para: number; runs: InlineRun[] }
export interface CodeBlock extends BlockBase {
  kind: 'code'; para: number; runs: InlineRun[];
  /** A blank line inside a fence splits the code into paragraphs (paragraphIndexAt): this part continues the one before. */
  continued?: boolean;
  /** The fence is still open at the end of this part: the next part continues it. */
  continues?: boolean;
}
export interface RuleBlock extends BlockBase { kind: 'rule'; para: number; runs: InlineRun[] }
export interface ListBlock extends BlockBase { kind: 'list'; para: number; ordered: boolean; start: number; items: ListItem[] }
export type ReadingBlock = HeadingBlock | ParagraphBlock | QuoteBlock | CodeBlock | RuleBlock | ListBlock;
/** Source between blocks (blank lines, whitespace-only chunks): kept in the DOM, never displayed. */
export interface ReadingGap { kind: 'gap'; from: number; to: number }
export type ReadingPart = ReadingBlock | ReadingGap;

export interface ReadingHeading { from: number; blockFrom: number; level: number; text: string }
export interface ReadingDocument { text: string; parts: ReadingPart[]; headings: ReadingHeading[]; paragraphs: number }

const SEPARATOR = /\n[ \t]*\n(?:[ \t]*\n)*/g;
const HEADING = /^#{1,6}\s/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const QUOTE_LINE = /^[ \t]{0,3}>[ \t]?/;
const LIST_LINE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)/;
const TASK = /^\[( |x|X)\][ \t]+/;
const RULE = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SECTION_TITLE = /^(?:(?:[一二三四五六七八九十百零〇]{1,4}[、．.]|第[一二三四五六七八九十百零〇\d]{1,4}[章节部分篇回]|[（(][一二三四五六七八九十\d]{1,3}[)）])\S|(?:引子|引言|前言|序言?|后记|结语|尾声|附录)$)/;

export const isBlockPart = (part: ReadingPart): part is ReadingBlock => part.kind !== 'gap';

/** Parse the LF-normalized body. The result is cached by the caller (one parse per body). */
export function parseReadingDocument(text: string): ReadingDocument {
  const parts: ReadingPart[] = [];
  const headings: ReadingHeading[] = [];
  let paragraphs = 0;
  let openFence: string | null = null;
  const gap = (from: number, to: number) => {
    if (to <= from) return;
    const last = parts[parts.length - 1];
    if (last?.kind === 'gap' && last.to === from) last.to = to;
    else parts.push({ kind: 'gap', from, to });
  };
  SEPARATOR.lastIndex = 0;
  let start = 0;
  for (;;) {
    const match = SEPARATOR.exec(text);
    const end = match ? match.index : text.length;
    const chunk = text.slice(start, end);
    if (!chunk.trim()) gap(start, end);
    else {
      const trimmed = chunk.trim();
      // CORE-13: the same uncounted chunks as paragraphIndexAt — a TXT title line reads as the title, a lone rule takes no number.
      const uncounted = openFence ? null : uncountedChunk(text, start, end, !parts.some(isBlockPart), !!match && !!text.slice(match.index + match[0].length).trim());
      if (uncounted === 'title') {
        const block = titleBlock(text, start, end);
        headings.push({ from: block.from, blockFrom: block.from, level: block.level, text: block.text });
        parts.push(block);
      } else if (!openFence && HEADING.test(trimmed) && !trimmed.includes('\n')) {
        const block = headingBlock(text, start, end);
        headings.push({ from: block.from, blockFrom: block.from, level: block.level, text: block.text });
        parts.push(block);
      } else {
        // A TXT title followed by one newline (leadTitleEnd, the same rule as paragraphIndexAt): the title, then the text.
        const titleEnd = openFence ? null : leadTitleEnd(text, start, end, !parts.some(isBlockPart));
        if (titleEnd !== null) {
          const block = titleBlock(text, start, titleEnd);
          headings.push({ from: block.from, blockFrom: block.from, level: block.level, text: block.text });
          parts.push(block);
        }
        const result = bodyBlock(text, titleEnd ?? start, end, paragraphs + 1, openFence);
        openFence = result.fence;
        paragraphs += result.paragraphs;
        for (const value of result.parts) {
          if (value.kind === 'gap') { gap(value.from, value.to); continue; }
          parts.push(value);
          if (value.kind === 'paragraph' && value.leadHeading) headings.push({ from: value.from, blockFrom: value.from, level: value.leadHeading.level, text: value.leadHeading.text });
          else if (value.kind === 'paragraph' && value.sectionTitle) headings.push({ from: value.from, blockFrom: value.from, level: 2, text: value.sectionTitle });
        }
      }
    }
    if (!match) break;
    gap(match.index, match.index + match[0].length);
    start = match.index + match[0].length;
  }
  return { text, parts, headings, paragraphs };
}

function headingBlock(text: string, from: number, to: number): HeadingBlock {
  const chunk = text.slice(from, to);
  const lead = /^\s*(#{1,6})\s+/.exec(chunk)!;
  const level = lead[1].length;
  let contentEnd = to;
  const tail = /\s+#*\s*$|\s+$/.exec(chunk.slice(lead[0].length));
  if (tail) contentEnd = to - tail[0].length;
  const contentFrom = Math.min(from + lead[0].length, contentEnd);
  const runs: InlineRun[] = [{ from, to: contentFrom, hidden: true }];
  inline(text, contentFrom, contentEnd, {}, runs);
  if (contentEnd < to) runs.push({ from: contentEnd, to, hidden: true });
  return { kind: 'heading', from, to, level, runs: tidy(runs), text: visibleText(text, runs) };
}

/** A TXT title line (uncountedChunk): a level-1 heading without `#`; surrounding whitespace stays in the DOM, hidden. */
function titleBlock(text: string, from: number, to: number): HeadingBlock {
  let contentFrom = from, contentEnd = to;
  while (contentFrom < contentEnd && /\s/.test(text[contentFrom])) contentFrom++;
  while (contentEnd > contentFrom && /\s/.test(text[contentEnd - 1])) contentEnd--;
  const runs: InlineRun[] = contentFrom > from ? [{ from, to: contentFrom, hidden: true }] : [];
  inline(text, contentFrom, contentEnd, {}, runs);
  if (contentEnd < to) runs.push({ from: contentEnd, to, hidden: true });
  return { kind: 'heading', from, to, level: 1, runs: tidy(runs), text: visibleText(text, runs) };
}

function lines(text: string, from: number, to: number): { from: number; to: number }[] {
  const result: { from: number; to: number }[] = [];
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

/** Trailing whitespace of a chunk is syntax, not content (no empty line after a block). */
function contentEndOf(text: string, from: number, to: number): number {
  let end = to;
  while (end > from && /[ \t\n]/.test(text[end - 1])) end--;
  return end;
}

/** One chunk between blank lines: usually one block; a prose chunk is one paragraph block per line, with gaps. */
function bodyBlock(text: string, from: number, to: number, para: number, openFence: string | null): { parts: ReadingPart[]; paragraphs: number; fence: string | null } {
  const result = chunkBlock(text, from, to, para, openFence);
  // CORE-13: a lone rule takes no paragraph number (paragraphIndexAt does not count it either).
  return 'parts' in result ? { ...result, fence: null } : { parts: [result.block], paragraphs: result.block.kind === 'rule' ? 0 : 1, fence: result.fence };
}

function chunkBlock(text: string, from: number, to: number, para: number, openFence: string | null): { block: ReadingBlock; fence: string | null } | { parts: ReadingPart[]; paragraphs: number } {
  const end = contentEndOf(text, from, to);
  const rows = lines(text, from, end);
  const first = text.slice(rows[0].from, rows[0].to);
  const tailRun = (runs: InlineRun[]) => { if (end < to) runs.push({ from: end, to, hidden: true }); return tidy(runs); };

  // Code: a fence opens here, or one opened in an earlier chunk is still open.
  const fenceMatch = FENCE.exec(first);
  if (openFence || fenceMatch) {
    let fence = openFence;
    const runs: InlineRun[] = [];
    rows.forEach((row, index) => {
      const line = text.slice(row.from, row.to);
      const newline = row.to < end ? { from: row.to, to: row.to + 1 } : null;
      const marker = FENCE.exec(line);
      if (!fence && index === 0 && marker) {
        fence = marker[1][0].repeat(3);
        runs.push({ from: row.from, to: newline ? newline.to : row.to, hidden: true });
        return;
      }
      if (fence && marker && marker[1].startsWith(fence) && !line.slice(marker[0].length).trim()) {
        fence = null;
        runs.push({ from: index > 0 ? row.from - 1 : row.from, to: row.to, hidden: true });
        if (newline) runs.push({ ...newline, code: true });
        return;
      }
      if (row.to > row.from) runs.push({ from: row.from, to: row.to, code: true });
      if (newline) runs.push({ ...newline, code: true, soft: true });
    });
    return { block: { kind: 'code', from, to, para, runs: fixCodeOverlap(tailRun(runs)), ...(openFence ? { continued: true } : {}), ...(fence ? { continues: true } : {}) }, fence };
  }

  if (rows.length === 1 && RULE.test(first)) {
    return { block: { kind: 'rule', from, to, para, runs: tailRun([{ from, to: end, hidden: true }]) }, fence: null };
  }

  if (QUOTE_LINE.test(first)) {
    const runs: InlineRun[] = [];
    rows.forEach((row, index) => {
      const marker = QUOTE_LINE.exec(text.slice(row.from, row.to));
      const contentFrom = marker ? row.from + marker[0].length : row.from;
      if (contentFrom > row.from) runs.push({ from: row.from, to: contentFrom, hidden: true });
      inline(text, contentFrom, row.to, {}, runs);
      if (index < rows.length - 1) runs.push({ from: row.to, to: row.to + 1, soft: true });
    });
    return { block: { kind: 'quote', from, to, para, runs: tailRun(runs) }, fence: null };
  }

  const listMatch = LIST_LINE.exec(first);
  if (listMatch && !RULE.test(first)) {
    const ordered = /\d/.test(listMatch[2]);
    const items: ListItem[] = [];
    let current: ListItem | null = null;
    const baseIndent = listMatch[1].replace(/\t/g, '    ').length;
    rows.forEach((row, index) => {
      const line = text.slice(row.from, row.to);
      const marker = LIST_LINE.exec(line);
      const isLast = index === rows.length - 1;
      if (marker) {
        if (current) items.push(current);
        const depth = Math.max(0, Math.min(3, Math.floor((marker[1].replace(/\t/g, '    ').length - baseIndent) / 2)));
        current = { from: row.from, to: row.to, runs: [], depth };
        let contentFrom = row.from + marker[0].length;
        const task = TASK.exec(line.slice(marker[0].length));
        if (task) { current.task = task[1] === ' ' ? 'open' : 'done'; contentFrom += task[0].length; }
        current.runs.push({ from: row.from, to: contentFrom, hidden: true });
        inline(text, contentFrom, row.to, {}, current.runs);
      } else if (current) {
        current.runs.push({ from: row.from - 1, to: row.from, soft: true });
        inline(text, row.from, row.to, {}, current.runs);
        current.to = row.to;
      }
      if (current && !isLast) {
        const next = rows[index + 1];
        const nextIsItem = LIST_LINE.test(text.slice(next.from, next.to));
        // The newline that ends an item is structure (the next <li> breaks the line); inside an item it is text.
        if (nextIsItem) { current.runs.push({ from: row.to, to: row.to + 1, hidden: true }); current.to = row.to + 1; }
      }
    });
    if (current) items.push(current);
    const lastItem = items[items.length - 1];
    if (end < to) { lastItem.runs.push({ from: end, to, hidden: true }); lastItem.to = to; }
    for (const item of items) { item.runs = tidy(item.runs); item.to = item.runs[item.runs.length - 1].to; }
    const startNumber = ordered ? Number.parseInt(listMatch[2], 10) : 1;
    return { block: { kind: 'list', from, to, para, ordered, start: Number.isFinite(startNumber) ? startNumber : 1, items }, fence: null };
  }

  // Paragraph, possibly opened by a heading line (`## 小标题\n正文`).
  const runs: InlineRun[] = [];
  let leadHeading: ParagraphBlock['leadHeading'];
  let bodyFrom = from;
  const headingLine = /^[ \t]{0,3}(#{1,6})\s+(?=\S)/.exec(first);
  if (headingLine && rows.length > 1) {
    const level = headingLine[1].length;
    const lineEnd = rows[0].to;
    const tail = /\s+#*\s*$|\s+$/.exec(text.slice(rows[0].from + headingLine[0].length, lineEnd));
    const contentEnd = tail ? lineEnd - tail[0].length : lineEnd;
    runs.push({ from, to: from + headingLine[0].length, hidden: true });
    const headingRuns: InlineRun[] = [];
    inline(text, from + headingLine[0].length, contentEnd, { headingLine: level }, headingRuns);
    runs.push(...headingRuns);
    if (contentEnd < lineEnd) runs.push({ from: contentEnd, to: lineEnd, hidden: true });
    runs.push({ from: lineEnd, to: lineEnd + 1, soft: true, headingLine: level });
    leadHeading = { level, text: visibleText(text, headingRuns) };
    bodyFrom = lineEnd + 1;
  }
  const bodyRows = rows.filter(row => row.from >= bodyFrom);
  const rowRuns = (list: { from: number; to: number }[]) => list.forEach((row, index) => {
    // A TXT paragraph's leading full-width spaces are first-line indentation: the reading view separates paragraphs
    // by space and numbers them, so the indent stays in the DOM but is not shown (§3.4, INSP-11).
    const indent = /^[ \t　]+/.exec(text.slice(row.from, row.to))?.[0].length ?? 0;
    if (indent && indent < row.to - row.from) runs.push({ from: row.from, to: row.from + indent, hidden: true });
    inline(text, row.from + (indent < row.to - row.from ? indent : 0), row.to, {}, runs);
    if (index < list.length - 1) runs.push({ from: row.to, to: row.to + 1, soft: true });
  });
  const titleOf = (value: string) => Array.from(value).length <= 30 && SECTION_TITLE.test(value) ? value : undefined;
  // TXT with one newline between paragraphs (W-M1): every non-blank line is its own numbered paragraph, exactly
  // as paragraphIndexAt counts it; the newline (and any whitespace-only lines) between them is a gap.
  const proseLines = proseLineRanges(text, bodyRows);
  if (proseLines) {
    const parts: ReadingPart[] = [];
    proseLines.forEach((line, index) => {
      const last = index === proseLines.length - 1;
      const blockFrom = index === 0 ? from : line.from;
      if (index > 0) runs.length = 0;
      rowRuns(bodyRows.filter(row => row.from >= (index === 0 ? bodyFrom : line.from) && (last || row.to <= line.to)));
      const sectionTitle = index === 0 && leadHeading ? undefined : titleOf(text.slice(line.from, line.to).trim());
      parts.push({ kind: 'paragraph', from: blockFrom, to: last ? to : line.to, para: para + index, runs: last ? tailRun(runs) : tidy(runs), prose: true, ...(sectionTitle ? { sectionTitle } : {}), ...(index === 0 && leadHeading ? { leadHeading } : {}) });
      if (!last) parts.push({ kind: 'gap', from: line.to, to: proseLines[index + 1].from });
    });
    return { parts, paragraphs: proseLines.length };
  }
  rowRuns(bodyRows);
  const lengths = bodyRows.map(row => row.to - row.from);
  const prose = bodyRows.length > 1 && lengths.reduce((sum, value) => sum + value, 0) / bodyRows.length >= PROSE_LINE_AVERAGE;
  const plain = text.slice(from, end);
  const sectionTitle = !leadHeading && rows.length === 1 ? titleOf(plain.trim()) : undefined;
  return { block: { kind: 'paragraph', from, to, para, runs: tailRun(runs), prose, ...(sectionTitle ? { sectionTitle } : {}), ...(leadHeading ? { leadHeading } : {}) }, fence: null };
}

/** A closing fence run may start one character before its row (the newline); drop the overlapping soft newline. */
function fixCodeOverlap(runs: InlineRun[]): InlineRun[] {
  const result: InlineRun[] = [];
  for (const run of runs) {
    const last = result[result.length - 1];
    if (last && run.from < last.to) {
      if (run.from <= last.from) result.pop();
      else last.to = run.from;
    }
    result.push(run);
  }
  return result.filter(run => run.to > run.from);
}

type RunAttrs = Omit<InlineRun, 'from' | 'to'>;

/** Inline syntax: escapes, code spans, images, links, autolinks, strong/em/strike. Unmatched syntax stays text. */
function inline(text: string, from: number, to: number, attrs: RunAttrs, out: InlineRun[]) {
  let plainStart = from;
  let index = from;
  const flush = (end: number) => { if (end > plainStart) out.push({ from: plainStart, to: end, ...attrs }); };
  const hide = (a: number, b: number) => { if (b > a) out.push({ from: a, to: b, hidden: true }); };
  while (index < to) {
    const char = text[index];
    if (char === '\\' && index + 1 < to && /[\\`*_{}[\]()#+\-.!~>|]/.test(text[index + 1])) {
      flush(index); hide(index, index + 1); plainStart = index + 1; index += 2; continue;
    }
    if (char === '`') {
      let ticks = 1;
      while (index + ticks < to && text[index + ticks] === '`') ticks++;
      const fence = '`'.repeat(ticks);
      let close = text.indexOf(fence, index + ticks);
      while (close !== -1 && close + ticks < to && text[close + ticks] === '`') close = text.indexOf(fence, close + ticks + 1);
      if (close !== -1 && close + ticks <= to && close > index + ticks) {
        flush(index); hide(index, index + ticks);
        out.push({ from: index + ticks, to: close, ...attrs, code: true });
        hide(close, close + ticks);
        index = close + ticks; plainStart = index; continue;
      }
      index += ticks; continue;
    }
    if (char === '!' && text[index + 1] === '[') {
      const link = matchLink(text, index + 1, to);
      if (link) {
        flush(index); hide(index, index + 2);
        if (link.textEnd > index + 2) out.push({ from: index + 2, to: link.textEnd, ...attrs, imageAlt: true });
        hide(link.textEnd, link.end);
        index = link.end; plainStart = index; continue;
      }
    }
    if (char === '[') {
      const link = matchLink(text, index, to);
      if (link && link.textEnd > index + 1) {
        flush(index); hide(index, index + 1);
        const href = safeWebUrl(link.url);
        inline(text, index + 1, link.textEnd, { ...attrs, link: true, ...(href ? { href } : {}) }, out);
        hide(link.textEnd, link.end);
        index = link.end; plainStart = index; continue;
      }
    }
    if (char === '<') {
      const auto = /^<(https?:\/\/[^\s<>]+)>/.exec(text.slice(index, Math.min(to, index + 2048)));
      if (auto) {
        flush(index); hide(index, index + 1);
        const href = safeWebUrl(auto[1]);
        out.push({ from: index + 1, to: index + auto[0].length - 1, ...attrs, link: true, ...(href ? { href } : {}) });
        hide(index + auto[0].length - 1, index + auto[0].length);
        index += auto[0].length; plainStart = index; continue;
      }
    }
    if (char === '*' || char === '_' || char === '~') {
      const span = matchEmphasis(text, index, to);
      if (span) {
        flush(index); hide(index, span.contentFrom);
        const next: RunAttrs = { ...attrs, ...(span.kind === 'strong' ? { strong: true } : span.kind === 'em' ? { em: true } : { strike: true }) };
        inline(text, span.contentFrom, span.contentTo, next, out);
        hide(span.contentTo, span.end);
        index = span.end; plainStart = index; continue;
      }
      let run = 1;
      while (index + run < to && text[index + run] === char) run++;
      index += run; continue;
    }
    index++;
  }
  flush(to);
}

function matchLink(text: string, open: number, to: number): { textEnd: number; end: number; url: string } | null {
  let depth = 0;
  let close = -1;
  for (let cursor = open; cursor < to; cursor++) {
    const char = text[cursor];
    if (char === '\\') { cursor++; continue; }
    if (char === '\n' && text[cursor + 1] === '\n') return null;
    if (char === '[') depth++;
    else if (char === ']' && --depth === 0) { close = cursor; break; }
  }
  if (close === -1 || text[close + 1] !== '(') return null;
  let parens = 0;
  for (let cursor = close + 1; cursor < to; cursor++) {
    const char = text[cursor];
    if (char === '\n') return null;
    if (char === '(') parens++;
    else if (char === ')' && --parens === 0) {
      const raw = text.slice(close + 2, cursor).trim();
      const url = raw.replace(/^<([^>]*)>.*$/, '$1').replace(/\s+(?:"[^"]*"|'[^']*'|\([^)]*\))$/, '').trim();
      return { textEnd: close, end: cursor + 1, url };
    }
  }
  return null;
}

function matchEmphasis(text: string, open: number, to: number): { kind: 'strong' | 'em' | 'strike'; contentFrom: number; contentTo: number; end: number } | null {
  const char = text[open];
  let run = 1;
  while (open + run < to && text[open + run] === char) run++;
  const before = open > 0 ? text[open - 1] : ' ';
  if (char === '_' && /[\p{L}\p{N}]/u.test(before) && !/[㐀-鿿]/u.test(before)) return null;
  const size = char === '~' ? (run >= 2 ? 2 : 0) : run >= 2 ? 2 : 1;
  if (!size) return null;
  const contentFrom = open + size;
  if (contentFrom >= to || /\s/.test(text[contentFrom])) return null;
  for (let cursor = contentFrom + 1; cursor + size <= to; cursor++) {
    if (text[cursor] === '\n' && text[cursor + 1] === '\n') return null;
    if (text[cursor] !== char) continue;
    let closeRun = 1;
    while (cursor + closeRun < to && text[cursor + closeRun] === char) closeRun++;
    const closeAt = cursor + closeRun - size;
    if (closeRun >= size && closeAt > contentFrom && !/\s/.test(text[closeAt - 1])) {
      const after = closeAt + size < text.length ? text[closeAt + size] : ' ';
      if (char === '_' && /[\p{L}\p{N}]/u.test(after) && !/[㐀-鿿]/u.test(after)) { cursor += closeRun - 1; continue; }
      return { kind: char === '~' ? 'strike' : size === 2 ? 'strong' : 'em', contentFrom, contentTo: closeAt, end: closeAt + size };
    }
    cursor += closeRun - 1;
  }
  return null;
}

/** Merge adjacent runs with identical attributes and drop empty ones (fewer DOM nodes, same offsets). */
function tidy(runs: InlineRun[]): InlineRun[] {
  const result: InlineRun[] = [];
  for (const run of runs) {
    if (run.to <= run.from) continue;
    const last = result[result.length - 1];
    if (last && last.to === run.from && sameAttrs(last, run) && !run.soft && !last.soft) last.to = run.to;
    else result.push({ ...run });
  }
  return result;
}

const ATTR_KEYS: (keyof RunAttrs)[] = ['hidden', 'strong', 'em', 'code', 'strike', 'link', 'href', 'imageAlt', 'soft', 'headingLine'];
export function sameAttrs(a: InlineRun, b: InlineRun): boolean {
  return ATTR_KEYS.every(key => a[key] === b[key]);
}

function visibleText(text: string, runs: InlineRun[]): string {
  return runs.filter(run => !run.hidden && !run.soft).map(run => text.slice(run.from, run.to)).join('').replace(/\s+/g, ' ').trim();
}

/** All runs of the document in source order, for offset lookups (hidden runs included). */
export function documentRuns(document: ReadingDocument): InlineRun[] {
  const runs: InlineRun[] = [];
  for (const part of document.parts) {
    if (part.kind === 'gap') runs.push({ from: part.from, to: part.to, hidden: true });
    else if (part.kind === 'list') for (const item of part.items) runs.push(...item.runs);
    else runs.push(...part.runs);
  }
  return runs;
}

/**
 * Shrink a selection to what a reader actually sees: no leading or trailing Markdown syntax, block gaps or
 * whitespace. Hidden syntax in the middle stays (the stored quote is always an exact slice of the source).
 */
export function trimToVisible(document: ReadingDocument, from: number, to: number, runs: InlineRun[] = documentRuns(document)): { from: number; to: number } | null {
  const hiddenAt = (offset: number) => {
    let low = 0, high = runs.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1, run = runs[middle];
      if (offset < run.from) high = middle - 1;
      else if (offset >= run.to) low = middle + 1;
      else return !!run.hidden;
    }
    return false;
  };
  let start = Math.max(0, from), end = Math.min(document.text.length, to);
  while (start < end && (hiddenAt(start) || /\s/.test(document.text[start]))) start++;
  while (end > start && (hiddenAt(end - 1) || /\s/.test(document.text[end - 1]))) end--;
  return end > start ? { from: start, to: end } : null;
}

/** The block (not a gap) that contains this offset, or the next block after it. */
export function blockAt(document: ReadingDocument, offset: number): ReadingBlock | undefined {
  return document.parts.find((part): part is ReadingBlock => part.kind !== 'gap' && offset < part.to);
}

type SentenceSegmenter = { segment(input: string): Iterable<{ segment: string; index: number }> };
type SentenceSegmenterConstructor = new (locale: string, options: { granularity: 'sentence' }) => SentenceSegmenter;
let sentenceSegmenter: SentenceSegmenter | null | undefined;
function segmenter(): SentenceSegmenter | null {
  if (sentenceSegmenter === undefined) {
    const Segmenter = (Intl as unknown as { Segmenter?: SentenceSegmenterConstructor }).Segmenter;
    sentenceSegmenter = Segmenter ? new Segmenter('zh-CN', { granularity: 'sentence' }) : null;
  }
  return sentenceSegmenter;
}

/** Visible sentences of one block, as source ranges (keyboard selection by sentence, PR-M3). */
export function blockSentences(document: ReadingDocument, block: ReadingBlock): { from: number; to: number }[] {
  const source = document.text.slice(block.from, block.to);
  const pieces: { from: number; to: number }[] = [];
  const tool = segmenter();
  if (tool) for (const { segment, index } of tool.segment(source)) pieces.push({ from: block.from + index, to: block.from + index + segment.length });
  else {
    const pattern = /[^。！？!?…\n]*(?:[。！？!?…]+[”’」』）)]*|\n|$)/g;
    for (let match = pattern.exec(source); match && match[0]; match = pattern.exec(source)) pieces.push({ from: block.from + match.index, to: block.from + match.index + match[0].length });
  }
  // A line break inside a block ends a sentence too (list items, poems, single-newline paragraphs).
  const split = pieces.flatMap(piece => {
    const result: { from: number; to: number }[] = [];
    let cursor = piece.from;
    for (let index = piece.from; index < piece.to; index++) {
      if (document.text[index] === '\n') { result.push({ from: cursor, to: index }); cursor = index + 1; }
    }
    result.push({ from: cursor, to: piece.to });
    return result;
  });
  const runs = block.kind === 'list' ? block.items.flatMap(item => item.runs) : block.runs;
  return split.map(piece => trimToVisible(document, piece.from, piece.to, runs)).filter((piece): piece is { from: number; to: number } => !!piece);
}

const BYLINE = /^(?:文\s*[\/／|｜]\s*\S.{0,20}|(?:作者|来源|撰文|编辑|原文)[：:].{0,40})$/;

/**
 * Lines that are not sentences of the text (INSP-07): headings, “一、…” section lines, a heading line that opens a
 * paragraph, rules and code, and a byline such as “文 / 林冉”. Keyboard selection by sentence steps over them.
 */
function readableSentences(document: ReadingDocument, block: ReadingBlock): { from: number; to: number }[] {
  if (block.kind === 'heading' || block.kind === 'rule' || block.kind === 'code') return [];
  if (block.kind === 'paragraph' && block.sectionTitle) return [];
  const sentences = blockSentences(document, block);
  if (block.kind !== 'paragraph') return sentences;
  // The heading line of “## 小标题” + newline + text ends at the soft newline marked as part of the heading.
  const headingEnd = block.leadHeading ? block.runs.find(run => run.soft && run.headingLine)?.to ?? block.from : block.from;
  return sentences.filter(sentence => sentence.from >= headingEnd && !BYLINE.test(document.text.slice(sentence.from, sentence.to).trim()));
}

/** The next sentence starting at or after `offset` (or the previous one ending at or before it); titles and bylines are skipped. */
export function adjacentSentence(document: ReadingDocument, offset: number, direction: 1 | -1, skipBlockFrom: number | null = null): { from: number; to: number } | null {
  const blocks = document.parts.filter(isBlockPart).filter(block => block.from !== skipBlockFrom);
  if (direction === 1) {
    for (const block of blocks) {
      if (block.to <= offset) continue;
      const hit = readableSentences(document, block).find(sentence => sentence.from >= offset);
      if (hit) return hit;
    }
  } else {
    for (let index = blocks.length - 1; index >= 0; index--) {
      const block = blocks[index];
      if (block.from >= offset) continue;
      const sentences = readableSentences(document, block).filter(sentence => sentence.to <= offset);
      if (sentences.length) return sentences[sentences.length - 1];
    }
  }
  return null;
}
