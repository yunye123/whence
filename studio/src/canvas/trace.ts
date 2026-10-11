/**
 * 溯光与系签（DESIGN_SYSTEM.md §6.17、§7）的纯计算部分：走哪几段线、什么时候走、每一帧画什么。
 * DOM 播放在 `trace-player.ts`，App 接入用 `useFieldTrace.ts`（接线见 docs/redesign/integration/trace.md）。
 *
 * - 触发 A（点摘录的签、操作条“回到原片/原文”）：光从出处印中线沿摘录线走回来源，1 段。
 * - 触发 B（点文稿里的引用）：光从文稿段圈或引用行沿引用线走到摘录，经过摘录卡，再沿摘录线走回来源，2 段；
 *   文稿直接引用来源（没有摘录）时只有引用线 1 段。
 * - 线的路径方向是“上游 → 下游”（来源 → 摘录 → 文稿），光沿路径从终点走回起点。
 */
import type { Board, BoardNode } from '../model';
import { draftFootnotes } from '../source-location';
import { lengthMarks, railSegments } from '../cards/card-utils';
import type { ExcerptMark } from '../cards/types';
import { fieldEdgeRecords } from './edges/model';

export interface TraceRequest {
  /** 回到的来源卡。 */
  sourceId: string;
  /** 经过的摘录卡（引用里写明了摘录，或从摘录的签触发）。 */
  quoteId?: string;
  /** 从哪份文稿触发（触发 B）。 */
  draftId?: string;
  /** 点的是文稿的第几处引用（1 起，与脚注序号一致）；不给时取这条引用第一次出现的序号。 */
  footnote?: number;
}

/** 回源是从哪份文稿的第几处引用触发的（App 的 focusSource 第 5 个参数，可省略：播放器会按最近一次按下的卡片推断）。 */
export type TraceOrigin = Pick<TraceRequest, 'draftId' | 'footnote'>;

export type TraceSegmentKind = 'cite' | 'excerpt';
export interface TraceSegment {
  /** React Flow 里这条线的 id（派生引用线是 `cite:<文稿>:<摘录>`）。 */
  edgeId: string;
  kind: TraceSegmentKind;
  /** 光从哪张卡出发、走到哪张卡。 */
  from: string;
  to: string;
}

export interface TracePlan {
  sourceId: string;
  quoteId?: string;
  draftId?: string;
  /** 起点高亮的脚注序号（触发 B）。 */
  footnote?: number;
  /** 起点卡：触发 B 是文稿，触发 A 是摘录。 */
  startId: string;
  segments: TraceSegment[];
}

type TraceBoard = Pick<Board, 'nodes' | 'edges'>;

/** 由画布数据决定光走哪几段线；一段都没有（线被删了、来源不一致）时返回 null，调用方直接打开来源。 */
export function planTrace(board: TraceBoard | null | undefined, request: TraceRequest): TracePlan | null {
  if (!board) return null;
  const byId = new Map(board.nodes.map(node => [node.id, node] as const));
  if (!byId.has(request.sourceId)) return null;
  const quoteNode = request.quoteId ? byId.get(request.quoteId) : undefined;
  const quote = quoteNode?.data.kind === 'quote' && quoteNode.data.citation?.nodeId === request.sourceId ? quoteNode : undefined;
  const draft = request.draftId ? byId.get(request.draftId) : undefined;
  const records = fieldEdgeRecords(board);
  const segments: TraceSegment[] = [];
  let footnote: number | undefined;

  if (draft?.data.kind === 'draft' && draft.id !== request.sourceId) {
    const key = quote?.id ?? request.sourceId;
    const cite = records.find(record => record.data.kind === 'cite' && record.data.from === key && record.data.to === draft.id);
    if (cite) {
      segments.push({ edgeId: cite.id, kind: 'cite', from: draft.id, to: key });
      footnote = footnoteFor(draft, quote, request);
    }
  }
  if (quote) {
    const excerpt = records.find(record => record.data.kind === 'excerpt' && record.data.from === request.sourceId && record.data.to === quote.id);
    if (excerpt) segments.push({ edgeId: excerpt.id, kind: 'excerpt', from: quote.id, to: request.sourceId });
  }
  if (!segments.length) return null;
  return {
    sourceId: request.sourceId,
    ...(quote ? { quoteId: quote.id } : {}),
    ...(segments[0].kind === 'cite' && draft ? { draftId: draft.id } : {}),
    ...(footnote !== undefined ? { footnote } : {}),
    startId: segments[0].from,
    segments,
  };
}

