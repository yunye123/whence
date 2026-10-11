/**
 * 全画布的线绳几何与标签位置，一次算完、按输入缓存（卡片数组、连线数组、端点测量版本、标签缩放档）。
 * 每条线的组件只取自己的那一份；没变的条目复用上一次的对象，所以拖动一张卡时只有相关的线重画。
 */
import type { ReactFlowState } from '@xyflow/react';
import type { BoardNode, CardData } from '../../model';
import { edgeGeometry, getNodeAnchors, type EdgeEndNode, type EdgeGeometry, type EdgeLod } from './anchors';
import { boxContains, cubicAt, type Box, type Cubic, type Point } from './geometry';
import { FAN_OUT_T, labelSize, MERGE_T, MID_T, placeLabels, type LabelRequest, type Obstacle, type PlacedLabel } from './labels';
import { classifyStoredEdge, type FieldEdgeData, type FieldEdgeEmphasis } from './model';

export interface LayoutNode extends EdgeEndNode { frame?: boolean }
export interface LayoutEdge { id: string; data: FieldEdgeData; selected?: boolean }

export interface EdgeLabelLayout {
  key: string;
  /** 负责画这个标签的线（组内第一条）。 */
  owner: string;
  members: string[];
  text: string;
  kind: FieldEdgeData['kind'];
  center: Point;
  box: Box;
  scale: number;
  clean: boolean;
  /** 组内任一条点亮 → lit；全部压暗 → dim。 */
  emphasis?: FieldEdgeEmphasis;
  selected: boolean;
  /** 线上离标签最近的点（线的操作条据此放在标签背离线的一侧）。 */
  anchor: Point;
  /** 标签离线较远时（短线、附近没有空位），从标签边到线上那一点的一段引出线。 */
  leader?: { from: Point; to: Point };
}
export interface EdgeLayout {
  geometry: Map<string, EdgeGeometry>;
  /** 按 owner 的边 id 取。 */
  labels: Map<string, EdgeLabelLayout>;
  /** 按标签组 key 的放置结果（含输入签名），供下一次沿用。 */
  placements: Map<string, PlacedLabel>;
}

/** 分组托盘的标签贴在托盘上沿之外（§6.15），高 26。 */
const FRAME_TAB_HEIGHT = 26;
const FRAME_TAB_WIDTH = 200;

const center = (box: Box): Box => ({ x: box.x + box.width / 2 - 1, y: box.y + box.height / 2 - 1, width: 2, height: 2 });

export function computeEdgeLayout(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], labelScale = 1, previous?: EdgeLayout): EdgeLayout {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const geometry = new Map<string, EdgeGeometry>();
  const groups = new Map<string, { edges: LayoutEdge[]; text: string }>();
  for (const edge of edges) {
    const from = byId.get(edge.data.from), to = byId.get(edge.data.to);
    if (!from || !to || from.id === to.id) continue;
    geometry.set(edge.id, edgeGeometry(edge.data, from, to));
    const text = edge.data.label?.trim();
    if (!text) continue;
    const key = edge.data.labelGroup ?? `edge:${edge.id}`;
    const group = groups.get(key);
    if (group) group.edges.push(edge); else groups.set(key, { edges: [edge], text });
  }

  const frames = nodes.filter(node => node.frame);
  const obstacles: Obstacle[] = [];
  for (const node of nodes) {
    obstacles.push({ id: node.id, box: node.box });
    if (node.frame) obstacles.push({ id: `${node.id}:tab`, box: { x: node.box.x, y: node.box.y - FRAME_TAB_HEIGHT, width: Math.min(node.box.width, FRAME_TAB_WIDTH), height: FRAME_TAB_HEIGHT } });
  }

  const requests: LabelRequest[] = [];
  const meta = new Map<string, { owner: string; members: string[]; text: string; kind: FieldEdgeData['kind']; emphasis?: FieldEdgeEmphasis; selected: boolean }>();
  for (const [key, group] of groups) {
    const kind = group.edges[0].data.kind;
    const tOrder = kind === 'cite' ? MERGE_T : group.edges.length > 1 ? FAN_OUT_T : MID_T;
    const paths = group.edges.map(edge => ({ curve: geometry.get(edge.id)!.curve, tOrder }));
    // A thread that runs inside a grouping tray may carry its label inside that tray.
    const ignore = new Set<string>();
    for (const edge of group.edges) {
      for (const id of [edge.data.from, edge.data.to]) {
        const node = byId.get(id);
        if (!node) continue;
        for (const frame of frames) if (frame.id === id || boxContains(frame.box, center(node.box))) ignore.add(frame.id);
      }
    }
    const { width, height } = labelSize(group.text, labelScale);
    const centres = group.edges.flatMap(edge => [byId.get(edge.data.from)!, byId.get(edge.data.to)!]).map(node => ({ x: node.box.x + node.box.width / 2, y: node.box.y + node.box.height / 2 }));
    const lean = { x: centres.reduce((sum, p) => sum + p.x, 0) / centres.length, y: centres.reduce((sum, p) => sum + p.y, 0) / centres.length };
    requests.push({ key, width, height, paths, ignore, lean });
    const tones = group.edges.map(edge => edge.data.emphasis);
    const emphasis = tones.includes('lit') ? 'lit' : tones.length && tones.every(tone => tone === 'dim') ? 'dim' : undefined;
    meta.set(key, { owner: group.edges[0].id, members: group.edges.map(edge => edge.id), text: group.text, kind, emphasis, selected: group.edges.some(edge => edge.selected) });
  }
  const placed = placeLabels(requests, obstacles, undefined, previous?.placements);
  const curvesByKey = new Map(requests.map(request => [request.key, request.paths.map(path => path.curve)] as const));
  const labels = new Map<string, EdgeLabelLayout>();
  for (const [key, label] of placed) {
    const info = meta.get(key)!;
    const { anchor, leader } = labelTether(label.box, curvesByKey.get(key) ?? [], labelScale, !!label.detached);
    labels.set(info.owner, { key, ...info, center: label.center, box: label.box, scale: labelScale, clean: label.clean, anchor, leader });
  }
  return { geometry, labels, placements: placed };
}

