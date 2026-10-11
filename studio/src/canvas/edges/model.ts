/**
 * 三种线（DESIGN_SYSTEM.md §6.17）与它们的数据：
 * - 摘录线（来源 → 摘录）：已保存的连线，目标是摘录卡且摘录的 citation 指向起点。
 * - 引用线（摘录 → 文稿）：由文稿正文里的引用派生，只读，不写进存储、不进撤销历史；引用删除后消失（EG-M3）。
 * - 我画的关系：其余已保存的连线，可加标签。
 * 连线的存储契约（K1：`type`、`label`）不变；这里只决定怎么画。
 */
import type { Board, BoardEdge, BoardNode, CardData } from '../../model';
import { parseDraftReferences } from '../../draft-references';
import { draftParagraphIndexAt, quoteDisplayTitle } from '../../source-location';

export type FieldEdgeKind = 'excerpt' | 'cite' | 'pencil';
export type FieldEdgeEmphasis = 'lit' | 'dim';

/** 派生引用线的 id 前缀与类型名；`cite:` 不会与 crypto.randomUUID() 的存储 id 冲突。 */
export const CITE_EDGE_PREFIX = 'cite:';
export const CITE_EDGE_TYPE = 'fieldCite';
export const isDerivedEdgeId = (id: string): boolean => id.startsWith(CITE_EDGE_PREFIX);

export interface FieldEdgeData extends Record<string, unknown> {
  kind: FieldEdgeKind;
  /** 由文稿引用派生（只读）。 */
  derived: boolean;
  /** 画线的方向：摘录线从来源到摘录，引用线从摘录到文稿；反向保存的连线照样按来历方向画。 */
  from: string;
  to: string;
  /** 界面上显示的标签（已保存的标签原样显示；引用线是“写进第 N 段”）。 */
  label?: string;
  /** 同组的线只写一次标签（同一来源扇出的摘录线、汇入同一段的引用线）。 */
  labelGroup?: string;
  /** 文稿脚注行按这个 id 找（摘录 id；直接引用来源时是来源 id）。 */
  citeKey?: string;
  /** 这条引用在文稿脚注里的行号（0 起）与脚注总行数，DOM 里找不到脚注行时用来估算孔眼高度。 */
  footnoteIndex?: number;
  footnoteCount?: number;
  emphasis?: FieldEdgeEmphasis;
}

// ── 文稿引用 ─────────────────────────────────────────────────────────────

export interface DraftCitation {
  /** 引用线的起点卡：引用里有摘录 id 时是摘录，否则是来源本身。 */
  key: string;
  /** 引用里写明了摘录 id（摘录不在画布时不画线，K11“对应摘录已不在当前画布”）。 */
  viaQuote: boolean;
  /** 第一次出现时在脚注里的行号（0 起）。 */
  index: number;
  /** 第一次出现所在的段落（只数正文段落，见 referenceParagraphs）。 */
  paragraph?: number;
}
export interface DraftCitations { rows: number; cites: DraftCitation[] }

const citationCache = new Map<string, DraftCitations>();
const CACHE_LIMIT = 300;

/** 文稿正文 → 每个被引卡片一条（按第一次出现排序）。结果按正文缓存。 */
export function draftCitations(body: string): DraftCitations {
  const cached = citationCache.get(body);
  if (cached) return cached;
  const text = body.replace(/\r\n?/g, '\n');
  const references = parseDraftReferences(text);
  const paragraphs = referenceParagraphs(text, references);
  const seen = new Map<string, DraftCitation>();
  references.forEach((reference, index) => {
    const key = reference.quoteNodeId ?? reference.sourceNodeId;
    if (!seen.has(key)) seen.set(key, { key, viaQuote: reference.quoteNodeId !== undefined, index, paragraph: paragraphs[index] });
  });
  const result = { rows: references.length, cites: [...seen.values()] };
  if (citationCache.size >= CACHE_LIMIT) citationCache.delete(citationCache.keys().next().value!);
  citationCache.set(body, result);
  return result;
}

/**
 * 每处引用写在文稿的第几段：与写作页左侧的段号一致（draftParagraphIndexAt，CORE-01）。
 * 只有引用链接的行折进上一段（写作页把它显示成上一段末尾的上标），所以“前文：> 引文 [来源]”里的引用算在引文那一段。
 */
