/** DOM trace player: actual edge paths, arrival outlines and stamp wash. No rotation, scale or layout-based stamp origin. */
import { cameraEase, computeRevealViewport, prefersReducedMotion } from './reveal';
import { getCanvasMetrics, type FlowViewport, type Rect } from './safe-area';
import {
  REDUCED_HOLD, STAMP_TIMING, TRACE_STROKE, TRACE_TIMING, activeWalk, arrivalSpot, cometDashes, fadeOpacity, frontAt, planTrace,
  reducedTraceSchedule, traceSchedule, walkedDash, type DashSpec, type TracePlan, type TraceRequest, type TraceSchedule,
} from './trace';
import type { Board } from '../model';

const SVG = 'http://www.w3.org/2000/svg';
/** 系签：新卡落位（§7 180ms）之后再画线，签不会边落边系。 */
const TIE_AFTER_LANDING = 180;
/** 系签等待画布露出的上限（例如在观看工作台里摘录，回到画布时再系）。 */
const TIE_WAIT_LIMIT = 20000;
/** 认定“这次回源是从哪张卡触发的”的时间窗。 */
const ACTIVATION_WINDOW = 1500;
/** 到达后来源上那一格亮多久（含淡出），以及淡出时长。 */
const ARRIVAL_HOLD = 600;
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn']);

export interface TraceEnv {
  /** `.react-flow` 根元素。 */
  root(): HTMLElement | null;
  zoom(): number;
  /** 节点在画布坐标里的矩形（已测量）。 */
  nodeRect(id: string): Rect | null;
  getViewport(): FlowViewport;
  setViewport(viewport: FlowViewport, options: { duration: number; ease?: (t: number) => number; interpolate?: 'linear' | 'smooth' }): void;
  /** 当前画布数据（规划光走哪几段）。 */
  board(): Pick<Board, 'nodes' | 'edges'> | null | undefined;
  /** 指向这张摘录的摘录线 id（React Flow 的 edges）。 */
  excerptEdgeOf(quoteId: string): string | null;
  reduced?(): boolean;
  now?(): number;
  readDuration?(name: string, fallback: number): number;
}

export interface TraceReport {
  plan: TracePlan;
  reduced: boolean;
  schedule: TraceSchedule;
  startedAt: number;
  openedAt?: number;
  endedAt?: number;
  interrupted?: boolean;
  cameraMoves: number;
  /** 每段开始时的镜头判断（目标矩形、当时视口、移动后的视口；null 表示目标已在可见画布内）。 */
  camera: { segment: number; target: Rect; from: FlowViewport; to: FlowViewport | null }[];
}

export interface FieldTraceController {
  /**
   * 回源。能播溯光时播，光到达来源后（或被打断时）调用 `open`；不能播时（画布被遮住、线不在、只有一张卡）立即调用 `open`。
   * 返回是否播放了溯光。`open` 总是恰好调用一次。
   */
  toSource(request: TraceRequest, open: () => void): boolean;
  /** Existing tie API: stamp new excerpt, 120/240/360ms; reduced static 240ms. */
  tie(quoteIds: readonly string[]): void;
  /** 新卡落位：减少动效时保留 1200ms 的 `--trace-walk` 外环（只淡出，不位移）；平时由卡片样式 `.is-fresh` 负责。 */
  land(ids: readonly string[]): void;
  /** 立即结束正在播放的溯光（跳到终态）。 */
  finish(): void;
  /** 是否正在播放溯光。 */
  isTracing(): boolean;
  /** 挂上“记住从哪张卡触发”的监听（组件挂载时调用）；返回卸载函数。可反复挂载。 */
  attach(): () => void;
}

let lastReport: TraceReport | null = null;
/** 最近一次溯光的时间记录（验收脚本与调试用；页面里也可读 `globalThis.__fieldTrace.last()`）。 */
export function lastTraceReport(): TraceReport | null { return lastReport; }
if (typeof globalThis !== 'undefined') Object.defineProperty(globalThis, '__fieldTrace', { value: { last: lastTraceReport }, configurable: true });

