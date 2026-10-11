/**
 * 墨线几何（PLAN §2.7）：右方留足空间时走圆角正交线；上下、反向和近距离沿用兼容曲线。
 * 全部是纯函数，坐标都是画布（flow）坐标。
 */

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }
export interface Cubic { p0: Point; c1: Point; c2: Point; p1: Point; routePoints?: Point[] }
export type Side = 'left' | 'right' | 'top' | 'bottom';

const OUTWARD: Record<Side, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };
const horizontal = (side: Side) => side === 'left' || side === 'right';

/** 中段下垂量：`sag = min(26, 距离 × 0.14)`。 */
export function threadSag(a: Point, b: Point): number {
  return Math.min(26, Math.hypot(b.x - a.x, b.y - a.y) * 0.14);
}

/**
 * 从 a 的 startSide 出发、从 endSide 一侧进入 b 的线绳。
 * 两端都水平时就是 §6.17 的公式：`k = max(|dx|×0.42, 18)`，两个控制点同时下垂 sag；
 * 两端都垂直时 `k = max(|dy|×0.42, 18)`、不下垂；一横一竖时各自按所在轴取 k。
 */
export function threadCurve(a: Point, startSide: Side, b: Point, endSide: Side): Cubic {
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  const k1 = Math.max((horizontal(startSide) ? dx : dy) * 0.42, 18);
  const k2 = Math.max((horizontal(endSide) ? dx : dy) * 0.42, 18);
  const sag = horizontal(startSide) && horizontal(endSide) ? threadSag(a, b) : 0;
  const o1 = OUTWARD[startSide], o2 = OUTWARD[endSide];
  return {
    p0: a,
    c1: { x: a.x + o1.x * k1, y: a.y + o1.y * k1 + sag },
    c2: { x: b.x + o2.x * k2, y: b.y + o2.y * k2 + sag },
    p1: b,
  };
}

/** 近距离或反向引用的兼容曲线：两端切线朝纸外，不下垂。 */
export function dropCurve(a: Point, startSide: Side, b: Point, endSide: Side): Cubic {
  const k = Math.max(Math.abs(b.x - a.x) * 0.9, 24);
  const o1 = OUTWARD[startSide], o2 = OUTWARD[endSide];
  return { p0: a, c1: { x: a.x + o1.x * k, y: a.y + o1.y * k }, c2: { x: b.x + o2.x * k, y: b.y + o2.y * k }, p1: b };
}

const round = (value: number) => Math.round(value * 10) / 10;

export function cubicPath(curve: Cubic): string {
  const { p0, c1, c2, p1 } = curve;
  return `M${round(p0.x)} ${round(p0.y)}C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(p1.x)} ${round(p1.y)}`;
}

export function cubicAt(curve: Cubic, t: number): Point {
  if (curve.routePoints) {
    const points = curve.routePoints;
    const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
    let distance = Math.min(1, Math.max(0, t)) * lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lengths.length; i++) {
      if (distance <= lengths[i] || i === lengths.length - 1) {
        const fraction = lengths[i] ? distance / lengths[i] : 0;
        return { x: points[i].x + (points[i + 1].x - points[i].x) * fraction, y: points[i].y + (points[i + 1].y - points[i].y) * fraction };
      }
      distance -= lengths[i];
    }
    return curve.p1;
  }
  const { p0, c1, c2, p1 } = curve, u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * c1.x + c * c2.x + d * p1.x, y: a * p0.y + b * c1.y + c * c2.y + d * p1.y };
}

/** 单位切向量；退化时返回水平向右。 */
export function cubicTangentAt(curve: Cubic, t: number): Point {
  if (curve.routePoints) {
    const a = cubicAt(curve, Math.max(0, t - .0001)), b = cubicAt(curve, Math.min(1, t + .0001));
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return length ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length } : { x: 1, y: 0 };
  }
  const { p0, c1, c2, p1 } = curve, u = 1 - t;
  const x = 3 * u * u * (c1.x - p0.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (p1.x - c2.x);
  const y = 3 * u * u * (c1.y - p0.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (p1.y - c2.y);
  const length = Math.hypot(x, y);
  return length < 1e-6 ? { x: 1, y: 0 } : { x: x / length, y: y / length };
}

/** 采样得到的包围盒（控制点凸包内，足够用来做粗筛）。 */
export function cubicBounds(curve: Cubic, samples = 16): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i <= samples; i++) {
    const p = cubicAt(curve, i / samples);
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function sidePoint(box: Box, side: Side): Point {
  switch (side) {
    case 'left': return { x: box.x, y: box.y + box.height / 2 };
    case 'right': return { x: box.x + box.width, y: box.y + box.height / 2 };
    case 'top': return { x: box.x + box.width / 2, y: box.y };
    default: return { x: box.x + box.width / 2, y: box.y + box.height };
  }
}

export const oppositeSide: Record<Side, Side> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

/**
 * 卡边中点之间该走哪两条边：两卡之间横向空隙不小于纵向空隙时左右出入，否则上下出入（§6.17“dy > dx 时”）。
 * 返回起点卡的出边；终点卡的入边是它的对边。
 */
export function chooseSide(from: Box, to: Box): Side {
  const gapX = Math.max(to.x - (from.x + from.width), from.x - (to.x + to.width));
  const gapY = Math.max(to.y - (from.y + from.height), from.y - (to.y + to.height));
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  if (gapY > gapX && gapY > 0) return toCenter.y >= fromCenter.y ? 'bottom' : 'top';
  return toCenter.x >= fromCenter.x ? 'right' : 'left';
}

export function boxesIntersect(a: Box, b: Box, margin = 0): boolean {
  return a.x - margin < b.x + b.width && b.x < a.x + a.width + margin
    && a.y - margin < b.y + b.height && b.y < a.y + a.height + margin;
}

export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function boxContains(outer: Box, inner: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/** PLAN 2.7: horizontal, vertical, horizontal, with radii no larger than 8. */
export function inkRoute(start: Point, startSide: Side, end: Point, endSide: Side, cite = false): { curve: Cubic; d: string } {
  if (end.x - start.x < 24 || startSide !== 'right' || endSide !== 'left') {
    const curve = cite ? dropCurve(start, startSide, end, endSide) : threadCurve(start, startSide, end, endSide);
    return { curve, d: cubicPath(curve) };
  }
  const mid = (start.x + end.x) / 2, dy = end.y - start.y, sign = Math.sign(dy);
  const radius = Math.min(8, Math.abs(dy) / 2, (end.x - start.x) / 4);
  const before = { x: mid - radius, y: start.y }, after = { x: mid + radius, y: end.y };
  const points: Point[] = [start, before];
  const corner = (a: Point, control: Point, b: Point) => {
    for (let i = 1; i <= 8; i++) {
      const t = i / 8, u = 1 - t;
      points.push({ x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y });
    }
  };
  const first = { x: mid, y: start.y + sign * radius }, last = { x: mid, y: end.y - sign * radius };
  corner(before, { x: mid, y: start.y }, first);
  points.push(last);
  corner(last, { x: mid, y: end.y }, after);
  points.push(end);
  const d = radius === 0 ? `M${start.x} ${start.y}L${end.x} ${end.y}`
    : `M${start.x} ${start.y}L${before.x} ${before.y}Q${mid} ${start.y} ${first.x} ${first.y}L${last.x} ${last.y}Q${mid} ${end.y} ${after.x} ${after.y}L${end.x} ${end.y}`;
  return { curve: { p0: start, c1: { x: mid, y: start.y }, c2: { x: mid, y: end.y }, p1: end, routePoints: points }, d };
}