/** 标签边离线超过这个值（画布单位，随标签缩放）才画引出线；“中点上方 14px”的标签离线约 3px。 */
export const LEADER_GAP = 12;
/** 短于这个弦长（画布单位）的线：两侧放不下标签，标签总是离开中点，要用引出线系回去。 */
export const SHORT_THREAD = 120;

/**
 * 标签与它说明的线之间的牵连（CANVAS-12）：线上离标签最近的点，以及一段引出线（从标签框边缘到那一点，两端各
 * 留 2px）。只给两种标签画：短线上的（两张卡挨得近，标签只能停到旁边的空处，靠近哪张卡都像在说那张卡），
 * 和线旁实在放不下、停到附近空处的（`detached`）。长线上贴着线放的标签不画，免得到处是小短线。
 * 系点只取线的中段（两端各让出 TETHER_END）：线头压在卡片边缘下面，系到那里的引出线会从卡片底下伸出来、另一头
 * 悬空，读成卡角上的一根小刺（第 4 轮打磨：“写进第 2 段”“写进第 8 段”）。
 */
export const TETHER_END = .15;
export function labelTether(box: Box, curves: readonly Cubic[], scale = 1, detached = true): { anchor: Point; leader?: { from: Point; to: Point } } {
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const edgePoint = (p: Point): Point => ({ x: Math.min(Math.max(p.x, box.x), box.x + box.width), y: Math.min(Math.max(p.y, box.y), box.y + box.height) });
  let anchor = centre, onBox = centre, best = Infinity;
  for (const curve of curves) {
    for (let i = 0; i <= 48; i++) {
      const point = cubicAt(curve, TETHER_END + (1 - 2 * TETHER_END) * i / 48);
      const near = edgePoint(point);
      const distance = Math.hypot(point.x - near.x, point.y - near.y);
      if (distance < best) { best = distance; anchor = point; onBox = near; }
    }
  }
  const short = curves.some(curve => Math.hypot(curve.p1.x - curve.p0.x, curve.p1.y - curve.p0.y) < SHORT_THREAD);
  if (!(detached || short) || best <= LEADER_GAP * scale) return { anchor };
  const dx = anchor.x - onBox.x, dy = anchor.y - onBox.y;
  const unit = { x: dx / best, y: dy / best };
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    anchor,
    leader: {
      from: { x: round(onBox.x + unit.x * 2), y: round(onBox.y + unit.y * 2) },
      to: { x: round(anchor.x - unit.x * 2), y: round(anchor.y - unit.y * 2) },
    },
  };
}

// ── React Flow 状态 → 布局 ───────────────────────────────────────────────

