import type { ReactNode } from 'react';
import { wordPieces } from '../cards/Words';

/**
 * Where a transcript sentence may break (§3.4 折行, QA round 3 P5). The row uses `word-break: keep-all`, so without
 * help a line can only end at punctuation or a space: a long clause after “、” jumps whole to the next line and leaves
 * a short first line (“脑海中的转场、”), and a clause longer than the line is cut inside a word (“教程文 / 档”).
 *
 * The answer is a list of runs that must not break inside; the row puts a `<wbr>` between runs (the DOM text stays
 * the sentence, letter for letter). Two layouts are compared on an estimate of the line length in em:
 * - by clause: each clause (up to its punctuation or space) is one run, so lines end at the speaker's pauses
 *   (“一张照片，一段现成的视频，/ 就能把你一秒丢进影视级的名场面里。”). Kept only when it costs no extra line and no line
 *   before the last is a stray fragment (SHORT_LINE); a clause longer than a line is still split into words.
 * - by word (Intl.Segmenter, punctuation attached as in `Words`): every word is a run, so a line fills to the edge and
 *   ends between two words.
 * Returns null when there is nothing to decide (no Chinese, one word, no segmenter, or the line length is unknown):
 * the row then keeps the browser's own breaking.
 */
export function transcriptRuns(text: string, capacity: number): string[] | null {
  if (!(capacity > 0)) return null;
  const pieces = wordPieces(text);
  if (!pieces) return null;
  const words = joinSingles(pieces);
  if (words.length < 2) return null;
  const clauses: string[][] = [];
  let open: string[] = [];
  for (const word of words) {
    open.push(word);
    if (CLAUSE_END.test(word)) { clauses.push(open); open = []; }
  }
  if (open.length) clauses.push(open);
  // A clause that cannot sit on a line by itself breaks between its words in either layout. Latin widths are only
  // estimated, so a clause with Latin letters gets a margin.
  const fitsAlone = (clause: string) => width(clause.trimEnd()) * (/[A-Za-z0-9]/.test(clause) ? 1.08 : 1) <= capacity - 0.25;
  const clauseRuns = clauses.flatMap(clause => fitsAlone(clause.join('')) ? [clause.join('')] : clause);
  const byClause = layout(clauseRuns, capacity);
  const byWord = layout(words, capacity);
  const even = byClause.lines.length <= byWord.lines.length && byClause.lines.slice(0, -1).every(line => line >= capacity * SHORT_LINE);
  return even ? clauseRuns : words;
}

/**
 * A line before the last that is shorter than this share of the line length reads as a stray fragment (“打到招式、”,
 * 5 of 22 em; “脑海中的转场、”, 7 of 22): then the sentence breaks between words. “今天一条视频教会你，” (10 of 22)
 * still ends its line at the pause.
 */
const SHORT_LINE = 0.36;

/** A word that ends a clause: closing punctuation (possibly followed by quotes or brackets), or a trailing space. */
const CLAUSE_END = /(?:[，。、；：？！,.;:?!…—]+[”’」』）》〉)\]]*|\s)$/u;
const SINGLE_HAN = /^[㐀-鿿][，。、；：？！,.;:?!…—”’」』）》〉)\]%·\s]*$/u;

/**
 * The segmenter's dictionary splits words it does not know into single characters (“教程|文|档”, “运|镜”, “一|比|一”),
 * which would let a line end inside them (“文 / 档”). Neighbouring single characters stay together, up to six, until
 * one of them ends a clause.
 */
function joinSingles(pieces: string[]): string[] {
  const out: string[] = [];
  let run = 0;
  for (const piece of pieces) {
    const single = SINGLE_HAN.test(piece);
    const last = out.length - 1;
    if (single && run > 0 && run < 6 && !CLAUSE_END.test(out[last])) { out[last] += piece; run++; continue; }
    out.push(piece);
    run = single ? 1 : 0;
  }
  return out;
}

/** Noto Sans SC Variable 400 advances in em, measured from the bundled Latin subset (W3-G browser evidence).
 * Keep the existing clause/word decision; narrow i/l and wide M/W/m must not share the old Inter estimate.
 * Canvas planning for cards remains in text-measure.ts; this transcript-only estimate has no layout reads.
 */
