import { draftFootnotes, draftParagraphNumbers, draftPreviewParagraphs, draftReadableSegments, joinCjkLines, type DraftFootnote } from '../source-location';
import { canMeasureText, estimateLines, measureTextLines, segmentText, type TextLine, type TextOptions } from './text-measure';

/** Display projection only. The LF source, owner ranges and legacy parsers remain untouched. */
export interface ManuscriptParagraph {
  readonly from: number;
  readonly number: number;
  readonly heading: boolean;
  readonly quoted: boolean;
  readonly text: string;
  readonly footnotes: readonly number[];
}
export interface ManuscriptProjection {
  readonly paragraphs: readonly ManuscriptParagraph[];
  readonly footnotes: readonly DraftFootnote[];
  /** Former display grouping solely for the unchanged automatic height envelope, never for owners. */
  readonly legacyText: readonly string[];
}
const projections = new Map<string, ManuscriptProjection>();
const plans = new Map<string, ManuscriptPlan>();
const CACHE_LIMIT = 200;
export const DRAFT_REFERENCE_ROWS = 6;
export const DRAFT_LINE_HEIGHT = 28;
// The former eight-line envelope was 210px. The rule, frame and folding row share that envelope.
export const DRAFT_AUTO_BUDGET = 180;
export const DRAFT_FONT = '450 16px "Noto Serif SC Variable", "Songti SC", "SimSun", serif';
const bounded = <T>(cache: Map<string, T>, key: string, value: T): T => {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
};

/** Code/escaped/invalid links stay literal in the API; the card removes their notation here only. */
export function manuscriptText(text: string): string {
  return joinCjkLines(text
    .replace(/^[ \t]*(?:`{3,}|~{3,})[^\n]*$/gm, '')
    .replace(/\\([\[\]()`*_~])/g, '$1')
    .replace(/\[([^\]\n]*)\]\(\s*<?field:\/\/[^)\n]*\)?/g, '$1')
    .replace(/field:\/\/[^\s<>\])`]+/g, '')
    .replace(/\]?\(\s*<?field:\/\/[^)\n]*\)?/g, '')
    .replace(/\[([^\]\n]*)\]\(\s*\)/g, '$1')
    .replace(/!?\[([^\]\n]*)\]\([^\n)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}(?:>[ \t]*)+/gm, '')
    .replace(/^[ \t]*(?:(?:\d+[.)]|[-+*])[ \t]+(?:\[[ xX]\][ \t]+)?|\[[ xX]\][ \t]+)/gm, '')
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '')
    .replace(/~~([^\n]+?)~~/g, '$1')
    .replace(/(\*\*|__)([^\n]*?)\1/g, '$2')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/(^|[\s（(])[*_]([^*_\n]+)[*_](?=$|[\s，。！？,.!?）)])/g, '$1$2')
    .replace(/`+/g, '')
    .replace(/\[([^\]\n]*)\](?=\s*(?:$|\n))/g, '$1'))
    .replace(/\s+/g, ' ').trim();
}

export function manuscriptProjection(body: string): ManuscriptProjection {
  const source = body.replace(/\r\n?/g, '\n');
  const cached = projections.get(source);
  if (cached) return cached;
  const owners = draftParagraphNumbers(source);
  const paragraphs = draftPreviewParagraphs(source).map(p => {
    const text = manuscriptText(p.parts.map(s => 'text' in s ? s.text : '').join(''));
    return Object.freeze({ from: p.from, number: p.number, heading: p.heading,
      quoted: !p.heading && p.number > 0 && /^[ \t]{0,3}>/.test(source.slice(owners.starts[owners.owner.indexOf(p.number)])), text,
      footnotes: Object.freeze(p.parts.flatMap(s => 'footnote' in s ? [s.footnote] : [])) });
  }).filter(p => p.text || p.footnotes.length);
  const legacyText = [''];
  const oldEnd = source.length > 6000 ? source.lastIndexOf('\n\n', 6000) : source.length;
  draftReadableSegments(source.slice(0, oldEnd > 0 ? oldEnd : 6000)).forEach(s => {
    if ('footnote' in s) { const at = legacyText.at(-1) || legacyText.length < 2 ? legacyText.length - 1 : legacyText.length - 2; legacyText[at] += '¹'; return; }
    s.text.split(/\n{2,}/).forEach((part, i) => { if (i) legacyText.push(''); legacyText[legacyText.length - 1] += joinCjkLines(part).replace(/\n+/g, ' ').replace(/\]?\(\s*<?field:\/\/[^)\s]*\)?/g, ''); });
  });
  return bounded(projections, source, Object.freeze({ paragraphs: Object.freeze(paragraphs), legacyText: Object.freeze(legacyText.filter(Boolean)),
    footnotes: Object.freeze(draftFootnotes(source).map(f => Object.freeze(f))) }));
}

