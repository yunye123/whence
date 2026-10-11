/**
 * 连线标签避让（DESIGN_SYSTEM.md §6.17、AUDIT_BACKLOG EG-M1）：标签永远不压在任何卡片上，标签之间也不互相压住。
 * 顺序：先放在中点上方 14px；与卡片相交时沿路径在 t ∈ [0.3, 0.7] 每 0.05 试一次；再试线的下方和两侧空处；
 * 仍不行就扩大 t 范围，最后在附近螺旋搜索最近的空位。纯函数，坐标是画布坐标。
 */
import { boxesIntersect, cubicAt, cubicTangentAt, overlapArea, type Box, type Cubic, type Point } from './geometry';

/** 标签字号 12 / 行高 18、内边距 0 / 7（§6.17）。 */
export const LABEL_FONT_PX = 12;
export const LABEL_HEIGHT = 18;
export const LABEL_PAD_X = 7;
/** 超过这个宽度的用户标签在界面上省略，完整文字留在 title 与 aria-label 里。 */
export const LABEL_MAX_TEXT_WIDTH = 168;
/** 中点上方 14px（标签中心到线的距离）。 */
export const LABEL_OFFSET = 13;
/** 标签与卡片、标签与标签之间至少留出的距离。 */
export const LABEL_MARGIN = 4;

export const MID_T: readonly number[] = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7];
/** 同一来源扇出的几条摘录线共用一个标签：放在扇出处（靠近来源一端）。 */
export const FAN_OUT_T: readonly number[] = [0.35, 0.3, 0.4, 0.25, 0.45, 0.5, 0.2, 0.55, 0.6, 0.65, 0.7];
/** 汇入同一段的几条引用线共用一个标签：放在汇合处（靠近文稿一端）。 */
export const MERGE_T: readonly number[] = [0.75, 0.8, 0.7, 0.85, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3];
const WIDE_T: readonly number[] = [0.25, 0.75, 0.2, 0.8, 0.15, 0.85, 0.1, 0.9];

const DIGIT = /[0-9]/;
const WIDE_CHAR = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3fffd}]/u;

/** 文字宽度估算（思源黑体 12px 中文 1em；数字用 IBM Plex Mono 12px）。保守估计，避让时另有 4px 余量。 */
export function estimateTextWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    if (DIGIT.test(character)) width += 7.4;
    else if (WIDE_CHAR.test(character)) width += LABEL_FONT_PX;
    else if (character === ' ') width += 3.6;
    else width += 7.6;
  }
  return Math.ceil(width);
}

export function labelSize(text: string, scale = 1): { width: number; height: number } {
  const paragraph = /^写进第 (\d+) 段$/.exec(text)?.[1];
  const width = Math.min(paragraph ? 24 + 4 + Math.max(18, estimateTextWidth(paragraph) + 4) : estimateTextWidth(text), LABEL_MAX_TEXT_WIDTH) + LABEL_PAD_X * 2;
  return { width: Math.ceil(width * scale), height: Math.ceil(LABEL_HEIGHT * scale) };
}

export interface LabelPath { curve: Cubic; tOrder?: readonly number[] }
export interface LabelRequest {
  key: string;
  width: number;
  height: number;
  /** 共用这个标签的线（扇出或汇合的一组）；单条线就是一项。 */
  paths: LabelPath[];
  /** 避让时忽略的障碍（例如包含端点卡片的分组托盘：线本来就在托盘里）。 */
  ignore?: ReadonlySet<string>;
  /** 线两端卡片的中心：放在线旁边时，两侧都空就靠向这一侧，标签跟着它说明的那组卡片，不跑到画面边缘。 */
  lean?: Point;
}
export interface Obstacle { id: string; box: Box }
export interface PlacedLabel {
  key: string; box: Box; center: Point;
  /** false = 附近没有空位，取了重叠最少的位置。 */
  clean: boolean;
  /** 线旁（上方、下方、两侧）都放不下，停到了附近的空处：画布上要用引出线把它系回线上（CANVAS-12）。 */
  detached?: boolean;
  /** 输入签名（尺寸、路径、附近障碍）：没变时下一次直接沿用位置，拖动无关卡片时标签不跳、也不重算。 */
  signature: string;
}