const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ADVANCES = [
  .608,.657,.638,.688,.589,.552,.689,.728,.293,.535,.646,.543,.812,.723,.742,.633,.742,.635,.596,.599,.721,.575,.878,.573,.531,.603,
  .563,.618,.510,.620,.554,.325,.564,.607,.275,.275,.552,.284,.926,.610,.606,.620,.620,.388,.468,.377,.607,.521,.802,.498,.521,.475,
  .555,.555,.555,.555,.555,.555,.555,.555,.555,.555,
];
const LATIN_ADVANCE = new Map([...LATIN].map((char, index) => [char, ADVANCES[index]]));
const PUNCT_ADVANCE: Record<string, number> = { '.': .278, ',': .278, ';': .278, ':': .278, '!': .323, '?': .474, '-': .347, '_': .559, '(': .338, ')': .338, '[': .338, ']': .338, '/': .392 };
function width(text: string): number {
  let total = 0;
  for (const char of text) {
    if (/\s/.test(char)) total += .224;
    else if (LATIN_ADVANCE.has(char)) total += LATIN_ADVANCE.get(char)!;
    else if (PUNCT_ADVANCE[char] !== undefined) total += PUNCT_ADVANCE[char];
    else if (char.charCodeAt(0) < 0x2e80 && !/[—“”‘’…]/.test(char)) total += .56;
    else total += 1;
  }
  // Match normal text-autospace at adjacent CJK / Western boundaries; no inserted text.
  total += [...text.matchAll(/(?:[㐀-鿿](?=[A-Za-z0-9])|[A-Za-z0-9](?=[㐀-鿿]))/gu)].length / 8;
  return total;
}

/** Greedy line filling, the way the browser lays out unbreakable runs: the width of every line in em. */
function layout(runs: string[], capacity: number): { lines: number[] } {
  const lines: number[] = [];
  let line = 0;
  for (const run of runs) {
    const size = width(run);
    // A trailing space hangs past the line end, as in the browser.
    const fit = width(run.trimEnd());
    if (line > 0 && line + fit > capacity) { lines.push(line); line = 0; }
    line += size;
  }
  lines.push(line);
  return { lines };
}

/** Character offsets (between 1 and text.length − 1) where a `<wbr>` goes. */
export function runBreaks(runs: string[] | null): number[] {
  if (!runs || runs.length < 2) return [];
  const breaks: number[] = [];
  let at = 0;
  for (let index = 0; index < runs.length - 1; index++) { at += runs[index].length; breaks.push(at); }
  return breaks;
}

/**
 * The sentence with its search hits marked and a `<wbr>` at each break point (transcript-wrap.ts). The text nodes
 * still spell the sentence exactly, so copying, search and accessible names are unchanged.
 */
export function sentenceNodes(text: string, needle: string, breaks: number[]): ReactNode {
  if (!needle && !breaks.length) return text;
  const hits: [number, number][] = [];
  if (needle) {
    const lower = text.toLocaleLowerCase();
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) hits.push([at, at + needle.length]);
  }
  const parts: ReactNode[] = [];
  /** Text from..to with a <wbr> before every break point inside it. */
  const run = (from: number, to: number) => {
    const out: ReactNode[] = [];
    let cursor = from;
    for (const at of breaks) {
      if (at <= from || at >= to) continue;
      out.push(text.slice(cursor, at), <wbr key={`b${at}`} />);
      cursor = at;
    }
    out.push(text.slice(cursor, to));
    return out.filter(part => part !== '');
  };
  let cursor = 0;
  for (const [from, to] of hits) {
    if (from > cursor) parts.push(...run(cursor, from));
    // A break exactly at either end of a hit sits outside the mark, so the mark's padding stays with its word.
    if (from > cursor && breaks.includes(from)) parts.push(<wbr key={`b${from}`} />);
    parts.push(<mark key={`h${from}`} className="watch-hit">{run(from, to)}</mark>);
    if (to < text.length && breaks.includes(to)) parts.push(<wbr key={`b${to}`} />);
    cursor = to;
  }
  if (cursor < text.length) parts.push(...run(cursor, text.length));
  return parts;
}
