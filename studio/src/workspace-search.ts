import type { CardKind, Workspace } from './model';
import { getSourceUrl } from './media-source';

export type SearchScope = 'workspace' | 'board';
export type SearchField = 'title' | 'body' | 'citation' | 'transcript' | 'originalTranscript' | 'tags' | 'source';
export interface WorkspaceSearchHit {
  boardId: string; boardTitle: string; nodeId: string; kind: CardKind; title: string;
  field: SearchField; excerpt: string; ranges: { start: number; end: number }[]; time?: number;
  /**
   * 正文命中（field 'body'）在 LF 规范化正文里的绝对位置（UTF-16，与 K9-13 的阅读偏移同一口径），
   * 打开后据此定位、加 mark（CORE-05）。摘要里的 ranges 只相对 excerpt。
   */
  bodyStart?: number; bodyEnd?: number;
  /** 同一张卡片的第几处命中（从 0 起；正文按行、逐字稿按句各算一处），与这张卡片一共有几处。只列前 MAX_SPOTS 处。 */
  spot?: number; spots?: number;
}

/** 一张卡片在“原文位置”里最多列出几处命中，多出的写成“还有 N 处”（DLG-02）。 */
export const MAX_SPOTS = 3;

interface SearchText {
  field: SearchField; text: string; folded: string; starts: Uint32Array; ends: Uint32Array;
  boundaries: readonly number[]; time?: number;
}
interface SearchCard {
  boardId: string; boardTitle: string; nodeId: string; kind: CardKind; title: string;
  order: number; texts: readonly SearchText[];
}
export type WorkspaceSearchIndex = { readonly cards: readonly SearchCard[] };
interface SearchMatch { card: SearchCard; text: SearchText; terms: number; matched: readonly string[] }

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const priorities: Record<SearchField, number> = { title: 7, body: 6, citation: 5, transcript: 4, originalTranscript: 3, tags: 2, source: 1 };
const excerptLength = 160;

function compareMatches(a: Pick<SearchMatch, 'text' | 'terms'>, b: Pick<SearchMatch, 'text' | 'terms'>): number {
  return Number(b.text.field === 'title') - Number(a.text.field === 'title') || b.terms - a.terms || priorities[b.text.field] - priorities[a.text.field];
}

// Query and indexed text use the same Unicode compatibility and case rules.
function fold(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function snapshotText(field: SearchField, text: string | undefined, time?: number): SearchText | undefined {
  if (!text?.trim()) return undefined;
  let normalizedText = '';
  const starts: number[] = [], ends: number[] = [], boundaries = [0];
  for (const { segment, index } of graphemes.segment(text)) {
    const normalized = segment.normalize('NFKC');
    normalizedText += normalized;
    for (let offset = 0; offset < normalized.length; offset++) {
      starts.push(index); ends.push(index + segment.length);
    }
    boundaries.push(index + segment.length);
  }
  // Compatibility characters can become a new shared grapheme (ㄱ + ㅏ
  // becomes Hangul 가). Compose that second-stage grapheme before lowercase.
  let composedText = '';
  const composedStarts: number[] = [], composedEnds: number[] = [];
  for (const { segment, index } of graphemes.segment(normalizedText)) {
    const composed = segment.normalize('NFC');
    composedText += composed;
    for (let offset = 0; offset < composed.length; offset++) {
      composedStarts.push(starts[index]); composedEnds.push(ends[index + segment.length - 1]);
    }
  }
  // Lowercase the whole string because Greek final sigma depends on context.
  // Default Unicode lowercase expansions (e.g. İ -> i + dot) retain the same
  // original grapheme; contextual sigma changes content, never its length.
  const loweredStarts: number[] = [], loweredEnds: number[] = [];
  let normalizedOffset = 0;
  for (const character of composedText) {
    for (let offset = 0; offset < character.toLowerCase().length; offset++) {
      loweredStarts.push(composedStarts[normalizedOffset]); loweredEnds.push(composedEnds[normalizedOffset + character.length - 1]);
    }
    normalizedOffset += character.length;
  }
  return Object.freeze({ field, text, folded: composedText.toLowerCase(), starts: Uint32Array.from(loweredStarts), ends: Uint32Array.from(loweredEnds), boundaries: Object.freeze(boundaries), ...(Number.isFinite(time) ? { time } : {}) });
}

/** Capture searchable text only; subsequent workspace edits never change this index. */
export function createWorkspaceSearchIndex(workspace: Workspace): WorkspaceSearchIndex {
  const cards: SearchCard[] = [];
  for (const board of workspace.boards) {
    for (const node of board.nodes) {
      const texts: SearchText[] = [];
      const add = (field: SearchField, value: string | undefined, time?: number) => {
        const text = snapshotText(field, value, time);
        if (text) texts.push(text);
      };
      add('title', node.data.title);
      // 正文按 LF 规范化后建索引，命中位置与阅读正文（K9-13）同一口径。
      add('body', node.data.body?.replace(/\r\n?/g, '\n'));
      add('citation', node.data.citation?.text);
      add('citation', node.data.citation?.title);
      for (const line of node.data.transcript ?? []) {
        add('transcript', line.text, line.start);
        add('transcript', line.translation, line.start);
        add('originalTranscript', line.originalText, line.start);
      }
      add('tags', node.data.tags?.join(' · '));
      const source = node.data.sourceUrl === '' ? '' : getSourceUrl(node.data);
      if (/^https?:\/\//i.test(source)) add('source', source);
      cards.push(Object.freeze({ boardId: board.id, boardTitle: board.title, nodeId: node.id, kind: node.data.kind, title: node.data.title, order: cards.length, texts: Object.freeze(texts) }));
    }
  }
  return Object.freeze({ cards: Object.freeze(cards) });
}

function boundaryAtOrBefore(boundaries: ArrayLike<number>, position: number): number {
  let low = 0, high = boundaries.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (boundaries[middle] <= position) low = middle;
    else high = middle - 1;
  }
  return boundaries[low];
}

function boundaryAtOrAfter(boundaries: ArrayLike<number>, position: number): number {
  let low = 0, high = boundaries.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (boundaries[middle] < position) low = middle + 1;
    else high = middle;
  }
  return boundaries[low];
}

