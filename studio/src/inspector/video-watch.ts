import { useCallback, useSyncExternalStore } from 'react';
import type { BoardNode, CardData, TranscriptLine } from '../model';
import { parseDraftReferences } from '../draft-references';
import type { DraftReference } from '../draft-references';
import { draftParagraphIndexAt, draftReadableSegments, timeRangeLabel } from '../source-location';
import type { DraftSegment } from '../source-location';
import { isSampleAsset } from '../templates';
import { draftStage } from '../cards/card-utils';

/**
 * Shared state and pure helpers for the watching workbench (DESIGN_SYSTEM §6.18.2).
 *
 * PV-M1: the player publishes its time here on every media event instead of re-rendering the whole
 * Inspector. Components subscribe with a selector (the current sentence index, the whole second for the
 * clock), so playback re-renders only what changes: the transcript once per sentence, the clock once per
 * second; the timeline playhead is written straight to a CSS variable.
 */

type Listener = () => void;
function keyedStore<T>() {
  const values = new Map<string, T>();
  const listeners = new Map<string, Set<Listener>>();
  const notify = (key: string) => listeners.get(key)?.forEach(listener => listener());
  return {
    get: (key: string) => values.get(key),
    set(key: string, value: T) { if (Object.is(values.get(key), value)) return; values.set(key, value); notify(key); },
    delete(key: string) { if (!values.has(key)) return; values.delete(key); notify(key); },
    subscribe(key: string, listener: Listener) {
      let set = listeners.get(key);
      if (!set) listeners.set(key, set = new Set());
      set.add(listener);
      return () => { set!.delete(listener); if (!set!.size) listeners.delete(key); };
    },
  };
}
type KeyedStore<T> = ReturnType<typeof keyedStore<T>>;