export const LOD_SIMPLE_MIN = 0.5;
export const LOD_FULL_MIN = 0.86;
export const lodForZoom = (zoom: number): EdgeLod => (zoom >= LOD_FULL_MIN ? 'full' : zoom >= LOD_SIMPLE_MIN ? 'simple' : 'far');
export const selectEdgeLod = (state: ReactFlowState): EdgeLod => lodForZoom(state.transform[2]);

/** 量化缩放 `--z-tier = floor(zoom × 20) / 20`（§0 规则 4）。 */
export const zoomTier = (zoom: number): number => Math.max(0.05, Math.floor(zoom * 20 + 1e-6) / 20);
/**
 * 标签字号补偿：屏幕上不小于 12px（中文下限，§0 规则 6），平常是 12px。
 * 概览档不显示标签，固定为 1，免得缩放时反复重排。
 */
export function labelScaleForZoom(zoom: number): number {
  if (zoom < LOD_SIMPLE_MIN) return 1;
  return Math.max(1, Math.ceil(100 / zoomTier(zoom)) / 100);
}

interface Cache { nodes: unknown; edges: unknown; version: number; scale: number; layout: EdgeLayout }
let last: Cache | null = null;

function layoutNodes(state: ReactFlowState): { nodes: LayoutNode[]; board: Map<string, BoardNode> } {
  const nodes: LayoutNode[] = [];
  const board = new Map<string, BoardNode>();
  for (const node of state.nodeLookup.values()) {
    const width = node.measured?.width ?? node.width ?? 0;
    const height = node.measured?.height ?? node.height ?? 0;
    const data = node.data as CardData | undefined;
    if (data) board.set(node.id, { id: node.id, type: 'card', position: node.position, data });
    if (!width || !height) continue;
    nodes.push({
      id: node.id, kind: data?.kind, frame: data?.kind === 'frame',
      box: { x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y, width, height },
      anchors: getNodeAnchors(node.id), versions: data?.draftVersions?.length ?? 0,
    });
  }
  return { nodes, board };
}

/** App 还没换成 useFieldFlowEdges 时（edges 没有 data.kind），按卡片数据现场分类，至少画对样式。 */
function layoutEdges(state: ReactFlowState, board: Map<string, BoardNode>): LayoutEdge[] {
  return state.edges.map(edge => {
    const data = edge.data as FieldEdgeData | undefined;
    if (data?.kind) return { id: edge.id, data, selected: !!edge.selected };
    const info = classifyStoredEdge(edge, board);
    const label = typeof edge.label === 'string' ? edge.label : undefined;
    return { id: edge.id, selected: !!edge.selected, data: { kind: info.kind, derived: false, from: info.from, to: info.to, label, labelGroup: label ? `edge:${edge.id}` : undefined } };
  });
}

const sameGeometry = (a: EdgeGeometry, b: EdgeGeometry) => a.d === b.d && a.tie === b.tie && a.kind === b.kind;
const sameLabel = (a: EdgeLabelLayout, b: EdgeLabelLayout) => a.key === b.key && a.text === b.text && a.center.x === b.center.x && a.center.y === b.center.y
  && a.scale === b.scale && a.emphasis === b.emphasis && a.selected === b.selected && a.clean === b.clean && a.members.join() === b.members.join()
  && a.anchor.x === b.anchor.x && a.anchor.y === b.anchor.y && a.leader?.from.x === b.leader?.from.x && a.leader?.from.y === b.leader?.from.y
  && a.leader?.to.x === b.leader?.to.x && a.leader?.to.y === b.leader?.to.y;

export function selectEdgeLayout(state: ReactFlowState, version: number): EdgeLayout {
  const scale = labelScaleForZoom(state.transform[2]);
  if (last && last.nodes === state.nodes && last.edges === state.edges && last.version === version && last.scale === scale) return last.layout;
  const { nodes, board } = layoutNodes(state);
  // Labels whose inputs did not change keep their spot (no jumping while an unrelated card is dragged).
  const next = computeEdgeLayout(nodes, layoutEdges(state, board), scale, last?.layout);
  if (last) {
    for (const [id, geometry] of next.geometry) {
      const old = last.layout.geometry.get(id);
      if (old && sameGeometry(old, geometry)) next.geometry.set(id, old);
    }
    for (const [id, label] of next.labels) {
      const old = last.layout.labels.get(id);
      if (old && sameLabel(old, label)) next.labels.set(id, old);
    }
  }
  last = { nodes: state.nodes, edges: state.edges, version, scale, layout: next };
  return next;
}