// ── 到达：来源上亮哪一处（§6.17“来源刻痕或段落脉动一次”） ─────────────────────────

/**
 * 到达时在来源卡的轨道上点亮这条摘录的位置：
 * - `video`：句子刻度轨（`railSegments` 的格子）里第 first–last 格，count 是格子总数（与 DOM 的 span 数对得上才画）；
 * - `length`：文字资料篇幅轨上的 left / width（0–1，`lengthMarks` 同一算法）。
 * 摘录给出时间段或原文位置；文稿直接引用视频时用链接里的时间。没有可亮的位置时返回 null（播放器改画一圈外框）。
 */
export type ArrivalSpot =
  | { rail: 'video'; first: number; last: number; count: number }
  | { rail: 'length'; left: number; width: number };

export function arrivalSpot(board: TraceBoard | null | undefined, plan: Pick<TracePlan, 'sourceId' | 'quoteId' | 'draftId' | 'footnote'>): ArrivalSpot | null {
  if (!board) return null;
  const source = board.nodes.find(node => node.id === plan.sourceId);
  if (!source) return null;
  const quote = plan.quoteId ? board.nodes.find(node => node.id === plan.quoteId) : undefined;
  const citation = quote?.data.kind === 'quote' && quote.data.citation?.nodeId === source.id ? quote.data.citation : undefined;
  let mark: ExcerptMark | null = null;
  if (citation?.start !== undefined) mark = { start: citation.start, end: citation.end };
  else if (citation?.textAnchor) mark = { from: citation.textAnchor.from, to: citation.textAnchor.to };
  else if (!quote && plan.draftId && plan.footnote !== undefined) {
    const draft = board.nodes.find(node => node.id === plan.draftId);
    const time = draftFootnotes(draft?.data.body ?? '').find(note => note.index === plan.footnote && note.sourceNodeId === source.id)?.time;
    if (time !== undefined) mark = { start: time, end: time + .001 };
  }
  if (!mark) return null;
  if (source.data.kind === 'video' && mark.start !== undefined) {
    const cells = railSegments(source.data.transcript, [mark]);
    const first = cells.findIndex(cell => cell.marked);
    if (first < 0) return null;
    let last = first;
    while (last + 1 < cells.length && cells[last + 1].marked) last++;
    return { rail: 'video', first, last, count: cells.length };
  }
  if (mark.from !== undefined && mark.to !== undefined) {
    const span = lengthMarks((source.data.body ?? '').replace(/\r\n?/g, '\n').length, [mark])[0];
    return span ? { rail: 'length', left: span.left, width: span.width } : null;
  }
  return null;
}

function footnoteFor(draft: BoardNode, quote: BoardNode | undefined, request: TraceRequest): number | undefined {
  const notes = draftFootnotes(draft.data.body ?? '');
  const matches = (note: (typeof notes)[number]) => (quote ? note.quoteNodeId === quote.id : !note.quoteNodeId && note.sourceNodeId === request.sourceId);
  if (request.footnote !== undefined) {
    const asked = notes.find(note => note.index === request.footnote);
    if (asked && matches(asked)) return asked.index;
  }
  return notes.find(matches)?.index;
}

// ── 时间表（§7 v1.2：0 / 80 / 560ms 到达即打开，总长 ≤ 2s） ───────────────────────