export function referenceParagraphs(text: string, references: readonly { from: number; to: number }[]): (number | undefined)[] {
  return references.map(reference => draftParagraphIndexAt(text, reference.from));
}

export function citeLabel(paragraph: number | undefined): string {
  return paragraph ? `写进第 ${paragraph} 段` : '写进文稿';
}

// ── 分类 ────────────────────────────────────────────────────────────────

interface Classified { kind: FieldEdgeKind; from: string; to: string; cite?: DraftCitation; rows?: number }

const citationOf = (draft: BoardNode | undefined, key: string): { cite: DraftCitation; rows: number } | undefined => {
  if (draft?.data.kind !== 'draft' || !draft.data.body) return undefined;
  const info = draftCitations(draft.data.body);
  const cite = info.cites.find(item => item.key === key);
  return cite ? { cite, rows: info.rows } : undefined;
};

/** 已保存连线的画法。 */
export function classifyStoredEdge(edge: Pick<BoardEdge, 'source' | 'target'>, byId: ReadonlyMap<string, BoardNode>): Classified {
  const source = byId.get(edge.source), target = byId.get(edge.target);
  if (target?.data.kind === 'quote' && target.data.citation?.nodeId === edge.source) return { kind: 'excerpt', from: edge.source, to: edge.target };
  if (source?.data.kind === 'quote' && source.data.citation?.nodeId === edge.target) return { kind: 'excerpt', from: edge.target, to: edge.source };
  const forward = citationOf(target, edge.source);
  if (forward) return { kind: 'cite', from: edge.source, to: edge.target, cite: forward.cite, rows: forward.rows };
  const backward = citationOf(source, edge.target);
  if (backward) return { kind: 'cite', from: edge.target, to: edge.source, cite: backward.cite, rows: backward.rows };
  return { kind: 'pencil', from: edge.source, to: edge.target };
}

export interface FieldEdgeRecord { id: string; source: string; target: string; type?: string; label?: string; data: FieldEdgeData }

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
const DEFAULT_EXCERPT_LABELS = new Set(['摘录', '摘录自']);

/**
 * 已保存连线 + 派生引用线（不含选中与强调）。同一对卡片之间已经有保存的连线时不再派生，
 * 那条保存的线按引用线画（标签为空时显示“写进第 N 段”）。
 */
export function fieldEdgeRecords(board: Pick<Board, 'nodes' | 'edges'>): FieldEdgeRecord[] {
  const byId = new Map(board.nodes.map(node => [node.id, node] as const));
  const records: FieldEdgeRecord[] = [];
  const stored = new Set<string>();
  for (const edge of board.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    stored.add(pairKey(edge.source, edge.target));
    const info = classifyStoredEdge(edge, byId);
    const label = edge.label?.trim() || (info.kind === 'cite' ? citeLabel(info.cite?.paragraph) : undefined);
    records.push({
      id: edge.id, source: edge.source, target: edge.target, type: edge.type, label: edge.label,
      data: {
        kind: info.kind, derived: false, from: info.from, to: info.to, label,
        labelGroup: label ? groupKey(info.kind, info.from, info.to, label, edge.id) : undefined,
        ...(info.cite ? { citeKey: info.cite.key, footnoteIndex: info.cite.index, footnoteCount: info.rows } : {}),
      },
    });
  }
  for (const draft of board.nodes) {
    if (draft.data.kind !== 'draft' || !draft.data.body) continue;
    const info = draftCitations(draft.data.body);
    for (const cite of info.cites) {
      // A quote id in the link that is no longer on the board draws nothing (the footnote still says so).
      const fromNode = byId.get(cite.key);
      if (!fromNode || cite.key === draft.id || stored.has(pairKey(cite.key, draft.id))) continue;
      const label = citeLabel(cite.paragraph);
      records.push({
        id: `${CITE_EDGE_PREFIX}${draft.id}:${cite.key}`, source: cite.key, target: draft.id, type: CITE_EDGE_TYPE,
        data: {
          kind: 'cite', derived: true, from: cite.key, to: draft.id, label, labelGroup: groupKey('cite', cite.key, draft.id, label, ''),
          citeKey: cite.key, footnoteIndex: cite.index, footnoteCount: info.rows,
        },
      });
    }
  }
  return records;
}