const escapeId = (id: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&'));
const nodeEl = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`.react-flow__node[data-id="${escapeId(id)}"]`);
const edgeEl = (root: ParentNode, id: string) => root.querySelector<SVGGElement>(`.react-flow__edge[data-id="${escapeId(id)}"]`);

function defaultReadDuration(name: string, fallback: number): number {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  if (!raw || !Number.isFinite(value)) return fallback;
  return raw.endsWith('ms') ? value : raw.endsWith('s') ? value * 1000 : value;
}

/**
 * 画布此刻是否看得见（不被观看工作台、专注写作、对话框、大纲视图遮住）。
 * 停靠面板占布局宽度，不算遮挡；阅读拆分时左侧画布条宽 ≥ 320 仍算看得见。
 */
export function canvasUncovered(root: HTMLElement | null): boolean {
  if (!root?.isConnected || typeof document === 'undefined') return false;
  const container = root.closest<HTMLElement>('.flow-container') ?? root;
  if (container.classList.contains('flow-hidden')) return false;
  const box = container.getBoundingClientRect();
  if (box.width < 240 || box.height < 200) return false;
  if (document.querySelector('dialog[open]:not(.inspector-dialog), .modal-backdrop')) return false;
  let visible = box.width;
  for (const cover of document.querySelectorAll<HTMLElement>('aside.inspector, .inspector-dialog[open]')) {
    const rect = cover.getBoundingClientRect();
    const overlapX = Math.min(box.right, rect.right) - Math.max(box.left, rect.left);
    const overlapY = Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top);
    if (overlapX > 0 && overlapY > box.height * .5) visible -= overlapX;
  }
  return visible >= 320;
}

function svgEl<K extends keyof SVGElementTagNameMap>(name: K, className: string): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, name);
  element.setAttribute('class', className);
  return element;
}

function applyDash(path: SVGPathElement, dash: DashSpec | null) {
  if (!dash || dash.opacity <= 0) { path.setAttribute('visibility', 'hidden'); return; }
  path.removeAttribute('visibility');
  path.setAttribute('stroke-dasharray', dash.dasharray);
  path.setAttribute('stroke-dashoffset', String(dash.dashoffset));
  path.setAttribute('opacity', String(dash.opacity));
}

/** 叠层放在 `.react-flow__edges` 末尾，层级取所描线绳所在 svg 的 z-index（在线绳之上、卡片之下）。 */
function mountOverlay(root: HTMLElement, className: string, edgeGroups: Element[]): SVGSVGElement | null {
  const host = root.querySelector('.react-flow__edges');
  if (!host) return null;
  const overlay = svgEl('svg', className);
  overlay.setAttribute('aria-hidden', 'true');
  const z = Math.max(0, ...edgeGroups.map(group => Number.parseInt((group.parentElement as HTMLElement | SVGElement | null)?.style.zIndex ?? '', 10)).filter(Number.isFinite));
  overlay.style.zIndex = String(z);
  host.appendChild(overlay);
  return overlay;
}

/**
 * 溯光进行中给 `.canvas-shell` 加 `data-tracing="true"`（选区包的约定，contextbar.css 据此让操作条先让开，
 * 不挡住光走的线）；光走完或被打断时移除。React 不管理这个属性。
 */
