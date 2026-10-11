import { exportMarkdown, safeUrl } from './board-utils';
import { parseDraftReferences, type DraftReference } from './draft-references';
import { getSourceUrl } from './media-source';
import { timecode, type Board, type BoardNode } from './model';
import { leadTitleEnd, paragraphIndexAt, proseLineRanges, sourceLines } from './source-location';

function markdownText(text: string): string { return text.replace(/([\\`*_{}\[\]<>#])/g, '\\$1'); }
function singleLine(text: string): string { return text.replace(/[\r\n\t]+/g, ' ').trim(); }

interface ExportSource { title: string; note: string; url?: string; time?: number; end?: number; paragraph?: number; quote?: string }
function referenceSource(reference: DraftReference, nodes: ReadonlyMap<string, BoardNode>): ExportSource {
  const linked = nodes.get(reference.sourceNodeId);
  const quoteId = reference.quoteNodeId;
  const candidate = quoteId ? nodes.get(quoteId) : linked?.data.kind === 'quote' ? linked : undefined;
  // A stale or forged quote ID must never lend another source's metadata to this reference.
  const quote = candidate?.data.kind === 'quote' && (!quoteId || candidate.data.citation?.nodeId === reference.sourceNodeId) ? candidate : undefined;
  const citation = quote?.data.citation;
  const source = citation && linked?.data.kind === 'quote' ? nodes.get(citation.nodeId) : linked;
  const originalUrl = source ? safeUrl(getSourceUrl(source.data)) : quote ? safeUrl(getSourceUrl(quote.data)) : null;
  let label = reference.label.startsWith('field://') || reference.label.startsWith('<field://') ? '' : reference.label.replace(/^来源[:：]\s*/, '');
  if (/^来源[:：]/.test(reference.label) && reference.time !== undefined) {
    const suffix = ` ${timecode(reference.time)}`;
    if (label.endsWith(suffix)) label = label.slice(0, -suffix.length);
  }
  const title = singleLine(citation?.title || source?.data.title || label || '已移除的来源');
  const time = reference.time ?? citation?.start;
  const end = citation?.end !== undefined && (reference.time === undefined || reference.time === citation.start) ? citation.end : undefined;
  const author = typeof source?.data.sourceAuthor === 'string' && source.data.sourceAuthor.trim() ? `；作者：${singleLine(source.data.sourceAuthor)}` : '';
  let note: string;
  if (!source) note = '原始来源已移除；文稿中的引文为保留快照';
  else if (originalUrl) note = `原始${source.data.kind === 'video' ? '视频' : '网页'}来源${author}`;
  else if (source.data.kind === 'video' || source.data.kind === 'image') note = `本机${source.data.kind === 'video' ? '视频' : '图片'}资料；交付时请另附原始文件`;
  else note = author.replace(/^；/, '');
  // CORE-14: a text source names the paragraph the sentence comes from (the same “第 N 段” as its tag) and the sentence.
  const anchor = citation?.textAnchor;
  const paragraph = time === undefined && anchor && source && source.data.kind !== 'video' ? paragraphIndexAt(source.data.body, anchor.from) : undefined;
  const sentence = time === undefined && citation?.text ? singleLine(citation.text) : '';
  return { title, note, ...(originalUrl ? { url: originalUrl } : {}), ...(time === undefined ? {} : { time }), ...(end === undefined ? {} : { end }), ...(paragraph ? { paragraph } : {}), ...(sentence ? { quote: sentence } : {}) };
}

function referenceLabel(reference: DraftReference, source: ExportSource): string {
  return reference.label.startsWith('field://') || reference.label.startsWith('<field://') ? source.title : reference.label;
}

/** Rewrite parsed references only. Literal URI examples inside Markdown code stay exact. */
function exportBody(body: string, nodes: BoardNode[], includeSources: boolean, prefix: string, sourcesHeading = '## 来源'): string {
  const references = parseDraftReferences(body);
  if (!references.length) return body;
  const nodeIndex = new Map(nodes.map(node => [node.id, node]));
  const parts: string[] = [], footnotes: string[] = [];
  let previous = 0;
  for (const [index, reference] of references.entries()) {
    const source = referenceSource(reference, nodeIndex);
    const label = referenceLabel(reference, source);
    let from = reference.from, to = reference.to;
    let replacement: string;
    if (includeSources) {
      const id = `${prefix}-${index + 1}`;
      replacement = `${markdownText(label)}[^${id}]`;
      const timestamp = source.time === undefined ? source.paragraph ? ` · 第 ${source.paragraph} 段` : '' : ` · ${timecode(source.time)}${source.end === undefined ? '' : `–${timecode(source.end)}`}`;
      const sentence = source.quote ? `原句：“${markdownText(source.quote.length > 120 ? `${source.quote.slice(0, 120)}…` : source.quote)}”。` : '';
      footnotes.push(`[^${id}]: ${markdownText(source.title)}${timestamp}。${sentence}${source.note ? `${markdownText(source.note)}。` : ''}${source.url ? ` 原始链接：<${source.url}>` : ''}`.trimEnd());
    } else {
      replacement = /^来源[:：]/.test(label) ? '' : markdownText(label);
      // Generated provenance has its own paragraph; remove that line, not the quotation.
      const lineFrom = body.lastIndexOf('\n', from - 1) + 1;
      const nextNewline = body.indexOf('\n', to);
      const lineTo = nextNewline < 0 ? body.length : nextNewline;
      if (!replacement && !body.slice(lineFrom, from).trim() && !body.slice(to, lineTo).trim()) {
        from = lineFrom; to = nextNewline < 0 ? lineTo : nextNewline + 1;
      }
    }
    parts.push(body.slice(previous, from), replacement); previous = to;
  }
  parts.push(body.slice(previous));
  return `${parts.join('')}${footnotes.length ? `\n\n${sourcesHeading}\n\n${footnotes.join('\n\n')}` : ''}`;
}

/**
 * CORE-33: an inserted quotation leaves runs of blank lines around it; outside fenced code, more than one blank line
 * becomes one, and the paragraph-leading full-width spaces of a TXT (a typesetting habit, not text) are dropped.
 */
export function tidyBlankLines(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const marker = FENCE_LINE.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
      out.push(line);
      continue;
    }
    if (marker) { fence = marker[1]; out.push(line); continue; }
    if (!line.trim() && out.length && !out[out.length - 1].trim()) continue;
    out.push(line.replace(/^\u3000+/, ''));
  }
  return out.join('\n');
}

/** Current manuscript only; historical versions and unrelated materials are not appended. */
export function exportDraftMarkdown(draft: BoardNode, nodes: BoardNode[], includeSources: boolean): string {
  const title = markdownText(singleLine(draft.data.title) || '我的文稿');
  const content = tidyBlankLines(exportBody(draft.data.body, nodes, includeSources, 'source'));
  return `# ${title}\n\n${content}${content.endsWith('\n') ? '' : '\n'}`;
}

const FENCE_LINE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const ATX_HEADING = /^([ \t]{0,3})(#{1,6})(?=[ \t]|\r?$)/;
const SETEXT_UNDERLINE = /^[ \t]{0,3}(=+|-+)[ \t]*\r?$/;
const BLOCK_START = /^(?:[ \t]{4}|[ \t]{0,3}(?:[>#|<]|[-*+][ \t]|\d{1,9}[.)][ \t]|`{3}|~{3}))/;

/**
 * Inside the board export every card body sits under its card's `##` title, so the body's own headings move two
 * levels down (`#` → `###`, at most `######`): a material's `# 标题` no longer opens a second document (W-M4).
 * A one-line setext heading becomes the matching ATX heading; fenced code stays exact.
 */
export function demoteHeadings(body: string, levels = 2): string {
  const lines = body.split('\n');
  const out: string[] = [];
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = FENCE_LINE.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
      out.push(line);
      continue;
    }
    if (marker) { fence = marker[1]; out.push(line); continue; }
    const atx = ATX_HEADING.exec(line);
    if (atx) { out.push(`${atx[1]}${'#'.repeat(Math.min(6, atx[2].length + levels))}${line.slice(atx[0].length)}`); continue; }
    const under = index + 1 < lines.length ? SETEXT_UNDERLINE.exec(lines[index + 1]) : null;
    if (under && line.trim() && !BLOCK_START.test(line) && (index === 0 || !lines[index - 1].trim())) {
      const level = Math.min(6, (under[1][0] === '=' ? 1 : 2) + levels);
      out.push(`${'#'.repeat(level)} ${line.trim()}${lines[index + 1].endsWith('\r') ? '\r' : ''}`);
      index++;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * TXT sources break paragraphs with a single newline, which Markdown joins into one paragraph (W-M4). The export
 * follows the reading view's rule (proseLineRanges, W-M1): a chunk of long lines becomes one paragraph per line; a
 * chunk of short lines (a poem, an address) stays one paragraph and keeps its line breaks. A title on the first line
 * (leadTitleEnd) becomes a paragraph of its own instead of running into the text below it.
 */
export function plainTextParagraphs(body: string): string {
  const text = body.replace(/\r\n?/g, '\n');
  const paragraphs = (chunk: string) => {
    const prose = proseLineRanges(chunk, sourceLines(chunk, 0, chunk.length));
    if (prose) return prose.map(row => chunk.slice(row.from, row.to)).join('\n\n');
    const rows = chunk.split('\n');
    return rows.map((row, index) => (index < rows.length - 1 && row.trim() ? `${row.replace(/[ \t]+$/, '')}  ` : row)).join('\n');
  };
  let first = true;
  return text.split(/\n[ \t]*\n/).map(chunk => {
    if (!chunk.trim()) return chunk;
    const isFirst = first;
    first = false;
    // A title line followed by one newline (leadTitleEnd, as paragraphIndexAt and the reading view) stays apart from the text.
    const start = chunk.length - chunk.replace(/^(?:[ \t]*\n)+/, '').length;
    const titleEnd = leadTitleEnd(chunk, start, chunk.length, isFirst);
    return titleEnd === null ? paragraphs(chunk) : `${chunk.slice(start, titleEnd).trim()}\n\n${paragraphs(chunk.slice(titleEnd))}`;
  }).filter(chunk => chunk.trim()).join('\n\n');
}

/** Keep the existing board ordering and material export, with portable draft references. */
export function exportBoardMarkdown(board: Board): string {
  const portable: Board = {
    ...board,
    nodes: board.nodes.map((node, index) => {
      const body = demoteHeadings(node.data.tags?.includes('纯文本') ? plainTextParagraphs(node.data.body) : node.data.body);
      const citation = node.data.citation?.text ? { ...node.data.citation, text: demoteHeadings(node.data.citation.text) } : node.data.citation;
      // The card title is `##`, so a draft's footnotes are `### 来源` under it.
      return { ...node, data: { ...node.data, body: exportBody(body, board.nodes, true, `source-${index + 1}`, '### 来源'), ...(citation ? { citation } : {}) } };
    }),
  };
  // The original exporter retains quotation snapshots, subtitles and external material links.
  return tidyBlankLines(exportMarkdown(portable));
}