function lowerBound(values: ArrayLike<number>, position: number): number {
  let low = 0, high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** 最早出现的那个词：摘要以它为锚。 */
function anchorOf(text: SearchText, tokens: readonly string[]): { token: string; position: number } {
  const matches = tokens.map(token => ({ token, position: text.folded.indexOf(token) })).filter(match => match.position >= 0);
  return matches.reduce((earliest, match) => match.position < earliest.position ? match : earliest);
}

/**
 * 摘要窗口：围绕锚点取约 160 字。正文（body）截在命中所在的那一行（段）之内，不把标题、署名、下一段拼进来（DLG-02）；
 * 截断处加“…”，没有截断的段首、段尾不加。
 */
function excerpt(text: SearchText, tokens: readonly string[], at?: { token: string; position: number }): Pick<WorkspaceSearchHit, 'excerpt' | 'ranges' | 'bodyStart' | 'bodyEnd'> {
  const anchor = at ?? anchorOf(text, tokens);
  const matchStart = text.starts[anchor.position], matchEnd = text.ends[anchor.position + anchor.token.length - 1];
  const body = text.field === 'body';
  const lineStart = body ? text.text.lastIndexOf('\n', Math.max(0, matchStart - 1)) + 1 : 0;
  const lineBreak = body ? text.text.indexOf('\n', matchEnd) : -1;
  const lineEnd = lineBreak < 0 ? text.text.length : lineBreak;
  let start = Math.max(lineStart, matchStart - Math.floor(excerptLength / 3));
  let end = Math.min(lineEnd, Math.max(start + excerptLength, matchEnd));
  // 命中靠近段尾时，正文摘要不再往前补字：面板只显示两行，补出来的上文会把命中挤出可见范围。
  if (!body) start = Math.max(lineStart, Math.min(start, end - excerptLength));
  start = boundaryAtOrBefore(text.boundaries, start);
  end = boundaryAtOrAfter(text.boundaries, end);
  const leading = start > lineStart ? '…' : '', trailing = end < lineEnd ? '…' : '';
  const ranges: { start: number; end: number }[] = [];
  // Scan only the visible normalized window, keeping large transcripts and
  // common one-character queries from producing unbounded highlight arrays.
  const foldedStart = lowerBound(text.starts, start);
  let foldedEnd = foldedStart;
  while (foldedEnd < text.ends.length && text.ends[foldedEnd] <= end) foldedEnd++;
  const visible = text.folded.slice(foldedStart, foldedEnd);
  for (const token of tokens) {
    let position = visible.indexOf(token);
    while (position >= 0) {
      const originalStart = text.starts[foldedStart + position];
      const originalEnd = text.ends[foldedStart + position + token.length - 1];
      ranges.push({ start: originalStart - start + leading.length, end: originalEnd - start + leading.length });
      position = visible.indexOf(token, position + 1);
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return { excerpt: leading + text.text.slice(start, end) + trailing, ranges: merged, ...(body ? { bodyStart: matchStart, bodyEnd: matchEnd } : {}) };
}

type Spot = { text: SearchText; at?: { token: string; position: number } };
const REFERENCE_LINE = /^\s*(?:\[来源[:：][^\]\n]*\]\(field:\/\/[^)\s]*\)\s*)+$/;

/**
 * 同一张卡片里的各处命中（DLG-02）：正文里锚词出现的每一行算一处；逐字稿里含全部已命中词的每一句算一处
 * （按时间先后）。其他字段只有一处。返回一共几处与前 MAX_SPOTS 处。
 */
function spotsOf(card: SearchCard, text: SearchText, matched: readonly string[]): { total: number; spots: Spot[] } {
  if (text.field === 'body') {
    const anchor = anchorOf(text, matched);
    const spots: Spot[] = [];
    let total = 0, lastLine = -1;
    for (let position = anchor.position; position >= 0; position = text.folded.indexOf(anchor.token, position + 1)) {
      const original = text.starts[position];
      const line = text.text.lastIndexOf('\n', Math.max(0, original - 1)) + 1;
      if (line === lastLine) continue;
      lastLine = line;
      // 文稿里只有引用指针的行（“[来源：标题](field://…)”）不算一处：摘要清理后那一行什么也不剩。
      const lineBreak = text.text.indexOf('\n', original);
      if (REFERENCE_LINE.test(text.text.slice(line, lineBreak < 0 ? undefined : lineBreak))) continue;
      total++;
      if (spots.length < MAX_SPOTS) spots.push({ text, at: { token: anchor.token, position } });
    }
    if (total) return { total, spots };
  }
  if (text.field === 'transcript' || text.field === 'originalTranscript') {
    const lines = card.texts.filter(other => other.field === text.field && matched.every(token => other.folded.includes(token)))
      .sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    if (lines.length > 1) return { total: lines.length, spots: lines.slice(0, MAX_SPOTS).map(line => ({ text: line })) };
  }
  return { total: 1, spots: [{ text }] };
}

/** Plain whitespace separates AND terms, which may occur in different fields. */
export function searchWorkspace(index: WorkspaceSearchIndex, query: string, options: { scope: SearchScope; boardId: string; limit?: number }): { hits: WorkspaceSearchHit[]; total: number; query: string } {
  const displayQuery = query.trim().replace(/\s+/gu, ' ');
  if (!displayQuery) return { hits: [], total: 0, query: '' };
  const tokens = [...new Set(fold(displayQuery).split(/\s+/gu).filter(Boolean))];
  if (!tokens.length) return { hits: [], total: 0, query: displayQuery };
  const matches: SearchMatch[] = [];
  for (const card of index.cards) {
    if (options.scope === 'board' && card.boardId !== options.boardId) continue;
    const found = new Set<string>();
    let best: Pick<SearchMatch, 'text' | 'terms' | 'matched'> | undefined;
    for (const text of card.texts) {
      const terms = tokens.filter(token => text.folded.includes(token));
      for (const token of terms) found.add(token);
      if (!terms.length) continue;
      const match = { text, terms: terms.length, matched: terms };
      if (!best || compareMatches(match, best) < 0) best = match;
    }
    if (found.size === tokens.length && best) matches.push({ card, ...best });
  }
  matches.sort((a, b) => compareMatches(a, b) || Number(b.card.boardId === options.boardId) - Number(a.card.boardId === options.boardId) || a.card.order - b.card.order);
  const limit = options.limit === undefined || !Number.isFinite(options.limit) ? 80 : Math.max(0, Math.floor(options.limit));
  // 一张卡片可以在“原文位置”里列出几处（每处一条），limit 按条数算；total 仍是命中的卡片数。
  const hits: WorkspaceSearchHit[] = [];
  for (const { card, text, matched } of matches) {
    if (hits.length >= limit) break;
    const { total, spots } = spotsOf(card, text, matched);
    for (const [index, spot] of spots.entries()) {
      if (hits.length >= limit) break;
      hits.push({
        boardId: card.boardId, boardTitle: card.boardTitle, nodeId: card.nodeId, kind: card.kind, title: card.title, field: spot.text.field,
        ...excerpt(spot.text, spot.text === text ? tokens : matched, spot.at), ...(spot.text.time === undefined ? {} : { time: spot.text.time }),
        ...(total > 1 ? { spot: index, spots: total } : {}),
      });
    }
  }
  return { hits, total: matches.length, query: displayQuery };
}