function groupKey(kind: FieldEdgeKind, from: string, to: string, label: string, id: string): string {
  if (kind === 'excerpt') return `excerpt:${from}:${label}`;
  if (kind === 'cite') return `cite:${to}:${label}`;
  return `edge:${id}`;
}

// ── 点亮与压暗 ───────────────────────────────────────────────────────────

/**
 * 选中卡片时：与它直接相连的线 + 它的整条来历链（只沿摘录线、引用线向上到来源、向下到文稿）点亮，其余压暗。
 * 向上走的点只继续向上，向下走的点只继续向下，所以选中一张摘录不会点亮同一来源的其他摘录。
 */
export function edgeEmphasis(records: readonly Pick<FieldEdgeRecord, 'id' | 'data'>[], selectedNodeIds: readonly string[]): Map<string, FieldEdgeEmphasis> {
  const result = new Map<string, FieldEdgeEmphasis>();
  if (!selectedNodeIds.length || !records.length) return result;
  const selected = new Set(selectedNodeIds);
  const lit = new Set<string>();
  const upstream = new Map<string, Pick<FieldEdgeRecord, 'id' | 'data'>[]>();
  const downstream = new Map<string, Pick<FieldEdgeRecord, 'id' | 'data'>[]>();
  for (const record of records) {
    if (selected.has(record.data.from) || selected.has(record.data.to)) lit.add(record.id);
    if (record.data.kind === 'pencil') continue;
    (upstream.get(record.data.to) ?? upstream.set(record.data.to, []).get(record.data.to)!).push(record);
    (downstream.get(record.data.from) ?? downstream.set(record.data.from, []).get(record.data.from)!).push(record);
  }
  const walk = (start: Iterable<string>, links: Map<string, Pick<FieldEdgeRecord, 'id' | 'data'>[]>, next: (record: Pick<FieldEdgeRecord, 'data'>) => string) => {
    const queue = [...start];
    const visited = new Set(queue);
    while (queue.length) {
      const id = queue.shift()!;
      for (const record of links.get(id) ?? []) {
        lit.add(record.id);
        const other = next(record);
        if (!visited.has(other)) { visited.add(other); queue.push(other); }
      }
    }
  };
  walk(selected, upstream, record => record.data.from);
  walk(selected, downstream, record => record.data.to);
  for (const record of records) result.set(record.id, lit.has(record.id) ? 'lit' : 'dim');
  return result;
}

// ── 读屏名称（KB-m1：中文，用卡片标题，不露 id） ───────────────────────────

const cardName = (data: CardData | undefined) => {
  if (!data) return '未命名';
  if (data.kind === 'quote') {
    // “摘录 · <来源标题>”（文字摘录的存储标题）只重复了线的起点，读原句开头更有用。
    const display = quoteDisplayTitle(data);
    return /^摘录 · /.test(display) && (data.citation?.text || data.body) ? quoteDisplayTitle({ ...data, title: '' }) : display;
  }
  return data.title?.trim() || '未命名';
};

/**
 * 读出来是一句话（CANVAS-18）：“从‘凌晨四点的早餐摊’摘到‘摊主说…’”“‘一座城市…’引用到‘十五分钟的城市’：写进第 3 段”
 * “‘这支片子…’连到‘早餐摊 · 分镜脚本’：想表达的”。不用“→”（中文读屏念成“右箭头”），也不用术语表外的“摘录线”；
 * 摘录线的默认标签（“摘录自”“摘录”）不重复。
 */
export function edgeAriaLabel(data: Pick<FieldEdgeData, 'kind' | 'from' | 'to' | 'label'>, byId: ReadonlyMap<string, Pick<BoardNode, 'data'>>): string {
  const from = cardName(byId.get(data.from)?.data), to = cardName(byId.get(data.to)?.data);
  const label = data.label?.trim();
  const extra = label && !(data.kind === 'excerpt' && DEFAULT_EXCERPT_LABELS.has(label)) ? `：${label}` : '';
  if (data.kind === 'excerpt') return `从‘${from}’摘到‘${to}’${extra}`;
  return `‘${from}’${data.kind === 'cite' ? '引用到' : '连到'}‘${to}’${extra}`;
}