const boxAt = (center: Point, width: number, height: number): Box => ({ x: center.x - width / 2, y: center.y - height / 2, width, height });

const SEARCH_REACH = 640;
const r1 = (value: number) => Math.round(value);

/**
 * 依次放置标签；先放的标签成为后放标签的障碍。结果按 key 返回。
 * 传入上一次的结果时，输入签名没变、旧位置也没被前面的标签占住的标签直接沿用旧位置。
 */
export function placeLabels(requests: readonly LabelRequest[], obstacles: readonly Obstacle[], margin = LABEL_MARGIN, previous?: ReadonlyMap<string, PlacedLabel>): Map<string, PlacedLabel> {
  const placed = new Map<string, PlacedLabel>();
  const taken: Box[] = [];
  for (const request of requests) {
    if (!request.paths.length) continue;
    const ignore = request.ignore;
    const active = ignore?.size ? obstacles.filter(item => !ignore.has(item.id)) : obstacles;
    // Only obstacles near the paths matter: a corridor around the curves' control hull.
    const near = nearbyObstacles(request, active, Math.max(request.width, request.height) + SEARCH_REACH);
    const signature = [
      request.width, request.height, request.lean ? `${r1(request.lean.x)},${r1(request.lean.y)}` : '',
      ...request.paths.map(({ curve, tOrder }) => (curve.routePoints ?? [curve.p0, curve.c1, curve.c2, curve.p1]).map(p => `${r1(p.x)},${r1(p.y)}`).join(' ') + (tOrder?.[0] ?? '')),
      ...near.map(item => `${item.id}:${r1(item.box.x)},${r1(item.box.y)},${r1(item.box.width)},${r1(item.box.height)}`),
    ].join('|');
    const old = previous?.get(request.key);
    const result = old && old.signature === signature && !taken.some(box => boxesIntersect(old.box, box, margin))
      ? old
      : { ...placeOne(request, near, taken, margin), signature };
    placed.set(request.key, result);
    taken.push(result.box);
  }
  return placed;
}