function setTracingFlag(root: HTMLElement | null, on: boolean) {
  const shell = root?.closest<HTMLElement>('.canvas-shell') ?? (typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.canvas-shell'));
  if (!shell) return;
  if (on) shell.dataset.tracing = 'true';
  else delete shell.dataset.tracing;
}

// ── 节点记号（data-trace 是空格分隔的词表，React 不管理这个属性） ────────────────────

class Marks {
  private touched = new Set<Element>();
  add(element: Element | null | undefined, token: string) {
    if (!element) return;
    const tokens = new Set((element.getAttribute('data-trace') ?? '').split(/\s+/).filter(Boolean));
    if (tokens.has(token)) return;
    tokens.add(token);
    element.setAttribute('data-trace', [...tokens].join(' '));
    if (token === 'pass') element.classList.add('field-trace-pass');
    if (token === 'start' && !element.classList.contains('react-flow__node')) element.classList.add('field-trace-start');
    this.touched.add(element);
  }
  remove(element: Element | null | undefined, token: string) {
    if (!element) return;
    const tokens = (element.getAttribute('data-trace') ?? '').split(/\s+/).filter(item => item && item !== token);
    if (tokens.length) element.setAttribute('data-trace', tokens.join(' ')); else element.removeAttribute('data-trace');
    if (token === 'pass' || token === 'start') element.classList.remove('field-trace-' + token);
  }
  clear() {
    for (const element of this.touched) { element.removeAttribute('data-trace'); element.classList.remove('field-trace-start', 'field-trace-pass'); }
    this.touched.clear();
  }
}

// ── 溯光 ────────────────────────────────────────────────────────────────

interface SegmentDraw {
  line: SVGPathElement;
  length: number;
  group: SVGGElement;
  walk: SVGPathElement;
  comets: SVGPathElement[];
  dot: SVGCircleElement;
  cameraDone: boolean;
}

interface TraceRun {
  plan: TracePlan;
  schedule: TraceSchedule;
  reduced: boolean;
  t0: number;
  open: () => void;
  opened: boolean;
  overlay: SVGSVGElement;
  segments: SegmentDraw[];
  marks: Marks;
  /** 到达时点亮的轨道（null：改画整卡外框）。 */
  arrival?: { rail: HTMLElement | null; marks: Element[] };
  /** 结束时撤掉写在 React 管理元素上的临时样式。 */
  cleanup: (() => void)[];
  frame: number;
  report: TraceReport;
}

export function createFieldTrace(env: TraceEnv): FieldTraceController {
  const now = env.now ?? (() => performance.now());
  const reduced = env.reduced ?? prefersReducedMotion;
  const readDuration = env.readDuration ?? defaultReadDuration;
  let run: TraceRun | null = null;
  let activation: { nodeId: string | null; footnote?: number; at: number } | null = null;

  // 记住最近一次按下的是哪张卡、哪条脚注：卡片上的脚注只调用 focusSource(来源, 时间, …, 摘录)，不带文稿 id。
  const remember = (event: Event) => {
    if (event.type === 'keydown') { const key = (event as KeyboardEvent).key; if (key !== 'Enter' && key !== ' ') return; }
    const target = event.target instanceof Element ? event.target : null;
    const node = target?.closest<HTMLElement>('.react-flow__node[data-id]');
    const footnote = Number.parseInt(target?.closest<HTMLElement>('[data-footnote]')?.dataset.footnote ?? '', 10);
    activation = { nodeId: node?.dataset.id ?? null, ...(Number.isFinite(footnote) ? { footnote } : {}), at: now() };
  };

  const interrupt = (event: Event) => {
    if (!run) return;
    if (event.type === 'keydown') {
      const keyboard = event as KeyboardEvent;
      if (keyboard.repeat || MODIFIER_KEYS.has(keyboard.key)) return;
    }
    stop(true);
  };
  const listen = (on: boolean) => {
    if (typeof window === 'undefined') return;
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('pointerdown', interrupt, { capture: true });
    window[method]('keydown', interrupt, { capture: true });
    window[method]('wheel', interrupt, { capture: true, passive: true } as AddEventListenerOptions);
  };

  function callOpen(current: TraceRun) {
    if (current.opened) return;
    current.opened = true;
    current.report.openedAt = now() - current.t0;
    current.open();
  }

  /** 结束：interrupted 时跳到终态（来源照常打开）；silent 只清理不打开（卸载时）。 */
  function stop(interrupted: boolean, silent = false) {
    const current = run;
    if (!current) return;
    run = null;
    cancelAnimationFrame(current.frame);
    listen(false);
    setTracingFlag(env.root(), false);
    current.report.endedAt = now() - current.t0;
    if (interrupted) current.report.interrupted = true;
    for (const undo of current.cleanup) undo();
    current.marks.clear();
    current.overlay.remove();
    if (!silent) callOpen(current);
  }

  function timing() {
    return {
      ...TRACE_TIMING,
      walk: readDuration('--dur-trace', TRACE_TIMING.walk) || TRACE_TIMING.walk,
      afterglow: readDuration('--dur-afterglow', TRACE_TIMING.afterglow) || TRACE_TIMING.afterglow,
    };
  }

  function moveCamera(current: TraceRun, index: number, duration: number) {
    const segment = current.plan.segments[index];
    const draw = current.segments[index];
    if (draw.cameraDone) return;
    draw.cameraDone = true;
    const destination = env.nodeRect(segment.to);
    const metrics = getCanvasMetrics();
    if (!destination || !metrics) return;
    let start: DOMPoint | null = null;
    try { start = draw.line.getPointAtLength(draw.length); } catch { start = null; }
    // 目的卡与这段的起点都已在可见画布里就不动镜头；要动时再给起点留一点边，取景不贴边。
    const around = (pad: number): Rect => {
      const left = Math.min(destination.x, start ? start.x - pad : Infinity), top = Math.min(destination.y, start ? start.y - pad : Infinity);
      const right = Math.max(destination.x + destination.width, start ? start.x + pad : -Infinity), bottom = Math.max(destination.y + destination.height, start ? start.y + pad : -Infinity);
      return { x: left, y: top, width: right - left, height: bottom - top };
    };
    const from = env.getViewport();
    const needed = computeRevealViewport(around(0), from, metrics, metrics.insets);
    const target = around(28 / Math.max(.1, env.zoom()));
    const next = needed && computeRevealViewport(target, from, metrics, metrics.insets);
    current.report.camera.push({ segment: index, target, from, to: next });
    if (!next) return;
    current.report.cameraMoves++;
    env.setViewport(next, { duration: Math.max(0, duration), ease: cameraEase, interpolate: 'linear' });
  }

  /**
   * 在来源卡的轨道上标出这条摘录的位置：轨道上写 `--trace-left` / `--trace-width`，加 `data-trace="arrive"`，
   * 由 trace.css 的 `::after` 画出那一格。轨道看不见（概览档）、格子数对不上或算不出位置时返回 { rail: null }。
   */
  function placeArrival(current: TraceRun, source: HTMLElement | null): { rail: HTMLElement | null; marks: Element[] } {
    const spot = arrivalSpot(env.board(), current.plan);
    const rail = source?.querySelector<HTMLElement>('.field-card__rail, .field-card__length-rail') ?? null;
    const quoteKey = escapeId(current.plan.quoteId ?? '');
    const marks = source && current.plan.quoteId ? [...source.querySelectorAll<HTMLElement>('mark[data-quote-id="' + quoteKey + '"], [data-edge-anchor="excerpt-row"][data-quote-id="' + quoteKey + '"]')]
      .filter(el => el.tagName === 'MARK' || !el.querySelector('mark[data-quote-id]')) : [];
    const targets: Element[] = [...marks];
    if (spot && rail) {
      let left = 0, width = 0;
      if (spot.rail === 'length') { left = spot.left; width = spot.width; }
      else {
        const data = env.board()?.nodes.find(n => n.id === current.plan.sourceId)?.data;
        const lines = data?.transcript ?? [];
        const total = data?.duration || lines.at(-1)?.end || 1;
        left = (lines[spot.first]?.start ?? 0) / total;
        width = ((lines[spot.last]?.end ?? total) - (lines[spot.first]?.start ?? 0)) / total;
      }
      rail.style.setProperty('--trace-left', String(Math.max(0, Math.min(1, left)) * 100) + '%');
      rail.style.setProperty('--trace-width', String(Math.max(0, Math.min(1 - left, width)) * 100) + '%');
      current.cleanup.push(() => { for (const name of ['--trace-left', '--trace-width']) rail.style.removeProperty(name); });
      targets.push(rail);
    }
    if (!targets.length && source) targets.push(source);
    for (const target of targets) target.classList.add('field-trace-arrival');
    current.cleanup.push(() => targets.forEach(target => target.classList.remove('field-trace-arrival')));
    const stamp = current.plan.quoteId ? nodeEl(env.root()!, current.plan.quoteId)?.querySelector<HTMLElement>('[data-edge-anchor="stamp"], .tag:not(.tag--mini)') : null;
    if (stamp) current.cleanup.push(stampElement(stamp, current.reduced));
    return { rail, marks: targets };
  }

  function frame() {
    const current = run;
    if (!current) return;
    const root = env.root();
    const t = now() - current.t0;
    const { schedule, plan, segments, marks } = current;
    if (!root || segments.some(segment => !segment.line.isConnected)) { stop(true); return; }
    const zoom = Math.max(.05, env.zoom());
    const fade = fadeOpacity(t, schedule);
    const lifted = t < schedule.fadeStart;

    // 卡片重新量端点时线绳的 d 会变：光跟着同一条路径走。
    for (const draw of segments) {
      const d = draw.line.getAttribute('d') ?? '';
      if (d && d !== draw.walk.getAttribute('d')) {
        for (const path of [draw.walk, ...draw.comets]) path.setAttribute('d', d);
        try { draw.length = draw.line.getTotalLength() || draw.length; } catch { /* keep the previous length */ }
      }
    }

    const start = nodeEl(root, plan.startId), source = nodeEl(root, plan.segments[plan.segments.length - 1].to);
    const quote = plan.quoteId ? nodeEl(root, plan.quoteId) : null;
    if (lifted) marks.add(start, 'start'); else marks.remove(start, 'start');
    if (plan.startId === plan.quoteId) {
      const origin = start?.querySelector('[data-edge-anchor="stamp"], .tag:not(.tag--mini)');
      if (lifted) marks.add(origin, 'start'); else marks.remove(origin, 'start');
    }
    if (plan.footnote !== undefined && plan.draftId) {
      const draft = nodeEl(root, plan.draftId);
      const key = escapeId(plan.quoteId ?? plan.sourceId);
      const row = draft?.querySelector(`[data-edge-anchor="para-ref"][data-cite-key="${key}"], [data-edge-anchor="stamp"][data-cite-key="${key}"], [data-footnote="${plan.footnote}"]`);
      const refs = draft ? [...draft.querySelectorAll('.field-card__ref')].filter(ref => ref.textContent?.trim() === String(plan.footnote)) : [];
      for (const element of [row, ...refs]) { if (lifted) marks.add(element, 'start'); else marks.remove(element, 'start'); }
    }
    // 经过的摘录卡（触发 B）：纸边一圈 --trace-walk，从光到达它起，到开始退色止。触发 A 的摘录是起点，只做起点提亮。
    if (quote && plan.startId !== plan.quoteId && !current.reduced) {
      const leaves = plan.segments.findIndex(segment => segment.from === plan.quoteId);
      const passFrom = leaves > 0 ? schedule.passes[leaves - 1]?.start ?? schedule.walks[leaves].start : Infinity;
      if (t >= passFrom && lifted) marks.add(quote, 'pass'); else marks.remove(quote, 'pass');
    }
    // Arrival outlines the actual marked excerpt and its existing yellow rail.
    const arriveUntil = current.reduced ? schedule.end : Math.min(schedule.end, schedule.arrive + ARRIVAL_HOLD);
    if (t >= schedule.arrive && t < arriveUntil) {
      current.arrival ??= placeArrival(current, source);
      const { rail } = current.arrival;
      marks.add(source, 'arrive');
      if (!rail) marks.add(source, 'arrive-ring');
    } else if (t >= arriveUntil) {
      marks.remove(source, "arrive"); marks.remove(source, "arrive-ring");
      for (const target of current.arrival?.marks ?? []) target.classList.remove("field-trace-arrival");
    }

    // Walked path: vermilion, 2 screen px; short moving head follows the same SVG path.
    const walking = activeWalk(t, schedule);
    segments.forEach((draw, index) => {
      const window = schedule.walks[index];
      const begun = current.reduced || (window && t >= window.start);
      if (!begun) { draw.group.setAttribute('visibility', 'hidden'); return; }
      if (current.reduced) { draw.group.setAttribute('visibility', 'hidden'); return; }
      draw.group.removeAttribute('visibility');
      if (!current.reduced && !draw.cameraDone && window) moveCamera(current, index, window.end - window.start);
      const linear = current.reduced ? 1 : walking?.index === index ? walking.linear : t >= window.end ? 1 : 0;
      const progress = current.reduced ? 1 : cameraEase(linear);
      draw.walk.setAttribute('stroke-width', String(TRACE_STROKE.walk / zoom));
      applyDash(draw.walk, walkedDash(draw.length, progress, fade));
      const comets = walking?.index === index ? cometDashes(draw.length, progress, zoom) : [];
      draw.comets.forEach((comet, cometIndex) => {
        comet.setAttribute('stroke-width', String(TRACE_STROKE.comet / zoom));
        applyDash(comet, comets[cometIndex] ?? null);
      });
      if (walking?.index === index && progress > 0 && progress < 1) {
        let point: DOMPoint | null = null;
        try { point = draw.line.getPointAtLength(frontAt(draw.length, progress)); } catch { point = null; }
        if (point) {
          draw.dot.removeAttribute('visibility');
          draw.dot.setAttribute('cx', String(point.x));
          draw.dot.setAttribute('cy', String(point.y));
          draw.dot.setAttribute('r', String(TRACE_STROKE.dot / zoom));
          draw.dot.setAttribute('stroke-width', String(TRACE_STROKE.dotRing / zoom));
        }
      } else draw.dot.setAttribute('visibility', 'hidden');
    });
    current.overlay.dataset.elapsed = String(Math.round(t));

    if (t >= schedule.open) callOpen(current);
    if (t >= schedule.end) { stop(false); return; }
    current.frame = requestAnimationFrame(frame);
  }

  function toSource(request: TraceRequest, open: () => void): boolean {
    if (run) stop(true);
    const root = env.root();
    let draftId = request.draftId, footnote = request.footnote;
    const recent = activation && now() - activation.at < ACTIVATION_WINDOW ? activation : null;
    const board = env.board();
    if (!draftId && recent?.nodeId && recent.nodeId !== request.quoteId && board?.nodes.some(node => node.id === recent.nodeId && node.data.kind === 'draft')) {
      draftId = recent.nodeId;
      footnote ??= recent.footnote;
    }
    activation = null;
    const plan = planTrace(board, { ...request, draftId, footnote });
    const lines = plan && root ? plan.segments.map(segment => edgeEl(root, segment.edgeId)?.querySelector<SVGPathElement>('.field-edge__line') ?? null) : [];
    const isReduced = reduced();
    if (!plan || !root || !lines.length || lines.some(line => !line) || !canvasUncovered(root)) { open(); return false; }
    const schedule = isReduced ? reducedTraceSchedule(readDuration('--dur-afterglow', REDUCED_HOLD) || REDUCED_HOLD) : traceSchedule(plan.segments.length, timing());
    const overlay = mountOverlay(root, 'field-trace', lines.map(line => line!.closest('.react-flow__edge')!).filter(Boolean));
    if (!overlay) { open(); return false; }
    const segments: SegmentDraw[] = lines.map(line => {
      const d = line!.getAttribute('d') ?? '';
      let length = 0;
      try { length = line!.getTotalLength(); } catch { length = 0; }
      const group = svgEl('g', 'field-trace__segment');
      const walk = svgEl('path', 'field-trace__walk');
      const comets = Array.from({ length: 6 }, () => svgEl('path', 'field-trace__comet'));
      const dot = svgEl('circle', 'field-trace__dot');
      for (const path of [walk, ...comets]) path.setAttribute('d', d);
      dot.setAttribute('visibility', 'hidden');
      group.append(walk, ...comets, dot);
      group.setAttribute('visibility', 'hidden');
      overlay.appendChild(group);
      return { line: line!, length, group, walk, comets, dot, cameraDone: false };
    });
    if (segments.some(segment => !(segment.length > 0))) { overlay.remove(); open(); return false; }
    overlay.dataset.segments = String(segments.length);
    const t0 = now();
    const report: TraceReport = { plan, reduced: isReduced, schedule, startedAt: t0, cameraMoves: 0, camera: [] };
    lastReport = report;
    run = { plan, schedule, reduced: isReduced, t0, open, opened: false, overlay, segments, marks: new Marks(), cleanup: [], frame: 0, report };
    listen(true);
    setTracingFlag(root, !isReduced);
    if (isReduced) callOpen(run);   // 减少动效：直接定位，来源处短暂静态亮起
    else {
      // 到达即打开（CORE-11）不依赖帧率：窗口被遮住或主线程忙时 requestAnimationFrame 会被节流，计时器兜底按时打开。
      const current = run;
      const timer = setTimeout(() => { if (run === current) callOpen(current); }, schedule.open);
      run.cleanup.push(() => clearTimeout(timer));
    }
    frame();
    return true;
  }

  // Existing public tie() contract now stamps; no edge hiding or geometry reads.
  const stamps = new Map<string, number>();
  const stampCleanups = new Set<() => void>();
  let stampTimer: ReturnType<typeof setTimeout> | null = null;
  function stampElement(element: HTMLElement, isReduced: boolean): () => void {
    element.classList.add('field-trace-stamp');
    const duration = isReduced ? REDUCED_HOLD : STAMP_TIMING.total;
    const animation = element.animate(isReduced
      ? [{ opacity: 1 }, { opacity: 1 }]
      : [{ opacity: 0 }, { opacity: 1, offset: 120 / 720 }, { opacity: 1, offset: 360 / 720 }, { opacity: 0 }],
      { duration, easing: 'linear', pseudoElement: '::after' });
    const cleanup = () => { animation.cancel(); element.classList.remove('field-trace-stamp'); stampCleanups.delete(cleanup); };
    stampCleanups.add(cleanup);
    void animation.finished.then(cleanup, () => {});
    return cleanup;
  }
  function stampTick() {
    stampTimer = null;
    const root = env.root();
    if (!root) { stamps.clear(); return; }
    for (const [id, createdAt] of stamps) {
      if (now() - createdAt > TIE_WAIT_LIMIT) { stamps.delete(id); continue; }
      if (now() - createdAt < (reduced() ? 0 : TIE_AFTER_LANDING) || root.closest('.is-moving')) continue;
      const stamp = nodeEl(root, id)?.querySelector<HTMLElement>('[data-edge-anchor="stamp"], .tag:not(.tag--mini)');
      if (!stamp) continue;
      stamps.delete(id); stampElement(stamp, reduced());
    }
    if (stamps.size) stampTimer = setTimeout(stampTick, 60);
  }
  function tie(quoteIds: readonly string[]) {
    if (typeof document === 'undefined') return;
    for (const id of quoteIds) if (!stamps.has(id)) stamps.set(id, now());
    if (stamps.size && !stampTimer) stampTimer = setTimeout(stampTick, 0);
  }
  // ── 新卡落位（减少动效时保留外环） ─────────────────────────────────────────

  function land(ids: readonly string[]) {
    if (!ids.length || !reduced() || typeof document === 'undefined') return;
    const begin = now();
    const pending = new Set(ids);
    const tick = () => {
      const root = env.root();
      if (!root) return;
      for (const id of [...pending]) {
        const card = nodeEl(root, id)?.querySelector<HTMLElement>('.field-card.is-fresh');
        if (!card || typeof card.animate !== 'function') continue;
        pending.delete(id);
        // 旧样式在减少动效时把所有动画压到 0.01ms；外环只是透明度变化，按 §7 保留 1200ms 淡出。
        card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1200, easing: 'cubic-bezier(.22,1,.36,1)', pseudoElement: '::after' });
      }
      if (pending.size && now() - begin < 1000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  return {
    toSource,
    tie,
    land,
    finish: () => stop(true),
    isTracing: () => run !== null,
    attach() {
      if (typeof document === 'undefined') return () => {};
      document.addEventListener('pointerdown', remember, true);
      document.addEventListener('keydown', remember, true);
      return () => {
        document.removeEventListener('pointerdown', remember, true);
        document.removeEventListener('keydown', remember, true);
        stop(true, true);
        stamps.clear(); if (stampTimer) clearTimeout(stampTimer); stampTimer = null;
        for (const cleanup of [...stampCleanups]) cleanup();
      };
    },
  };
}
