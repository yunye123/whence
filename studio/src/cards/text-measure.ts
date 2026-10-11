/** Canvas-only text planning. No element geometry, layout reads or card-lifecycle cache clearing. */
export type TextMode = 'word' | 'sentence' | 'char';
export interface TextOptions {
  font: string;
  width: number;
  mode?: TextMode;
  /** Protect this many visible characters at the paragraph tail (Words' legacy `keep`). */
  minRun?: number;
  /** CSS px, independent of font shorthand. */
  letterSpacing?: number;
  wordSpacing?: number;
  /** CSS white-space. Default matches preserved source excerpts/notes. */
  whiteSpace?: 'normal' | 'pre-wrap' | 'pre-line' | 'pre' | 'break-spaces';
  tabSize?: number;
  /** Match normal CSS text-autospace; callers rendering with `no-autospace` can opt out. */
  autospace?: boolean;
}
export interface TextLine { from: number; to: number; text: string }
export interface TextRun { from: number; to: number; text: string }

const CACHE_LIMIT = 1200;
const RUN_CACHE_LIMIT = 800;
const runsCache = new Map<string, readonly TextRun[]>();
const linesCache = new Map<string, readonly TextLine[]>();
type Segmenter = { segment(input: string): Iterable<{ segment: string; index: number }> };
type SegmenterCtor = new (locale: string, options: { granularity: 'word' | 'grapheme' | 'sentence' }) => Segmenter;
const tools = new Map<string, Segmenter | null>();
const CLOSING = /^[\s，。、；：？！,.;:?!）」』】》〉”’…—)\]}%·]+$/u;
const OPENING = /[（「『【《〈“‘([{]$/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function tool(granularity: 'word' | 'grapheme' | 'sentence') {
  if (!tools.has(granularity)) {
    const Ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
    tools.set(granularity, Ctor ? new Ctor('zh-CN', { granularity }) : null);
  }
  return tools.get(granularity)!;
}
function remember<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): V {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value!);
  return value;
}
function cached<K, V>(cache: Map<K, V>, key: K): V | undefined {
  const hit = cache.get(key);
  if (hit !== undefined) { cache.delete(key); cache.set(key, hit); }
  return hit;
}
const visible = (text: string) => Array.from(text.replace(/\s/gu, '')).length;

/** UTF-16 offsets always refer to the supplied original text, including CRLF and surrogate pairs. */
export function segmentText(text: string, mode: TextMode = 'word'): readonly TextRun[] {
  const key = JSON.stringify([text, mode]);
  const hit = cached(runsCache, key);
  if (hit) return hit;
  const granularity = mode === 'char' ? 'grapheme' : mode;
  const segmenter = tool(granularity);
  const raw = segmenter ? [...segmenter.segment(text)].map(({ segment }) => segment) : Array.from(text);
  const pieces: string[] = [];
  for (const part of raw) {
    // Hard line breaks retain their own run. Never protect across a paragraph boundary.
    for (const piece of part.split(/(\r\n|[\r\n])/u).filter(Boolean)) {
      if (/^[\r\n]+$/u.test(piece)) { pieces.push(piece); continue; }
      const last = pieces.length - 1;
      if (last >= 0 && !/[\r\n]/u.test(pieces[last]) && (CLOSING.test(piece) || OPENING.test(pieces[last]))) {
        pieces[last] += piece;
      } else if (mode === 'word' && CJK.test(piece) && visible(piece) > 8) {
        // A pathological >8-character dictionary item may wrap; normal short words stay intact.
        pieces.push(...Array.from(piece));
      } else pieces.push(piece);
    }
  }
  let offset = 0;
  return remember(runsCache, key, Object.freeze(pieces.map(piece => {
    const from = offset; offset += piece.length;
    return Object.freeze({ from, to: offset, text: piece });
  })), RUN_CACHE_LIMIT);
}

type MeasureContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
let context: MeasureContext | null | undefined;
function canvasContext(): MeasureContext | null {
  if (context !== undefined) return context;
  // Font arrival changes measured widths; retain card-remount caches but invalidate stale font plans.
  if (typeof document !== 'undefined') document.fonts?.addEventListener('loadingdone', clearTextMeasureCache);
  context = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d')
    : typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  return context;
}
/** The result is explicitly unavailable in SSR, rather than caching an invented font width. */
export function canMeasureText(): boolean { return !!canvasContext(); }
export function clearTextMeasureCache(): void { linesCache.clear(); }
export function textMeasureCacheInfo() {
  return { lines: linesCache.size, runs: runsCache.size, limit: CACHE_LIMIT, runLimit: RUN_CACHE_LIMIT };
}

/** Browser widths resolve to 1/64 CSS-px; keep that precision instead of pooling visibly different widths. */
export const textWidthBucket = (width: number): number => Math.max(1 / 64, Math.round(width * 64) / 64);

function widthReader(font: string, autospace: boolean, options: Partial<TextOptions> = {}): (text: string) => number {
  const ctx = canvasContext();
  if (!ctx) throw new Error('text-measure requires a canvas 2D context; defer measurement until the browser mounts.');
  ctx.font = font;
  ctx.fontKerning = 'normal';
  ctx.letterSpacing = `${options.letterSpacing ?? 0}px`;
  ctx.wordSpacing = `${options.wordSpacing ?? 0}px`;
  const em = Number(/(?:^|\s)(\d+(?:\.\d+)?)px(?:\/[^\s]+)?(?:\s|$)/u.exec(font)?.[1] ?? 14);
  return raw => {
    const space = options.whiteSpace ?? 'pre-wrap';
    const text = space === 'normal' ? raw.replace(/[\t\r\n\f ]+/gu, ' ').trim()
      : space === 'pre-line' ? raw.replace(/[\t\f ]+/gu, ' ').trim()
      : space === 'break-spaces' ? raw : raw.replace(/[\t ]+$/gu, '');
    // CSS text-autospace inserts 1/8 em at adjacent ideograph/Latin-or-number boundaries.
    const spaces = autospace ? [...text.matchAll(/(?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}](?=[A-Za-z0-9])|[A-Za-z0-9](?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]))/gu)].length : 0;
    if (!text.includes('\t')) return ctx.measureText(text).width + spaces * em / 8;
    const stop = Math.max(1, options.tabSize ?? 8) * ctx.measureText(' ').width;
    let width = 0;
    const pieces = text.split('\t');
    for (let index = 0; index < pieces.length; index++) {
      width += ctx.measureText(pieces[index]).width;
      if (index < pieces.length - 1) width = (Math.floor(width / stop) + 1) * stop;
    }
    return width + spaces * em / 8;
  };
}