function placeOne(request: LabelRequest, near: readonly Obstacle[], taken: readonly Box[], margin: number): Omit<PlacedLabel, 'signature'> {
  const { width, height } = request;
  // The label should not sit on its own thread either (soft rule: preferred, not required).
  const samples = request.paths.flatMap(({ curve }) => Array.from({ length: 33 }, (_, i) => cubicAt(curve, i / 32)));
  const hardCost = (box: Box) => {
    let cost = 0;
    for (const item of near) if (boxesIntersect(box, item.box, margin)) cost += overlapArea(box, inflate(item.box, margin)) * 10 + 1;
    for (const item of taken) if (boxesIntersect(box, item, margin)) cost += overlapArea(box, inflate(item, margin)) + 1;
    return cost;
  };
  const softCost = (box: Box) => {
    const area = inflate(box, 2);
    let cost = 0;
    for (const p of samples) if (p.x > area.x && p.x < area.x + area.width && p.y > area.y && p.y < area.y + area.height) cost++;
    return cost;
  };
  let free: { center: Point; soft: number } | null = null;
  let fallback: { center: Point; hard: number } | null = null;
  const consider = (center: Point): boolean => {
    const box = boxAt(center, width, height);
    const hard = hardCost(box);
    if (hard > 0) { if (!fallback || hard < fallback.hard) fallback = { center, hard }; return false; }
    const soft = softCost(box);
    if (!free || soft < free.soft) free = { center, soft };
    return soft === 0;
  };

  const tried = (orders: (path: LabelPath) => readonly number[], offsets: (point: Point, tangent: Point) => Point[]) => {
    for (const path of request.paths) {
      for (const t of orders(path)) {
        const point = cubicAt(path.curve, t);
        const tangent = cubicTangentAt(path.curve, t);
        for (const center of offsets(point, tangent)) if (consider(center)) return true;
      }
    }
    return false;
  };
  const preferred = (path: LabelPath) => path.tOrder ?? MID_T;
  const above = (point: Point) => [{ x: point.x, y: point.y - height / 2 - 4 }];
  const below = (point: Point) => [{ x: point.x, y: point.y + height / 2 + 4 }];
  // Beside the line, far enough that the label box clears the stroke, on either side. The inner side (towards the
  // cards the thread connects; without a lean point, the emptier side) is preferred: an outer-side spot only wins
  // when it is more than three steps closer to the preferred t, so labels stay with their cards instead of drifting
  // to the edge of the composition, yet a fan-out label still sits near the fan.
  const besideBest = (orders: (path: LabelPath) => readonly number[]): boolean => {
    let chosen: { center: Point; rank: number } | null = null;
    for (const path of request.paths) {
      orders(path).forEach((t, index) => {
        const point = cubicAt(path.curve, t);
        const tangent = cubicTangentAt(path.curve, t);
        const normal = { x: -tangent.y, y: tangent.x };
        const reach = Math.abs(normal.x) * width / 2 + Math.abs(normal.y) * height / 2 + 4;
        const at = (sign: number, extra: number) => ({ x: point.x + normal.x * (reach + extra) * sign, y: point.y + normal.y * (reach + extra) * sign });
        const lean = request.lean;
        const score = (sign: number) => (lean ? -Math.hypot(at(sign, 0).x - lean.x, at(sign, 0).y - lean.y) : clearance(at(sign, 0), near));
        const inner = score(1) >= score(-1) ? 1 : -1;
        for (const [sign, penalty] of [[inner, 0], [-inner, 3.5]] as const) {
          const rank = index + penalty;
          if (chosen && chosen.rank <= rank) continue;
          // A slanted thread can still clip a corner of the box: step a little further out on the same side.
          for (const extra of [0, 8, 16]) {
            const center = at(sign, extra);
            if (consider(center)) { chosen = { center, rank }; break; }
          }
        }
      });
    }
    if (chosen) free = { center: (chosen as { center: Point }).center, soft: 0 };
    return !!chosen;
  };
  const wide = (path: LabelPath) => [...preferred(path), ...WIDE_T.filter(t => !preferred(path).includes(t))];

  if (tried(preferred, above) || tried(preferred, below) || besideBest(preferred)
    || tried(wide, above) || tried(wide, below) || besideBest(wide)) {
    return finish(request.key, free!.center, width, height, true);
  }
  // Free of cards but touching its own thread is acceptable before searching further away.
  if (free) return finish(request.key, (free as { center: Point }).center, width, height, true);
  // Spiral outwards from the preferred point until a free spot appears.
  const origin = cubicAt(request.paths[0].curve, preferred(request.paths[0])[0]);
  for (let radius = 24; radius <= SEARCH_REACH - 24; radius += 16) {
    const steps = Math.max(12, Math.round(radius / 8));
    for (let i = 0; i < steps; i++) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
      consider({ x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius });
      if (free) return finish(request.key, (free as { center: Point }).center, width, height, true, true);
    }
  }
  return finish(request.key, (fallback as { center: Point } | null)?.center ?? origin, width, height, false, true);
}

function finish(key: string, point: Point, width: number, height: number, clean: boolean, detached = false): Omit<PlacedLabel, 'signature'> {
  const center = { x: Math.round(point.x * 2) / 2, y: Math.round(point.y * 2) / 2 };
  return { key, center, box: boxAt(center, width, height), clean, ...(detached ? { detached } : {}) };
}

const inflate = (box: Box, by: number): Box => ({ x: box.x - by, y: box.y - by, width: box.width + by * 2, height: box.height + by * 2 });

function clearance(point: Point, obstacles: readonly Obstacle[]): number {
  let nearest = Infinity;
  for (const { box } of obstacles) {
    const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
    const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
    nearest = Math.min(nearest, Math.hypot(dx, dy));
  }
  return nearest;
}

function nearbyObstacles(request: LabelRequest, obstacles: readonly Obstacle[], reach: number): Obstacle[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { curve } of request.paths) {
    for (const p of [curve.p0, curve.c1, curve.c2, curve.p1]) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
  }
  const area: Box = { x: minX - reach, y: minY - reach, width: maxX - minX + reach * 2, height: maxY - minY + reach * 2 };
  return obstacles.filter(item => boxesIntersect(item.box, area));
}
