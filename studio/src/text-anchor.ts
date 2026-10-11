import type { Citation, TextAnchor } from './model';

export const TEXT_ANCHOR_CONTEXT = 64;
export interface TextAnchorMatch { from: number; to: number }
export interface TextAnchorResolution {
  status: 'matched' | 'ambiguous' | 'missing';
  /** Positions in the normalized body, suitable for textarea selectionStart/selectionEnd. */
  matches: TextAnchorMatch[];
  /** A stored range or its nearby context no longer agrees. Legacy quotes have no baseline. */
  changed: boolean;
}

export const normalizeTextBody = (body: string): string => body.replace(/\r\n?/g, '\n');

export function splitsTextCharacter(text: string, offset: number): boolean {
  return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]);
}

/** Capture a small, literal neighborhood without splitting an emoji at the 64-unit boundary. */
export function createTextAnchor(sourceBody: string, from: number, to: number): TextAnchor {
  const body = normalizeTextBody(sourceBody);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > body.length
    || splitsTextCharacter(body, from) || splitsTextCharacter(body, to)) throw new Error('文字选区无效，请重新选择要摘录的文字');
  let prefixFrom = Math.max(0, from - TEXT_ANCHOR_CONTEXT), suffixTo = Math.min(body.length, to + TEXT_ANCHOR_CONTEXT);
  if (splitsTextCharacter(body, prefixFrom)) prefixFrom++;
  if (splitsTextCharacter(body, suffixTo)) suffixTo--;
  return { from, to, prefix: body.slice(prefixFrom, from), suffix: body.slice(to, suffixTo) };
}

function validAnchor(anchor: TextAnchor | undefined, textLength: number): anchor is TextAnchor {
  return !!anchor && Number.isInteger(anchor.from) && Number.isInteger(anchor.to) && anchor.from >= 0
    && anchor.to > anchor.from && anchor.to - anchor.from === textLength
    && typeof anchor.prefix === 'string' && typeof anchor.suffix === 'string'
    && anchor.prefix.length <= TEXT_ANCHOR_CONTEXT && anchor.suffix.length <= TEXT_ANCHOR_CONTEXT
    && normalizeTextBody(anchor.prefix) === anchor.prefix && normalizeTextBody(anchor.suffix) === anchor.suffix;
}

function contextMatches(body: string, match: TextAnchorMatch, anchor: TextAnchor): boolean {
  const before = anchor.prefix === '' ? match.from === 0 : body.slice(Math.max(0, match.from - anchor.prefix.length), match.from) === anchor.prefix;
  const after = anchor.suffix === '' ? match.to === body.length : body.slice(match.to, match.to + anchor.suffix.length) === anchor.suffix;
  return before && after;
}

/** Never replace the snapshot or choose the first occurrence of an ambiguous quotation. */
export function resolveTextAnchor(sourceBody: string, citation: Citation): TextAnchorResolution {
  const body = normalizeTextBody(sourceBody), original = normalizeTextBody(citation.text ?? '');
  const anchor = validAnchor(citation.textAnchor, original.length) ? citation.textAnchor : undefined;
  if (!original) return { status: 'missing', matches: [], changed: !!anchor };
  if (anchor && anchor.to <= body.length && !splitsTextCharacter(body, anchor.from) && !splitsTextCharacter(body, anchor.to)
    && body.slice(anchor.from, anchor.to) === original && contextMatches(body, anchor, anchor)) {
    return { status: 'matched', matches: [{ from: anchor.from, to: anchor.to }], changed: false };
  }
  const matches: TextAnchorMatch[] = [];
  for (let from = body.indexOf(original); from !== -1; from = body.indexOf(original, from + 1)) {
    const to = from + original.length;
    if (!splitsTextCharacter(body, from) && !splitsTextCharacter(body, to)) matches.push({ from, to });
  }
  const contextual = anchor ? matches.filter(match => contextMatches(body, match, anchor)) : [];
  const candidates = contextual.length ? contextual : matches;
  return { status: candidates.length === 1 ? 'matched' : candidates.length > 1 ? 'ambiguous' : 'missing', matches: candidates, changed: !!anchor };
}