export interface TraceTiming {
  /** 起点中性提亮。 */
  lift: number;
  /** 最后一段（回到来源的那段）行进时长上限，`--dur-trace`。 */
  walk: number;
  /** 经过中间那张卡。 */
  pass: number;
  /** 到达：来源刻痕脉动一次（与打开工作台同时进行，不再等它）。 */
  pulse: number;
  /** 走过的线退回原色，`--dur-afterglow`（被总长截短）。 */
  afterglow: number;
  /** 总长上限。 */
  total: number;
  /** 光最晚在这时到达来源（多段时各段按它压缩）。 */
  arrivalBy: number;
}

/**
 * CORE-11（第 4 轮决定）：点签到观看工作台可见 ≤ 800ms。溯光压缩到一段 480ms，光点到达来源的那一刻就开始打开
 * 观看 / 阅读，脉动与退色在工作台打开时照常进行（不等余晖）；减少动效时 0ms 打开。
 */
export const TRACE_TIMING: TraceTiming = { lift: 80, walk: 480, pass: 80, pulse: 240, afterglow: 900, total: 2000, arrivalBy: 700 };
/** 多段时最后一段（回到来源）在行进预算里占的份额；其余各段平分剩下的。 */
const LAST_SEGMENT_SHARE = .65;
/** 多段时前面各段至少走这么久，短线也看得见光走过。 */
const EARLIER_SEGMENT_MIN = 160;
/** 减少动效：不行进，来源处直接亮起，停 240ms 后淡出（淡出取 `--dur-afterglow`，减少动效时为 240ms）。 */
export const REDUCED_HOLD = 240;

export interface TraceWindow { start: number; end: number }
export interface TraceSchedule {
  walks: TraceWindow[];
  passes: TraceWindow[];
  /** 光到达来源。 */
  arrive: number;
  /** 打开观看 / 阅读并定位（到达即打开；被打断时立即）。 */
  open: number;
  /** 走过的线开始退色。 */
  fadeStart: number;
  /** 一切复原。 */
  end: number;
}

/** 行进时间表。1 段：80–560 行进，560 到达并打开，1460 复原；2 段：80–269、349–700，700 到达并打开，1600 复原。 */
export function traceSchedule(segmentCount: number, timing: TraceTiming = TRACE_TIMING): TraceSchedule {
  const count = Math.max(1, Math.floor(segmentCount) || 1);
  const lift = Math.max(0, timing.lift);
  const budget = Math.max(0, timing.arrivalBy - lift - timing.pass * (count - 1));
  const cap = Math.max(0, timing.walk);
  const last = count > 1 ? Math.min(cap, budget * LAST_SEGMENT_SHARE) : Math.min(cap, budget || cap);
  const earlier = count > 1 ? Math.max(EARLIER_SEGMENT_MIN, (budget - last) / (count - 1)) : 0;
  const walks: TraceWindow[] = [];
  const passes: TraceWindow[] = [];
  let time = lift;
  for (let index = 0; index < count; index++) {
    const duration = index === count - 1 ? last : earlier;
    walks.push({ start: time, end: time + duration });
    time += duration;
    if (index < count - 1) { passes.push({ start: time, end: time + timing.pass }); time += timing.pass; }
  }
  const arrive = time;
  const fade = Math.max(0, Math.min(timing.afterglow, timing.total - arrive));
  return { walks, passes, arrive, open: arrive, fadeStart: arrive, end: arrive + fade };
}

/** Reduced motion: open immediately, hold arrival outline for 240ms, then remove. */
export function reducedTraceSchedule(_afterglow = REDUCED_HOLD): TraceSchedule {
  return { walks: [], passes: [], arrive: 0, open: 0, fadeStart: REDUCED_HOLD, end: REDUCED_HOLD };
}

export const STAMP_TIMING = { in: 120, hold: 240, out: 360, total: 720 } as const;
/** Wash opacity only; no rotation or scale. */
export function stampOpacity(elapsed: number, reduced = false): number {
  if (elapsed < 0) return 0;
  if (reduced) return elapsed < REDUCED_HOLD ? 1 : 0;
  if (elapsed < STAMP_TIMING.in) return elapsed / STAMP_TIMING.in;
  if (elapsed <= STAMP_TIMING.in + STAMP_TIMING.hold) return 1;
  return Math.max(0, 1 - (elapsed - STAMP_TIMING.in - STAMP_TIMING.hold) / STAMP_TIMING.out);
}

