import type { BoardNode } from './model';
import { timecode } from './model';

export interface SourceLink { sourceNodeId: string; quoteNodeId?: string; time?: number }
/** Text offsets use the same UTF-16 units as textarea.selectionStart/selectionEnd. */
export interface DraftReference extends SourceLink { id: string; label: string; from: number; to: number }
interface LocatedReference extends DraftReference {
  hrefFrom: number; hrefTo: number; identifierFrom: number; identifierTo: number;
  quoteIdentifierFrom?: number; quoteIdentifierTo?: number;
}

const SOURCE_PREFIX = 'field://node/';
const MAX_TIME = 604_800;
const encodedId = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const validId = (value: string) => !!value.trim() && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)
  && !Array.from(value).some(character => character.length === 1 && /[\uD800-\uDFFF]/.test(character));

/** Accept the existing internal URI contract; invalid user text is simply not a link. */
export function parseSourceLink(href: string): SourceLink | null {
  // Two encoded 160-unit Unicode IDs can exceed the former single-ID URI limit.
  if (typeof href !== 'string' || href.length > 4096) return null;
  const match = /^field:\/\/node\/([^/?#\s]+)(?:\?([^#\s]+))?$/i.exec(href);
  if (!match) return null;
  try {
    const sourceNodeId = decodeURIComponent(match[1]);
    if (!validId(sourceNodeId)) return null;
    const target: SourceLink = { sourceNodeId };
    if (match[2] === undefined) return target;
    const seen = new Set<string>();
    for (const parameter of match[2].split('&')) {
      const entry = /^(quote|t)=([^&]+)$/.exec(parameter);
      if (!entry || seen.has(entry[1])) return null;
      seen.add(entry[1]);
      const value = decodeURIComponent(entry[2]);
      if (entry[1] === 'quote') {
        if (!validId(value)) return null;
        target.quoteNodeId = value;
      } else {
        if (!/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return null;
        const time = Number(value);
        if (!Number.isFinite(time) || time < 0 || time > MAX_TIME) return null;
        target.time = time;
      }
    }
    return target;
  } catch { return null; }
}

export function formatSourceLink(sourceNodeId: string, time?: number, quoteNodeId?: string): string {
  if (typeof sourceNodeId !== 'string' || !validId(sourceNodeId)
    || (quoteNodeId !== undefined && (typeof quoteNodeId !== 'string' || !validId(quoteNodeId)))
    || (time !== undefined && (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > MAX_TIME))) {
    throw new Error('引用来源或时间无效');
  }
  const parameters = [...(quoteNodeId === undefined ? [] : [`quote=${encodedId(quoteNodeId)}`]), ...(time === undefined ? [] : [`t=${time}`])];
  const href = `${SOURCE_PREFIX}${encodedId(sourceNodeId)}${parameters.length ? `?${parameters.join('&')}` : ''}`;
  if (!parseSourceLink(href)) throw new Error('引用来源或时间无效');
  return href;
}

/**
 * The source line of an excerpt, `[来源：标题 00:12](field://node/…?quote=…&t=12)`: the last paragraph of
 * formatDraftQuote, and on its own the picture “配给这一行” folds into a script line (§6.29).
 */
export function formatDraftSourceLine(quote: BoardNode): string {
  const citation = quote.data.citation;
  const title = (citation?.title || quote.data.title).replace(/[\r\n\t]+/g, ' ').replace(/([\\[\]()`])/g, '\\$1');
  const suffix = citation?.start === undefined ? '' : ` ${timecode(citation.start)}`;
  const href = formatSourceLink(citation?.nodeId || quote.id, citation?.start, citation ? quote.id : undefined);
  return `[来源：${title}${suffix}](${href})`;
}

/** Keep the captured quotation verbatim; only the Markdown label needs escaping. */
export function formatDraftQuote(quote: BoardNode): string {
  const citation = quote.data.citation;
  const original = citation?.text ?? quote.data.body;
  const source = formatDraftSourceLine(quote);
  return `\n\n> ${original.replace(/\r\n|\r|\n/g, newline => `${newline}> `)}\n\n${source}\n\n`;
}

function escaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let previous = index - 1; previous >= 0 && text[previous] === '\\'; previous--) backslashes++;
  return backslashes % 2 === 1;
}

/** Mask code without altering text offsets. This is deliberately not a full Markdown parser. */
function codeMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  let fence: { character: string; length: number } | undefined;
  let lineStart = 0;
  while (lineStart < text.length) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline < 0 ? text.length : newline + 1;
    const line = text.slice(lineStart, lineEnd).replace(/[\r\n]+$/, '');
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      mask.fill(1, lineStart, lineEnd);
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
    } else if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      fence = { character: marker[1][0], length: marker[1].length };
      mask.fill(1, lineStart, lineEnd);
    }
    lineStart = lineEnd;
  }
  const runs: { from: number; to: number; next?: number }[] = [];
  const ticks = /`+/g;
  for (let match = ticks.exec(text); match; match = ticks.exec(text)) {
    if (!mask[match.index] && !escaped(text, match.index)) runs.push({ from: match.index, to: match.index + match[0].length });
  }
  const nextByLength = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index--) {
    const length = runs[index].to - runs[index].from;
    runs[index].next = nextByLength.get(length); nextByLength.set(length, index);
  }
  for (let index = 0; index < runs.length; index++) {
    const closing = runs[index].next;
    if (closing !== undefined) { mask.fill(1, runs[index].from, runs[closing].to); index = closing; }
  }
  return mask;
}

interface MarkdownLink { to: number; label: string; hrefFrom?: number; hrefTo?: number }
function markdownLink(text: string, from: number, mask: Uint8Array): MarkdownLink {
  let cursor = from + 1;
  while (cursor < text.length && text[cursor] !== '\n' && text[cursor] !== '\r') {
    if (text[cursor] === '\\') { cursor += 2; continue; }
    // Nested labels/reference-style Markdown are not generated by this editor.
    if (text[cursor] === '[' || mask[cursor]) return { to: cursor, label: '' };
    if (text[cursor] === ']') break;
    cursor++;
  }
  if (text[cursor] !== ']') return { to: Math.max(from + 1, cursor), label: '' };
  const label = text.slice(from + 1, cursor).replace(/\\([\\[\]()`])/g, '$1');
  cursor++;
  while (text[cursor] === ' ' || text[cursor] === '\t') cursor++;
  if (text[cursor] !== '(') return { to: cursor, label };
  cursor++;
  while (text[cursor] === ' ' || text[cursor] === '\t') cursor++;
  const angle = text[cursor] === '<';
  if (angle) cursor++;
  const hrefFrom = cursor;
  let parentheses = 0;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character === '\n' || character === '\r' || character === '[' || mask[cursor]) return { to: cursor, label };
    if (angle ? character === '>' : character === ')' && parentheses === 0) break;
    if (character === '(') parentheses++;
    else if (character === ')') parentheses--;
    if (/\s/.test(character)) break;
    cursor++;
  }
  const hrefTo = cursor;
  if (angle) { if (text[cursor] !== '>') return { to: cursor, label }; cursor++; }
  while (text[cursor] === ' ' || text[cursor] === '\t') cursor++;
  // Optional inline link titles are not part of the source target.
  if (text[cursor] === '"' || text[cursor] === "'") {
    const quote = text[cursor++];
    while (cursor < text.length && text[cursor] !== '\n' && text[cursor] !== '\r' && text[cursor] !== quote) cursor += text[cursor] === '\\' ? 2 : 1;
    if (text[cursor] !== quote) return { to: cursor, label };
    cursor++;
    while (text[cursor] === ' ' || text[cursor] === '\t') cursor++;
  }
  return text[cursor] === ')' ? { to: cursor + 1, label, hrefFrom, hrefTo } : { to: Math.max(from + 1, cursor), label };
}

function locateDraftReferences(body: string): LocatedReference[] {
  const mask = codeMask(body), references: LocatedReference[] = [];
  const add = (from: number, to: number, hrefFrom: number, hrefTo: number, label: string) => {
    const href = body.slice(hrefFrom, hrefTo), target = parseSourceLink(href);
    if (!target) return;
    const identifierFrom = hrefFrom + SOURCE_PREFIX.length;
    const query = href.indexOf('?');
    const quoteParameter = target.quoteNodeId === undefined ? undefined : /[?&]quote=([^&]+)/.exec(href);
    const quoteIdentifierFrom = quoteParameter ? hrefFrom + quoteParameter.index + 'quote='.length + 1 : undefined;
    references.push({ ...target, id: `reference-${from}-${to}`, label: label || href, from, to, hrefFrom, hrefTo, identifierFrom, identifierTo: query < 0 ? hrefTo : hrefFrom + query,
      ...(quoteIdentifierFrom === undefined ? {} : { quoteIdentifierFrom, quoteIdentifierTo: quoteIdentifierFrom + quoteParameter![1].length }) });
  };
  for (let cursor = 0; cursor < body.length;) {
    if (mask[cursor]) { cursor++; continue; }
    if (body[cursor] === '[' && !escaped(body, cursor)) {
      const link = markdownLink(body, cursor, mask);
      const image = cursor > 0 && body[cursor - 1] === '!' && !escaped(body, cursor - 1);
      if (!image && link.hrefFrom !== undefined && link.hrefTo !== undefined) add(cursor, link.to, link.hrefFrom, link.hrefTo, link.label);
      cursor = Math.max(cursor + 1, link.to); continue;
    }
    if (body.slice(cursor, cursor + SOURCE_PREFIX.length).toLowerCase() === SOURCE_PREFIX && !escaped(body, cursor)
      && (cursor === 0 || !/[A-Za-z0-9_%/:\\]/.test(body[cursor - 1]))) {
      let end = cursor + SOURCE_PREFIX.length, parentheses = 0;
      while (end < body.length && !mask[end] && !/[\s<>"'`\\\[\]{}，。；：！？、【】（）]/.test(body[end])) {
        if (body[end] === '(') parentheses++;
        else if (body[end] === ')') { if (parentheses === 0) break; parentheses--; }
        end++;
      }
      let hrefTo = end;
      while (hrefTo > cursor && /[.,;:!]/.test(body[hrefTo - 1])) hrefTo--;
      const angle = cursor > 0 && body[cursor - 1] === '<' && body[end] === '>';
      add(angle ? cursor - 1 : cursor, angle ? end + 1 : hrefTo, cursor, hrefTo, '');
      cursor = end; continue;
    }
    cursor++;
  }
  return references;
}

/** Inline Markdown and bare source URLs, in occurrence order, including duplicates. */
export function parseDraftReferences(body: string): DraftReference[] {
  return locateDraftReferences(body).map(({ id, sourceNodeId, quoteNodeId, time, label, from, to }) => ({ id, sourceNodeId, ...(quoteNodeId === undefined ? {} : { quoteNodeId }), ...(time === undefined ? {} : { time }), label, from, to }));
}

/** Remap each surviving source and quote independently, preserving prose, labels and literal times. */
export function remapDraftSourceLinks(body: string, nodeIds: ReadonlyMap<string, string>): string {
  const references = locateDraftReferences(body);
  let previous = 0;
  const parts: string[] = [];
  for (const reference of references) {
    const replacements = [{ id: reference.sourceNodeId, from: reference.identifierFrom, to: reference.identifierTo },
      ...(reference.quoteNodeId !== undefined && reference.quoteIdentifierFrom !== undefined && reference.quoteIdentifierTo !== undefined
        ? [{ id: reference.quoteNodeId, from: reference.quoteIdentifierFrom, to: reference.quoteIdentifierTo }] : [])];
    for (const identifier of replacements) {
      const replacement = nodeIds.get(identifier.id);
      if (replacement === undefined) continue;
      // Import mappings are IDs, not arbitrary URI pieces. Reject malformed mappings before rewriting.
      formatSourceLink(replacement);
      parts.push(body.slice(previous, identifier.from), encodedId(replacement));
      previous = identifier.to;
    }
  }
  parts.push(body.slice(previous));
  return parts.join('');
}