export interface ManuscriptPlan {
  readonly status: 'measured' | 'deferred';
  readonly visible: readonly ManuscriptParagraph[];
  readonly folded: readonly ManuscriptParagraph[];
  readonly height: number | null;
  readonly budget: number;
}

/** Whole prefix only; headings stay with the following prose, a stamp row is part of its passage. */
export function planManuscript(projection: ManuscriptProjection, width: number | undefined,
  budget = DRAFT_AUTO_BUDGET, measure: ((text: string, options: TextOptions) => number) | null | undefined = canMeasureText() ? estimateLines : undefined): ManuscriptPlan {
  const paragraphs = projection.paragraphs;
  if (!measure || !width || !Number.isFinite(width) || width <= 0) {
    return { status: 'deferred', visible: paragraphs, folded: [], height: null, budget };
  }
  const key = JSON.stringify([paragraphs, width, budget, DRAFT_FONT]);
  // Injected measurement is for deterministic responsibility tests and never poisons browser plans.
  const cached = measure === estimateLines ? plans.get(key) : undefined;
  if (cached) return cached;
  let height = 0, count = 0, elements = 0, exhausted = true;
  let pending = 0;
  let pendingElements = 0;
  for (const [index, p] of paragraphs.entries()) {
    const lines = p.text ? measure(p.text, { font: p.heading ? '600 14px "Noto Sans SC Variable", sans-serif' : p.quoted ? DRAFT_FONT.replace('450', '500') : DRAFT_FONT,
      width: Math.max(1, width - (p.quoted ? 14 : 0)), mode: 'char', minRun: 4, letterSpacing: 0, whiteSpace: 'normal', autospace: false }) : 0;
    const size = lines * (p.heading ? 20 : DRAFT_LINE_HEIGHT) + (p.heading ? 12 : 4) + (p.footnotes.length && p.quoted ? 26 : 0);
    pending += size;
    pendingElements += p.heading ? 5 : p.quoted && p.footnotes.length ? 12 : 5;
    if (p.heading) continue;
    const reserve = index + 1 < paragraphs.length ? 20 : 0;
    if (height + pending + reserve > Math.max(20, budget) || elements + pendingElements > 32) { exhausted = false; break; }
    height += pending;
    elements += pendingElements;
    pending = 0;
    pendingElements = 0;
    count = index + 1;
  }
  // A heading-only draft (or a final heading) has no following passage to keep with it.
  if (exhausted && pending && height + pending <= Math.max(20, budget) && elements + pendingElements <= 32) {
    height += pending; count = paragraphs.length;
  }
  const plan: ManuscriptPlan = Object.freeze({ status: 'measured', visible: Object.freeze(paragraphs.slice(0, count)),
    folded: Object.freeze(paragraphs.slice(count)), height, budget });
  return measure === estimateLines ? bounded(plans, key, plan) : plan;
}