function keepTail(runs: readonly TextRun[], minRun: number): TextRun[] {
  if (minRun <= 0 || runs.length < 2) return [...runs];
  let at = runs.length, count = 0;
  while (at > 0 && count < minRun) count += visible(runs[--at].text);
  return [...runs.slice(0, at), { from: runs[at].from, to: runs.at(-1)!.to, text: runs.slice(at).map(run => run.text).join('') }];
}

function wrapParagraph(runs: readonly TextRun[], width: number, measure: (text: string) => number): TextLine[] {
  const out: TextLine[] = [];
  let line: TextLine | undefined;
  const flush = () => { if (line) out.push(line); line = undefined; };
  for (const run of runs) {
    if (line && measure(line.text + run.text) <= width + 1 / 128) {
      line = { from: line.from, to: run.to, text: line.text + run.text };
      continue;
    }
    if (measure(run.text) <= width + 1 / 128) {
      flush(); line = { ...run }; continue;
    }
    // overflow-wrap:anywhere: only an individually overlong run may break inside a word.
    flush(); // CSS first moves an overlong word to a fresh line, then applies emergency wrapping.
    for (const char of segmentText(run.text, 'char')) {
      const text = char.text;
      if (line && measure(line.text + text) > width + 1 / 128 && !CLOSING.test(text)) flush();
      line = { from: line?.from ?? run.from + char.from, to: run.from + char.to, text: (line?.text ?? '') + text };
    }
  }
  flush();
  return out;
}

/** Preferred sentence boundaries are accepted only when they do not add lines. */
function paragraphRuns(text: string, options: TextOptions, measure: (text: string) => number): readonly TextRun[] {
  const mode = options.mode ?? 'word';
  if (mode !== 'sentence') return segmentText(text, mode);
  const normal = segmentText(text, 'word');
  const sentences = segmentText(text, 'sentence');
  const preferred: TextRun[] = [];
  for (const sentence of sentences) {
    if (measure(sentence.text) <= options.width) { preferred.push(sentence); continue; }
    let from = sentence.from;
    for (const clause of sentence.text.match(/[^，、,：:；;]+[，、,：:；;]?|[，、,：:；;]/gu) ?? [sentence.text]) {
      if (measure(clause) > options.width) preferred.push(...segmentText(clause, 'word').map(run => ({ ...run, from: run.from + from, to: run.to + from })));
      else preferred.push({ from, to: from + clause.length, text: clause });
      from += clause.length;
    }
  }
  return wrapParagraph(keepTail(preferred, options.minRun ?? 0), options.width, measure).length <= wrapParagraph(keepTail(normal, options.minRun ?? 0), options.width, measure).length ? preferred : normal;
}

