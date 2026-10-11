import type { WorkspaceSearchHit } from '../workspace-search';

/**
 * Where a command-palette hit sits in the card's body (CORE-05, §6.23 “回车打开命中项并在命中处加 mark、滚动到它”).
 * The search gives the absolute place of a body hit (bodyStart / bodyEnd, DLG-02); a hit without it (older index)
 * is located through its excerpt (cut from the body, “…” at a cut end) and the matched ranges inside that excerpt.
 */
export function searchHitRange(body: string | undefined, hit: Pick<WorkspaceSearchHit, 'field' | 'excerpt' | 'ranges' | 'bodyStart' | 'bodyEnd'>): { start: number; end: number } | undefined {
  if (!body || hit.field !== 'body') return undefined;
  const text = body.replace(/\r\n?/g, '\n');
  if (hit.bodyStart !== undefined && hit.bodyEnd !== undefined && hit.bodyStart >= 0 && hit.bodyEnd > hit.bodyStart && hit.bodyEnd <= text.length) return { start: hit.bodyStart, end: hit.bodyEnd };
  if (!hit.ranges.length) return undefined;
  const lead = hit.excerpt.startsWith('…') ? 1 : 0;
  const candidates = [hit.excerpt.slice(lead), ...(hit.excerpt.endsWith('…') ? [hit.excerpt.slice(lead, -1)] : [])]
    .map(value => value.replace(/\r\n?/g, '\n'));
  for (const core of candidates.reverse()) {
    if (!core) continue;
    const base = text.indexOf(core);
    if (base < 0) continue;
    const [first] = hit.ranges;
    const start = base + first.start - lead, end = base + first.end - lead;
    if (start >= 0 && end <= text.length && end > start) return { start, end };
  }
  return undefined;
}

const SENTENCE_END = /[。！？!?；;\n]/;

/**
 * The sentence around a hit, as text that occurs exactly once in the body, so the reading view can mark it like a
 * located excerpt (resolveTextAnchor). Falls back to a wider window, then to nothing (the card simply opens).
 */
export function searchHitPassage(body: string | undefined, hit: Pick<WorkspaceSearchHit, 'field' | 'excerpt' | 'ranges' | 'bodyStart' | 'bodyEnd'>): string | undefined {
  const range = searchHitRange(body, hit);
  if (!range || !body) return undefined;
  const text = body.replace(/\r\n?/g, '\n');
  const unique = (value: string) => !!value.trim() && text.indexOf(value) === text.lastIndexOf(value);
  let from = range.start, to = range.end;
  while (from > 0 && !SENTENCE_END.test(text[from - 1]) && range.start - from < 80) from--;
  while (to < text.length && !SENTENCE_END.test(text[to - 1] ?? '') && to - range.end < 120) to++;
  while (from < range.start && /\s/.test(text[from])) from++;
  while (to > range.end && /\s/.test(text[to - 1])) to--;
  const sentence = text.slice(from, to);
  if (unique(sentence)) return sentence;
  for (let pad = 20; pad <= 200; pad += 30) {
    const wider = text.slice(Math.max(0, range.start - pad), Math.min(text.length, range.end + pad));
    if (unique(wider)) return wider;
  }
  return undefined;
}