export function manuscriptBudget(height: number | undefined, references: number, projection?: ManuscriptProjection, width?: number): number {
  // Single-line title+meta 76, rule 6, body insets 24, outside references 32 + 24/row.
  if (!height && projection && width && width > 40 && canMeasureText()) {
    const texts = projection.legacyText;
    const prose = texts.reduce((sum, text) => sum + estimateLines(text, { font: DRAFT_FONT.replace('16px', '15px'), width: width - 40, mode: 'char', minRun: 4, whiteSpace: 'normal', autospace: false }) * 26.25, 0) + Math.max(0, texts.length - 1) * 10;
    const oldHeight = 70.35 + 28 + Math.min(210, prose || 26.25) + (references ? 23 + references * 24 + Math.max(0, references - 1) * 2 : 0);
    const outside = 106 + (references ? 32 + Math.min(references, DRAFT_REFERENCE_ROWS) * 24 + (references > DRAFT_REFERENCE_ROWS ? 24 : 0) : 0);
    return Math.max(20, Math.min(DRAFT_AUTO_BUDGET, oldHeight - outside));
  }
  if (!height || !Number.isFinite(height) || height <= 0) return DRAFT_AUTO_BUDGET;
  const layout = manuscriptReferences(height, references);
  const outside = references ? 32 + (layout.compact ? 0 : layout.rows * 24 + (references > layout.rows ? 24 : 0)) : 0;
  return Math.max(20, height - 106 - outside);
}
/** Small fixed cards fold complete reference rows too, rather than clipping the final row. */
export function manuscriptReferences(height: number | undefined, references: number): { rows: number; compact: boolean } {
  if (!references) return { rows: 0, compact: false };
  if (!height || !Number.isFinite(height) || height <= 0) return { rows: Math.min(references, DRAFT_REFERENCE_ROWS), compact: false };
  if (height < 182) return { rows: 0, compact: true };
  return { rows: Math.min(references, DRAFT_REFERENCE_ROWS, Math.max(0, Math.floor((height - 182) / 24))), compact: false };
}
export function foldedParagraphLabel(paragraphs: readonly ManuscriptParagraph[], excerptNumber?: number): string {
  const numbers = paragraphs.filter(p => p.number && p.number !== excerptNumber).map(p => p.number);
  const remainder = excerptNumber ? `… 第 ${excerptNumber} 段余文` : '';
  if (remainder) return numbers.length ? `${remainder} · 第 ${numbers[0]}${numbers.length > 1 ? `–${numbers.at(-1)}` : ''} 段` : remainder;
  return numbers.length ? `… 第 ${numbers[0]}${numbers.length > 1 ? `–${numbers.at(-1)}` : ''} 段` : '… 展开阅读';
}
export const manuscriptCacheInfo = () => ({ projections: projections.size, plans: plans.size, limit: CACHE_LIMIT });
/** Font loads invalidate plans, never viewport removal/unmount. */
export const invalidateManuscriptPlans = () => plans.clear();

/** Fixed-paper fallback only: a display prefix, with room for two hint rows and the unchanged quote stamp. */
export function manuscriptExcerpt(paragraph: ManuscriptParagraph, width: number, budget: number,
  measure: ((text: string, options: TextOptions) => readonly TextLine[]) | null = canMeasureText() ? measureTextLines : null): { text: string; lines: number } | undefined {
  const limit = Math.floor((budget - 40 - 4 - (paragraph.quoted && paragraph.footnotes.length ? 26 : 0)) / DRAFT_LINE_HEIGHT);
  if (!measure || !Number.isFinite(width) || width <= 0 || limit < 1 || !paragraph.text) return undefined;
  const options: TextOptions = { font: paragraph.quoted ? DRAFT_FONT.replace('450', '500') : DRAFT_FONT,
    width: Math.max(1, width - (paragraph.quoted ? 14 : 0)), mode: 'char', minRun: 4, whiteSpace: 'normal', autospace: false };
  const lines = measure(paragraph.text, options);
  // Recheck the new paragraph tail: keeping its last four characters can introduce an extra row.
  for (let count = Math.min(limit, lines.length); count > 0; count--) {
    const text = paragraph.text.slice(0, lines[count - 1].to);
    const actual = measure(text, options).length;
    if (text.trim() && actual <= limit) return { text, lines: actual };
  }
  return undefined;
}

/** The simple tier needs a small display fragment, never thousands of hidden <wbr>s from an oversized owner. */
export function simpleManuscriptText(text: string, width?: number): string {
  if (width && width > 0 && canMeasureText()) {
    const lines = measureTextLines(text, { font: DRAFT_FONT, width, mode: 'char', minRun: 4, whiteSpace: 'normal', autospace: false });
    return text.slice(0, lines[Math.min(1, lines.length - 1)]?.to ?? 0);
  }
  const runs = segmentText(text, 'char');
  return text.slice(0, runs[Math.min(255, runs.length - 1)]?.to ?? 0);
}