/** Runs for Words. Supplying font + width enables the no-extra-lines sentence plan without DOM reads. */
export function textPieces(text: string, options: Pick<TextOptions, 'mode'> & Partial<TextOptions> = {}): string[] {
  if (options.mode !== 'sentence' || !options.font || !options.width || !canMeasureText()) return segmentText(text, options.mode).map(run => run.text);
  const measure = widthReader(options.font, options.autospace !== false, options);
  const pieces: string[] = [];
  for (const part of text.split(/(\r\n|[\r\n])/u)) {
    if (/^[\r\n]+$/u.test(part)) pieces.push(part);
    else pieces.push(...paragraphRuns(part, { ...options, font: options.font, width: options.width, mode: 'sentence' }, measure).map(run => run.text));
  }
  return pieces;
}

/** LF/CRLF remain source boundaries. Returned ranges can be reused by W3 paragraph/fragment planning. */
export function measureTextLines(text: string, options: TextOptions): readonly TextLine[] {
  if (!text) return [];
  if (!Number.isFinite(options.width) || options.width <= 0) throw new RangeError('text width must be finite and greater than zero');
  if (!options.font.trim()) throw new TypeError('text font must be a resolved CSS font string');
  if (/var\(/u.test(options.font)) throw new TypeError('resolve font tokens before calling text-measure');
  const width = textWidthBucket(options.width);
  const key = JSON.stringify([text, options.font, width, options.mode ?? 'word', options.minRun ?? 0, options.autospace !== false, options.letterSpacing ?? 0, options.wordSpacing ?? 0, options.whiteSpace ?? 'pre-wrap', options.tabSize ?? 8]);
  const hit = cached(linesCache, key);
  if (hit) return hit;
  // Character runs are separated by wbr; CSS does not insert autospace across that boundary.
  const measure = widthReader(options.font, options.autospace !== false && options.mode !== 'char', options);
  const space = options.whiteSpace ?? 'pre-wrap';
  const lines: TextLine[] = [];
  let from = 0;
  const paragraphs = text.split(/\r\n|[\r\n]/u);
  if (paragraphs.length > 1 && paragraphs.at(-1) === '') paragraphs.pop(); // final preserved newline has no following text line
  const collapsedRuns: TextRun[] = [];
  for (const paragraph of paragraphs) {
    const runs = keepTail(paragraphRuns(paragraph, { ...options, width }, measure), options.minRun ?? 0);
    if (space === 'normal') {
      collapsedRuns.push(...runs.map(run => ({ ...run, from: run.from + from, to: run.to + from })));
      from += paragraph.length;
      const newline = text.slice(from).match(/^(?:\r\n|[\r\n])/u)?.[0];
      if (newline) collapsedRuns.push({ from, to: from + newline.length, text: newline });
      from += newline?.length ?? 0;
      continue;
    }
    const wrapped = space === 'pre' ? [{ from: 0, to: paragraph.length, text: paragraph }] : wrapParagraph(runs, width, measure);
    lines.push(...(wrapped.length ? wrapped.map(line => ({ ...line, from: line.from + from, to: line.to + from })) : [{ from, to: from, text: '' }]));
    from += paragraph.length;
    const newline = text.slice(from).match(/^(?:\r\n|[\r\n])/u)?.[0];
    from += newline?.length ?? 0;
  }
  if (space === 'normal' && text.trim()) lines.push(...wrapParagraph(collapsedRuns, width, measure));
  return remember(linesCache, key, Object.freeze(lines.map(line => Object.freeze(line))), CACHE_LIMIT);
}
export function estimateLines(text: string, options: TextOptions): number { return measureTextLines(text, options).length; }

/** Whole paragraphs only, preserving the source prefix; omitted count is UI metadata, never appended. */
export function fitTextParagraphs(text: string, options: TextOptions, maxLines: number) {
  let end = 0, lines = 0, accepted = 0;
  const paragraphs = [...text.matchAll(/[^\r\n]+(?:\r\n|[\r\n]|$)|(?:\r\n|[\r\n])/gu)];
  for (const paragraph of paragraphs) {
    const value = paragraph[0].replace(/(?:\r\n|[\r\n])$/u, '');
    const next = estimateLines(value, options) || 1;
    if (lines + next > maxLines) break;
    end = paragraph.index! + paragraph[0].length; lines += next; accepted += 1;
  }
  return { text: text.slice(0, end), end, lines, accepted, omitted: paragraphs.length - accepted };
}