function useKeyed<T, R>(store: KeyedStore<T>, key: string, select: (value: T | undefined) => R): R {
  const subscribe = useCallback((listener: Listener) => store.subscribe(key, listener), [store, key]);
  const snapshot = () => select(store.get(key));
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// ---------- Playhead ----------

export interface Playhead { time: number; playing: boolean }
export const playheads = keyedStore<Playhead>();

export function publishPlayhead(nodeId: string, time: number, playing?: boolean) {
  const previous = playheads.get(nodeId);
  const next = { time: Number.isFinite(time) && time >= 0 ? time : 0, playing: playing ?? previous?.playing ?? false };
  if (previous && previous.time === next.time && previous.playing === next.playing) return;
  playheads.set(nodeId, next);
}

/** Subscribe to one derived value of the playhead; `fallbackTime` stands in before the player has reported. */
export function usePlayhead<R>(nodeId: string, select: (time: number, playing: boolean) => R, fallbackTime = 0): R {
  return useKeyed(playheads, nodeId, head => select(head?.time ?? fallbackTime, head?.playing ?? false));
}

// ---------- Selected sentences, shared by the transcript, the timeline and the footer ----------

export const selections = keyedStore<ReadonlySet<string>>();
export function useSelectedLines(nodeId: string): ReadonlySet<string> | undefined {
  return useKeyed(selections, nodeId, value => value);
}

// ---------- Transcript view (search filter), read by the footer ----------

export interface TranscriptView { query: string; visibleIds: readonly string[] | null }
export const transcriptViews = keyedStore<TranscriptView>();
export function useTranscriptView(nodeId: string): TranscriptView | undefined {
  return useKeyed(transcriptViews, nodeId, view => view);
}

// ---------- Line correction in place (PV-m2) ----------

/** The line being corrected, so the transcript can mark its row as the dialog's anchor. */
export interface CorrectionState { lineId: string; dirty: boolean }
export const corrections = keyedStore<CorrectionState>();
export function useCorrection(nodeId: string): CorrectionState | undefined {
  return useKeyed(corrections, nodeId, value => value);
}

// ---------- Video helpers ----------

/** The Inspector's own media URL, or a bundled sample film (the example boards, EXAMPLE_CONTENT §8.2). */
export function watchableVideoUrl(videoUrl: string | undefined, data: Pick<CardData, 'url'>): string | undefined {
  if (videoUrl) return videoUrl;
  return isSampleAsset(data.url) && data.url.endsWith('.mp4') ? data.url : undefined;
}

/** Natural aspect ratios seen this session, so reopening a portrait video does not flash a 16:9 frame. */
export const videoRatios = new Map<string, number>();

/** `mm:ss`, or `H:MM:SS` once the film reaches an hour (PV-m1). Always rounds down. */
export function clockLabel(seconds: number, hours = seconds >= 3600): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  const mm = String(hours ? m : Math.floor(whole / 60)).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return hours ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** “10 月 3 日采集” (with the year when it is not this year), for the header meta. */
export function collectedLabel(iso: string | undefined, now = new Date()): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const day = `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  return `${date.getFullYear() === now.getFullYear() ? day : `${date.getFullYear()} 年 ${day}`}采集`;
}

const sortedCache = new WeakMap<readonly TranscriptLine[], boolean>();
function isSorted(lines: readonly TranscriptLine[]): boolean {
  let sorted = sortedCache.get(lines);
  if (sorted === undefined) {
    sorted = lines.every((line, index) => index === 0 || lines[index - 1].start <= line.start);
    sortedCache.set(lines, sorted);
  }
  return sorted;
}

/** Index of the sentence playing at `time` (start ≤ time < end), or -1 in a gap. Binary search on sorted lines. */
export function lineIndexAt(lines: readonly TranscriptLine[], time: number): number {
  if (!lines.length || !Number.isFinite(time)) return -1;
  if (!isSorted(lines)) return lines.findIndex(line => time >= line.start && time < line.end);
  let low = 0, high = lines.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lines[middle].start <= time) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found >= 0 && time < lines[found].end ? found : -1;
}

/** The sentence a “previous / next sentence” press lands on, measured from the current time. */
export function neighbourLine(lines: readonly TranscriptLine[], time: number, direction: -1 | 1): TranscriptLine | undefined {
  if (!lines.length) return undefined;
  if (direction > 0) return lines.find(line => line.start > time + 0.05);
  const current = lineIndexAt(lines, time);
  // Within the first second of a sentence, “previous” means the sentence before it (players behave this way).
  if (current >= 0 && time - lines[current].start > 1) return lines[current];
  for (let index = lines.length - 1; index >= 0; index--) if (lines[index].start < time - 0.05 && index !== current) return lines[index];
  return lines[0];
}

const labelCache = new WeakMap<readonly TranscriptLine[], string[]>();
/**
 * Visible time codes for the transcript: `mm:ss` (`H:MM:SS` past an hour). When neighbouring sentences
 * start in the same second, both show tenths so no two adjacent rows read the same (PV-m1).
 */
export function transcriptTimeLabels(lines: readonly TranscriptLine[]): string[] {
  const cached = labelCache.get(lines);
  if (cached) return cached;
  const hours = lines.some(line => line.start >= 3600);
  const base = lines.map(line => clockLabel(line.start, hours));
  const labels = base.map((label, index) => {
    if (base[index - 1] !== label && base[index + 1] !== label) return label;
    // Tenths of the start, robust to binary fractions (19.7 % 1 is 0.6999…).
    const tenths = Math.floor(lines[index].start * 10 + 1e-6) % 10;
    return `${label}.${tenths}`;
  });
  labelCache.set(lines, labels);
  return labels;
}

/** Captured lines are joined with spaces; between Chinese characters and punctuation a space is only an artefact. */
export function tidyCjkSpacing(text: string): string {
  return text.replace(/([\u3000-\u303f\u3400-\u9fff\uff00-\uffef])[ \t\n]+(?=[\u3000-\u303f\u3400-\u9fff\uff00-\uffef])/gu, '$1');
}

/**
 * 来历 shows a quote as a sentence or two; a very long excerpt (a whole selected transcript) is cut to its opening
 * here. Its full text stays on the quote card, and laying out tens of thousands of characters would stall the page.
 */
export function clipText(text: string, limit = 140): string {
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  return `${characters.slice(0, limit).join('').replace(/[，。、；：,.;:\s]+$/u, '')}…`;
}

// ---------- Quotes taken from this video, and where they were written ----------

export interface VideoQuote { id: string; start: number; end: number; label: string; text: string; title: string }

/** Every quote on the board cut from this video, in film order. */
export function videoQuotes(nodes: readonly BoardNode[], videoId: string): VideoQuote[] {
  const quotes: VideoQuote[] = [];
  for (const node of nodes) {
    const citation = node.data.kind === 'quote' ? node.data.citation : undefined;
    if (!citation || citation.nodeId !== videoId || citation.start === undefined) continue;
    const end = citation.end !== undefined && citation.end > citation.start ? citation.end : citation.start;
    quotes.push({ id: node.id, start: citation.start, end, label: timeRangeLabel(citation.start, citation.end) ?? '', text: tidyCjkSpacing((citation.text ?? node.data.body ?? '').trim()), title: node.data.title });
  }
  return quotes.sort((a, b) => a.start - b.start || a.end - b.end);
}

export interface LineMarks { used: boolean; usedStart: boolean }
/** Which sentences were already excerpted, and which one opens each excerpt (where “已摘录” is written). */
export function lineMarks(lines: readonly TranscriptLine[], quotes: readonly VideoQuote[]): LineMarks[] {
  const marks = lines.map(() => ({ used: false, usedStart: false }));
  if (!quotes.length) return marks;
  for (const quote of quotes) {
    let first = -1;
    lines.forEach((line, index) => {
      const overlaps = (line.start < quote.end - 0.01 && line.end > quote.start + 0.01)
        || (quote.end === quote.start && line.start <= quote.start && quote.start < line.end);
      if (!overlaps) return;
      marks[index].used = true;
      if (first < 0) first = index;
    });
    if (first >= 0) marks[first].usedStart = true;
  }
  return marks;
}

export interface DraftUse {
  draftId: string;
  title: string;
  stage: string;
  paragraph?: number;
  /** The written sentence around the citation, with its footnote number (same as the draft's own numbering). */
  segments: DraftSegment[];
}

/** Text blocks split on blank lines, as `paragraphIndexAt` counts them. */
function blocksOf(body: string) {
  const blocks: { from: number; to: number }[] = [];
  const separator = /\n[ \t]*\n(?:[ \t]*\n)*/g;
  let start = 0;
  for (;;) {
    const match = separator.exec(body);
    const end = match ? match.index : body.length;
    if (body.slice(start, end).trim()) blocks.push({ from: start, to: end });
    if (!match) break;
    start = match.index + match[0].length;
  }
  return blocks;
}

/**
 * The written sentence for one citation: its own block, or the quoted block just before a citation that stands
 * alone on its line (the shape `formatDraftQuote` writes). `at` is where that passage starts, for “第 N 段”.
 */
function citedPassage(body: string, references: DraftReference[], reference: DraftReference, footnote: number): { segments: DraftSegment[]; at: number } {
  const blocks = blocksOf(body);
  const index = blocks.findIndex(block => reference.from >= block.from && reference.from < block.to);
  if (index < 0) return { segments: [{ footnote }], at: reference.from };
  const own = blocks[index];
  const withoutLinks = (from: number, to: number) => {
    let text = body.slice(from, to);
    for (const item of references.filter(ref => ref.from >= from && ref.to <= to).sort((a, b) => b.from - a.from)) text = text.slice(0, item.from - from) + text.slice(item.to - from);
    return text;
  };
  const alone = !withoutLinks(own.from, own.to).trim();
  const block = alone && index > 0 ? blocks[index - 1] : own;
  const before = draftReadableSegments(body.slice(block.from, alone ? block.to : reference.from))
    .filter(segment => 'text' in segment)
    .map(segment => ({ text: (segment as { text: string }).text.replace(/\s+/g, ' ') }));
  const text = tidyCjkSpacing(before.map(segment => segment.text).join('').trim());
  return { segments: text ? [{ text }, { footnote }] : [{ footnote }], at: block.from };
}

/** For each quote of this video, the drafts that cite it (by quote id, or by the citation time for older links). */
export function draftUses(nodes: readonly BoardNode[], videoId: string, quotes: readonly VideoQuote[]): Map<string, DraftUse[]> {
  const uses = new Map<string, DraftUse[]>();
  if (!quotes.length) return uses;
  for (const node of nodes) {
    if (node.data.kind !== 'draft' || !node.data.body.includes(videoId)) continue;
    const body = node.data.body.replace(/\r\n?/g, '\n');
    const references = parseDraftReferences(body);
    references.forEach((reference, index) => {
      if (reference.sourceNodeId !== videoId) return;
      const quote = reference.quoteNodeId
        ? quotes.find(item => item.id === reference.quoteNodeId)
        : reference.time !== undefined ? quotes.find(item => Math.abs(item.start - reference.time!) < 0.5) : undefined;
      if (!quote) return;
      const list = uses.get(quote.id) ?? [];
      if (list.some(use => use.draftId === node.id)) return;
      const passage = citedPassage(body, references, reference, index + 1);
      list.push({
        draftId: node.id,
        title: node.data.title.trim() || '未命名文稿',
        stage: draftStage(node.data.draftVersions?.length ?? 0),
        paragraph: draftParagraphIndexAt(body, reference.from),
        segments: passage.segments,
      });
      uses.set(quote.id, list);
    });
  }
  return uses;
}

export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Per-viewer convenience ----------

const CAPTIONS_KEY = 'field-watch-captions-v1';
/** The viewer's own choice for the on-picture caption, or null when they have not chosen (then: on for landscape). */
export function readCaptionsPreference(): boolean | null {
  try { const value = globalThis.localStorage?.getItem(CAPTIONS_KEY); return value === 'on' ? true : value === 'off' ? false : null; } catch { return null; }
}
export function writeCaptionsPreference(value: boolean) {
  try { globalThis.localStorage?.setItem(CAPTIONS_KEY, value ? 'on' : 'off'); } catch { /* storage unavailable: keep the session value */ }
}

const FOLLOW_KEY = 'field-transcript-follow-v1';
export function readFollowPreference(): boolean {
  try { return globalThis.localStorage?.getItem(FOLLOW_KEY) !== 'off'; } catch { return true; }
}
export function writeFollowPreference(value: boolean) {
  try { globalThis.localStorage?.setItem(FOLLOW_KEY, value ? 'on' : 'off'); } catch { /* storage unavailable: keep the session value */ }
}