// ── 每一帧画什么（画布单位，路径长 L，光从 L 走向 0） ───────────────────────────

export interface DashSpec { dasharray: string; dashoffset: number; opacity: number }

/** 流动亮段：行进前沿 6 截首尾相接的短段，每截屏幕 9px，不透明度连续衰减（§6.17）。 */
export const COMET_OPACITY = [1, .72, .5, .32, .2, .12] as const;
export const COMET_SEGMENT_PX = 9;
/** 屏幕尺寸（px）：走过的线 2、亮段 3.5（全系统最宽，§6.17 禁止更宽的半透明光带）、光点半径 3、光点外圈 1.5。 */
export const TRACE_STROKE = { walk: 2, comet: 3.5, dot: 3, dotRing: 1.5, tie: 1.5, eye: 3.5 } as const;

/** 已走过的部分：[L − walked, L]。 */
export function walkedDash(length: number, progress: number, opacity = 1): DashSpec {
  const p = clamp01(progress);
  const walked = length * p;
  return { dasharray: `${round(walked)} ${round(length + 10)}`, dashoffset: round(-(length - walked)), opacity };
}

/** 前沿位置（离路径起点的长度）。 */
export const frontAt = (length: number, progress: number) => length * (1 - clamp01(progress));

/** 亮段的几截（画布单位）；行进完成或尚未开始时为空。 */
export function cometDashes(length: number, progress: number, zoom: number): DashSpec[] {
  const p = clamp01(progress);
  if (!(length > 0) || p <= 0 || p >= 1) return [];
  const segment = COMET_SEGMENT_PX / (zoom > 0 ? zoom : 1);
  const front = frontAt(length, p);
  const dashes: DashSpec[] = [];
  COMET_OPACITY.forEach((opacity, index) => {
    const start = front + index * segment;
    const span = Math.min(segment, length - start);
    if (span <= 0) return;
    dashes.push({ dasharray: `${round(span)} ${round(length + 10)}`, dashoffset: round(-start), opacity });
  });
  return dashes;
}

/** Legacy pure dash helper: draw from source to excerpt（[0, L·p] 可见）。 */
export function drawnDash(length: number, progress: number): DashSpec {
  const p = clamp01(progress);
  return { dasharray: `${round(length)} ${round(length + 10)}`, dashoffset: round(length * (1 - p)), opacity: 1 };
}

/** 退色：fadeStart 之前 1，之后按 ease-out（先快后慢）降到 0。 */
export function fadeOpacity(time: number, schedule: Pick<TraceSchedule, 'fadeStart' | 'end'>): number {
  if (time <= schedule.fadeStart) return 1;
  const span = schedule.end - schedule.fadeStart;
  if (span <= 0) return 0;
  const t = clamp01((time - schedule.fadeStart) / span);
  return round((1 - t) ** 3);
}

/** Legacy pulse helper retained for callers; the v2 DOM player does not scale。 */
export function pulseScale(time: number, arrive: number, pulse: number): number {
  if (pulse <= 0 || time <= arrive || time >= arrive + pulse) return 1;
  return round(1 + .5 * Math.sin(((time - arrive) / pulse) * Math.PI));
}

/** 时间 t 落在第几段行进里（返回段号与 0–1 的线性进度；不在任何一段时为 null）。 */
export function activeWalk(time: number, schedule: Pick<TraceSchedule, 'walks'>): { index: number; linear: number } | null {
  for (let index = 0; index < schedule.walks.length; index++) {
    const walk = schedule.walks[index];
    if (time >= walk.start && time < walk.end) return { index, linear: walk.end > walk.start ? (time - walk.start) / (walk.end - walk.start) : 1 };
  }
  return null;
}

function clamp01(value: number) { return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0; }
function round(value: number) { return Math.round(value * 100) / 100; }
