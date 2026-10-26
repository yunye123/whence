import { timecode, uid, type Board, type BoardNode, type CardKind, type TranscriptLine } from './model';
import { paragraphIndexAt, quoteDisplayTitle } from './source-location';
import { transcriptRevision, transcriptSentence, type TranscriptScript } from './transcript-tools';

/** External links only. Local media is resolved by the workspace, never opened as a link. */
export function safeUrl(value: string): string | null {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/**
 * A new card stores no prompt copy: bodies start empty and a new draft has no title. Hints such as
 * “一个想法、一句想留住的话……” are placeholders of the card and inspector fields (CD-M3), so they never
 * reach the canvas data, search, or Markdown export.
 */
/**
 * Default titles of new cards use the interface names (§8.1, CORE-20: “笔记”, not the stored type label “灵感笔记”).
 * `cardLabels` keeps its stored values (K1); a draft starts untitled.
 */
export const DEFAULT_TITLES: Record<CardKind, string> = { video: '视频', image: '图片', note: '笔记', quote: '摘录', draft: '', link: '链接', frame: '分组' };

export function createNode(kind: CardKind, position = { x: 80, y: 80 }): BoardNode {
  return { id: uid(), type: 'card', position: { ...position }, data: {
    kind, title: DEFAULT_TITLES[kind], body: '',
    tone: kind === 'note' ? 'butter' : kind === 'quote' ? 'mint' : 'paper',
    ...(kind === 'video' ? { transcript: [] } : {}),
    ...(kind === 'draft' ? { draftVersions: [] } : {}),
  }, style: kind === 'frame' ? { width: 660, height: 450 } : { width: kind === 'draft' ? 340 : 290 } };
}

export function duplicateNode(node: BoardNode): BoardNode {
  const copy = structuredClone(node);
  copy.id = uid();
  copy.position = { x: node.position.x + 36, y: node.position.y + 36 };
  copy.data.title = `${node.data.title} · 副本`;
  copy.data.transcript?.forEach(line => { line.id = uid(); });
  copy.data.draftVersions?.forEach(version => { version.id = uid(); });
  delete copy.data.nativeImportJobId;
  if (copy.data.videoImport) {
    copy.data.videoImport.attemptId = uid();
    if (['queued', 'downloading', 'transcribing'].includes(copy.data.videoImport.status)) {
      copy.data.videoImport.status = 'interrupted';
      copy.data.videoImport.message = '此副本尚未完成导入，可点击重试继续。';
      copy.data.videoImport.updatedAt = new Date().toISOString();
    }
  }
  return copy;
}

function subtitleTime(value: string): number | null {
  const match = value.match(/^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!match) return null;
  const hours = Number(match[1] ?? 0), minutes = Number(match[2]), seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds + Number(match[4]) / 1000;
}

/** Parses SRT and WebVTT without interpreting cue markup as HTML. */
export function parseSubtitles(text: string): TranscriptLine[] {
  if (text.length > 4 * 1024 * 1024) throw new Error('字幕文件过大，请使用小于 4 MiB 的 SRT 或 VTT 文件。');
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const result: TranscriptLine[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (/^(NOTE(?:\s|$)|STYLE$|REGION$)/.test(line)) {
      while (index + 1 < lines.length && lines[index + 1].trim()) index++;
      continue;
    }
    if (!line.includes('-->')) continue;
    const timing = line.match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
    if (!timing) throw new Error(`第 ${index + 1} 行字幕时间格式不正确。`);
    const start = subtitleTime(timing[1]), end = subtitleTime(timing[2]);
    if (start === null || end === null || end <= start) throw new Error(`第 ${index + 1} 行字幕时间无效，结束时间须晚于开始时间。`);
    const body: string[] = [];
    while (index + 1 < lines.length && lines[index + 1].trim()
      && !/^\s*(?:(?:\d{1,3}):)?\d{2}:\d{2}[.,]\d{3}\s+-->/.test(lines[index + 1])) body.push(lines[++index]);
    const cleaned = body.join('\n').replace(/<[^>]*>/g, '')
      // Decode once: literal "&quot;" exported as "&amp;quot;" must stay literal.
      .replace(/&(amp|lt|gt|nbsp|quot|#39);/g, (_match, entity: string) => ({ amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"', '#39': "'" })[entity]!).trim();
    if (cleaned) result.push({ id: uid(), start, end, text: cleaned });
    if (result.length > 10_000) throw new Error('字幕条目超过 10,000 条，请分段导入。');
  }
  return result.sort((left, right) => left.start - right.start);
}

function markdownEscape(text: string) { return text.replace(/([\\`*_{}\[\]<>#])/g, '\\$1'); }
function stamp(seconds: number) { return timecode(seconds); }

/**
 * A material whose own first line is its card's title (an article's `# 标题`, a TXT title line) would print the
 * title twice under the card heading (CORE-33); that first line is left out.
 */
function withoutRepeatedTitle(body: string, title: string): string {
  const name = title.trim();
  const match = /^\s*(?:#{1,6}[ \t]+)?[　 \t]*([^\n]*?)[ \t#]*(?:\r?\n|$)/.exec(body);
  if (!name || !match || match[1].trim() !== name) return body;
  return body.slice(match[0].length).replace(/^(?:[ \t]*\r?\n)+/, '');
}

/** Plain Markdown with source links and source timecodes retained. */
export function exportMarkdown(board: Board): string {
  const out = [`# ${markdownEscape(board.title)}`, '', board.description, ''];
  const sorted = [...board.nodes].filter(node => node.data.kind !== 'frame').sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  for (const node of sorted) {
    const data = node.data;
    // CORE-33: an excerpt is titled by its sentence (two excerpts of one source no longer share “摘录 · <来源>”).
    out.push(`## ${markdownEscape(data.kind === 'quote' ? quoteDisplayTitle(data) : data.title)}`, '');
    if (data.kind === 'quote') {
      const original = data.citation?.text ?? data.body;
      if (original) out.push(original.split('\n').map(line => `> ${line}`).join('\n'), '');
      if (data.translation?.trim()) out.push(`译文：${data.translation}`, '');
      if (data.citation?.text && data.body && data.body !== original) out.push(`我的理解：${data.body}`, '');
    } else if (data.body) out.push(withoutRepeatedTitle(data.body, data.title), '');
    if (data.kind !== 'quote' && data.translation?.trim()) out.push(`译文：${data.translation}`, '');
    const originalSource = typeof data.sourceUrl === 'string' ? safeUrl(data.sourceUrl) : null;
    const sourceUrl = data.sourceUrl !== undefined ? originalSource : data.url ? safeUrl(data.url) : null;
    if (sourceUrl) out.push(`来源：<${sourceUrl}>`, '');
    if (data.citation) {
      const source = board.nodes.find(item => item.id === data.citation?.nodeId);
      // CORE-14: a text excerpt keeps its “第 N 段” in the export, the same place its tag names.
      const anchor = data.citation.textAnchor;
      const paragraph = data.citation.start === undefined && anchor && source && source.data.kind !== 'video' ? paragraphIndexAt(source.data.body, anchor.from) : undefined;
      const timestamp = data.citation.start === undefined ? paragraph ? ` · 第 ${paragraph} 段` : '' : ` · ${stamp(data.citation.start)}${data.citation.end === undefined ? '' : `–${stamp(data.citation.end)}`}`;
      if (data.kind !== 'quote' && data.citation.text && data.citation.text !== data.body) out.push(data.citation.text.split('\n').map(line => `> ${line}`).join('\n'), '');
      out.push(`引用：${markdownEscape(source?.data.title ?? data.citation.title)}${timestamp}`, '');
    }
    if (data.transcript?.length) out.push('### 字幕', '', ...data.transcript.map(line => {
      const row = `- ${stamp(line.start)}–${stamp(line.end)} ${line.text.replace(/\n/g, ' ')}`;
      return line.translation?.trim() ? `${row}\n  译文：${line.translation.replace(/\n/g, ' ')}` : row;
    }), '');
    if (data.mediaId) out.push('_媒体文件保存在本机，包含在便携画布文件中；Markdown 不携带媒体文件。_', '');
    if (data.demo) out.push('_演示内容_', '');
  }
  return `${out.join('\n').trim()}\n`;
}

type CardMeasurements = Record<string, { width: number; height: number }>;
interface QuoteBatchOptions {
  position?: { x: number; y: number };
  measurements?: CardMeasurements;
  limits: { nodes: number; edges: number };
  /** `translation` (the default) uses a saved Chinese line; `source` keeps the spoken line. */
  script?: TranscriptScript;
}

/**
 * Height of a new excerpt card before React Flow measures it (§6.11: tag row, the sentence at 15px/1.65, padding;
 * the sentence area stops at 278px). New excerpts store no height, so the card follows its content like the examples.
 */
export function estimateQuoteHeight(text: string): number {
  const lines = text.split(/\r\n|\r|\n/).reduce((count, line) => count + Math.max(1, Math.ceil(Array.from(line).length / 16)), 0);
  return Math.min(340, 64 + lines * 26);
}

function cardBounds(node: BoardNode, measurements: CardMeasurements) {
  const measured = measurements[node.id];
  const width = node.style?.width ?? measured?.width ?? (node.data.kind === 'draft' ? 340 : 290);
  const height = node.style?.height ?? measured?.height ?? (node.data.kind === 'video' ? 520 : node.data.kind === 'image' ? 480 : node.data.kind === 'quote' ? 500 : 440);
  return { x: node.position.x, y: node.position.y, width, height };
}

/** One immutable command for a selection, including disjoint runs and all capacity checks. */
export function createQuoteBatch(board: Board, nodeId: string, lines: TranscriptLine[], options: QuoteBatchOptions): { board: Board; quotes: BoardNode[] } {
  const source = board.nodes.find(node => node.id === nodeId);
  if (!source || !lines.length) return { board, quotes: [] };
  const chosen = new Set(lines.map(line => line.id));
  const runs: TranscriptLine[][] = [];
  let previousSelected = false;
  // Read the authoritative current lines, not stale text captured before a correction.
  for (const line of source.data.transcript ?? []) {
    if (chosen.has(line.id)) {
      if (previousSelected) runs.at(-1)!.push(line);
      else runs.push([line]);
      previousSelected = true;
    } else previousSelected = false;
  }
  if (!runs.length) return { board, quotes: [] };
  if (board.nodes.length + runs.length > options.limits.nodes) throw new Error(`摘录后将超过 ${options.limits.nodes} 张卡片，请减少选择或先整理画布。`);
  if (board.edges.length + runs.length > options.limits.edges) throw new Error(`摘录后将超过 ${options.limits.edges} 条连线，请先整理连线。`);
  const measurements = options.measurements ?? {};
  const sourceBox = cardBounds(source, measurements);
  const base = options.position ?? { x: sourceBox.x + sourceBox.width + 70, y: sourceBox.y + 35 };
  const occupied = board.nodes.filter(node => node.data.kind !== 'frame').map(node => cardBounds(node, measurements));
  const quotes: BoardNode[] = [];
  const gap = 28;
  for (const [index, run] of runs.entries()) {
    const text = run.map(line => transcriptSentence(line, options.script ?? 'translation')).join('\n');
    if (text.length > 100_000) throw new Error('单张摘录超过 100,000 字符，请缩小选择范围。');
    const width = 290, height = estimateQuoteHeight(text);
    let point = { ...base };
    // Preserve the first explicit drop coordinate. Other runs and button-created cards avoid all occupied cards.
    if (!options.position || index > 0) {
      if (options.position) point.y = quotes.at(-1)!.position.y + estimateQuoteHeight(quotes.at(-1)!.data.citation?.text ?? '') + gap;
      for (let tries = 0; tries <= occupied.length; tries++) {
        const blockers = occupied.filter(box => point.x < box.x + box.width + gap && point.x + width + gap > box.x && point.y < box.y + box.height + gap && point.y + height + gap > box.y);
        if (!blockers.length) break;
        point.y = Math.max(...blockers.map(box => box.y + box.height + gap));
      }
    }
    const quote = createNode('quote', point);
    quote.style = { width };
    quote.data = { ...quote.data, title: `摘录 · ${stamp(run[0].start)}${run.length > 1 ? `–${stamp(run.at(-1)!.end)}` : ''}`, body: '', citation: { nodeId, title: source.data.title, start: run[0].start, end: run.at(-1)!.end, text, transcriptRevision: transcriptRevision(source.data) }, tags: ['参考摘录'] };
    quotes.push(quote);
    occupied.push({ ...point, width, height });
  }
  return { board: { ...board, nodes: [...board.nodes, ...quotes], edges: [...board.edges, ...quotes.map(quote => ({ id: uid(), source: nodeId, target: quote.id, label: '摘录', type: 'smoothstep' }))] }, quotes };
}
