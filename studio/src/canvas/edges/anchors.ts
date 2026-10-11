/** PLAN 2.7: paper-edge anchors, batched after movement. */
import type { CardKind } from '../../model';
import { chooseSide, inkRoute, oppositeSide, sidePoint, type Box, type Cubic, type Point, type Side } from './geometry';
import type { FieldEdgeData, FieldEdgeKind } from './model';
export type EdgeLod = 'full' | 'simple' | 'far';
export interface FootnoteAnchor { x?: number; y: number }
export interface NodeAnchors {
  paper?: Box; stamp?: Point; tagHole?: Point; railY?: number; quoteTextY?: number;
  excerptRows?: Record<string, FootnoteAnchor>; paragraphRefs?: Record<string, FootnoteAnchor>;
  footnotes?: Record<string, FootnoteAnchor>; footnoteRows?: Record<number, FootnoteAnchor>;
}
export const SPEC = { stampY: 19, tagHoleX: 0, tagHoleY: 19, quoteTextY: 19,
  draftPadBottom: 8, footnotePadBottom: 0, footnoteRow: 24, footnoteGap: 0, sheetOne: 0, sheetTwo: 0 } as const;
export interface EdgeEndNode { id: string; kind?: CardKind; box: Box; anchors?: NodeAnchors; versions?: number }
export interface EdgeGeometry { kind: FieldEdgeKind; curve: Cubic; d: string; start: Point; end: Point; startSide: Side; endSide: Side; tie: boolean }
const paperBox = (node: EdgeEndNode): Box => {
  const p = node.anchors?.paper;
  return p ? { x: node.box.x + p.x, y: node.box.y + p.y, width: p.width, height: p.height } : node.box;
};
const stampY = (node: EdgeEndNode) => node.box.y + (node.anchors?.stamp?.y ?? node.anchors?.tagHole?.y ?? Math.min(SPEC.stampY, node.box.height / 2));
export function footnoteAnchor(draft: EdgeEndNode, key: string | undefined, index = 0): FootnoteAnchor | undefined {
  return (key ? draft.anchors?.paragraphRefs?.[key] ?? draft.anchors?.footnotes?.[key] : undefined) ?? draft.anchors?.footnoteRows?.[index + 1];
}
export function footnoteY(draft: EdgeEndNode, key: string | undefined, index = 0, rows = 1): number {
  return footnoteAnchor(draft, key, index)?.y ?? Math.max(SPEC.footnoteRow,
    draft.box.height - SPEC.draftPadBottom - SPEC.footnoteRow / 2 - Math.max(0, rows - 1 - index) * SPEC.footnoteRow);
}
export function edgeGeometry(data: Pick<FieldEdgeData, 'kind' | 'citeKey' | 'footnoteIndex' | 'footnoteCount'>, from: EdgeEndNode, to: EdgeEndNode): EdgeGeometry {
  const a = paperBox(from), b = paperBox(to);
  let start: Point, end: Point, startSide: Side, endSide: Side;
  if (data.kind === 'excerpt' && to.kind === 'quote') {
    end = { x: b.x, y: stampY(to) }; endSide = 'left';
    const y = from.anchors?.excerptRows?.[to.id]?.y ?? from.anchors?.railY;
    const at = (side: 'left' | 'right') => ({ x: side === 'right' ? a.x + a.width : a.x, y: y === undefined ? a.y + a.height / 2 : from.box.y + y });
    if (end.x >= a.x + a.width) { startSide = 'right'; start = at('right'); }
    else if (end.x >= a.x && (end.y >= a.y + a.height || end.y <= a.y)) {
      startSide = end.y >= a.y + a.height ? 'bottom' : 'top';
      start = { x: Math.min(Math.max(end.x + 36, a.x + 16), a.x + a.width - 16), y: startSide === 'bottom' ? a.y + a.height : a.y };
    } else { startSide = 'left'; start = at('left'); }
  } else if (data.kind === 'cite') {
    startSide = b.x + b.width / 2 >= a.x + a.width / 2 ? 'right' : 'left'; endSide = oppositeSide[startSide];
    start = { x: startSide === 'right' ? a.x + a.width : a.x, y: from.kind === 'quote' ? stampY(from) : a.y + a.height / 2 };
    const anchor = footnoteAnchor(to, data.citeKey, data.footnoteIndex);
    end = { x: anchor?.x !== undefined && endSide === 'left' ? to.box.x + anchor.x : endSide === 'left' ? b.x : b.x + b.width,
      y: to.box.y + footnoteY(to, data.citeKey, data.footnoteIndex, data.footnoteCount) };
  } else { startSide = chooseSide(a, b); endSide = oppositeSide[startSide]; start = sidePoint(a, startSide); end = sidePoint(b, endSide); }
  const kind = data.kind === 'cite' ? 'cite' : data.kind === 'excerpt' ? 'excerpt' : 'pencil';
  return { kind, ...inkRoute(start, startSide, end, endSide, kind === 'cite'), start, end, startSide, endSide, tie: false };
}
// Bounded module LRU; virtualization/remount never clears it.
interface CacheEntry { signature: string; anchors: NodeAnchors | undefined }
const CACHE_LIMIT = 1200, cache = new Map<string, CacheEntry>();
const pending = new Map<string, { root: ParentNode; signature: string }>();
const listeners = new Set<() => void>();
const roots = new Map<HTMLElement, MutationObserver>();
let version = 0, fontEpoch = 0, frame = 0, notifyQueued = false, fontWatching = false, boardId: string | undefined;
const diagnostics = { batches: 0, measurements: 0, layoutReads: 0, cacheHits: 0, deferredMoving: 0 };
export const getAnchorDiagnostics = () => ({ ...diagnostics, cached: cache.size, pending: pending.size, fontEpoch });
export function subscribeAnchors(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export const getAnchorVersion = () => version;
export const getNodeAnchors = (id: string): NodeAnchors | undefined => {
  const hit = cache.get(id); if (hit) { cache.delete(id); cache.set(id, hit); } return hit?.anchors;
};
export const anchorsPending = (id: string) => pending.has(id) || !cache.has(id);
function bump() {
  version++; if (notifyQueued) return; notifyQueued = true;
  queueMicrotask(() => { notifyQueued = false; for (const listener of [...listeners]) listener(); });
}
const FONT_SIGNATURE = 'desk-v2:Noto Sans SC Variable|Noto Serif SC Variable|Field Punct Sans|IBM Plex Mono|LXGW WenKai Screen';
export function anchorSignature(width: number, height: number, data: object | undefined, lod: EdgeLod, tier = 1, fontSignature = FONT_SIGNATURE): string {
  return JSON.stringify([width, height, data, lod, tier, fontSignature, fontEpoch]);
}
const escapeId = (id: string) => typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
const moving = (root: ParentNode) => root instanceof Element && !!root.closest('.is-moving');
function queueBatch() { if (!frame && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(flush); }
function watch(root: ParentNode) {
  if (!(root instanceof HTMLElement) || roots.has(root) || typeof MutationObserver === 'undefined') return;
  const shell = root.closest('.flow-container') ?? root.closest('.canvas-shell');
  const mutation = new MutationObserver(records => {
    // Ignore pan transform/style; only child replacement or movement-end resumes the queue.
    if (records.some(r => r.type === 'childList' || (r.target === shell && !moving(root)))) queueBatch();
  });
  mutation.observe(root, { childList: true, subtree: true });
  if (shell) mutation.observe(shell, { attributes: true, attributeFilter: ['class'] });
  roots.set(root, mutation);
  if (!fontWatching && typeof document !== 'undefined') {
    fontWatching = true;
    document.fonts?.addEventListener('loadingdone', () => { fontEpoch++; cache.clear(); bump(); queueBatch(); });
  }
}
/** After commit: schedule correction; no DOM layout reads here. */
export function refreshNodeAnchors(root: ParentNode | null | undefined, id: string, signature: string): void {
  const hit = cache.get(id);
  if (hit?.signature === signature && !pending.has(id)) { diagnostics.cacheHits++; return; }
  if (!root) return;
  watch(root); pending.set(id, { root, signature }); queueBatch();
}
function flush() {
  frame = 0; diagnostics.batches++;
  const updates: [string, CacheEntry][] = [];
  for (const [id, request] of pending) {
    if (moving(request.root)) { diagnostics.deferredMoving++; continue; }
    const el = request.root.querySelector<HTMLElement>(`.react-flow__node[data-id="${escapeId(id)}"]`);
    if (el) updates.push([id, { signature: request.signature, anchors: measureNodeAnchors(el) }]);
  }
  let changed = false;
  for (const [id, entry] of updates) {
    changed ||= JSON.stringify(cache.get(id)?.anchors ?? null) !== JSON.stringify(entry.anchors ?? null);
    cache.delete(id); cache.set(id, entry); pending.delete(id);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  for (const [root, observer] of roots) if (!root.isConnected) { observer.disconnect(); roots.delete(root); }
  if (changed) bump();
}
/** Board-switch / explicit reset only; never call on card unmount. */
export function forgetNodeAnchors(id?: string): void {
  if (id === undefined) { cache.clear(); pending.clear(); } else { cache.delete(id); pending.delete(id); }
  bump();
}
export function setAnchorBoard(id: string | undefined): void { if (id !== boardId) { boardId = id; forgetNodeAnchors(); } }
if (typeof globalThis !== 'undefined') Object.defineProperty(globalThis, '__fieldAnchors', { value: { stats: getAnchorDiagnostics }, configurable: true });
const q = (n: number) => Math.round(n * 100) / 100;
function rect(el: Element) { diagnostics.layoutReads++; return el.getBoundingClientRect(); }
function visible(el: Element) {
  diagnostics.layoutReads++;
  const check = (el as Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean }).checkVisibility;
  return check ? check.call(el, { visibilityProperty: true, contentVisibilityAuto: true }) : !el.closest('[aria-hidden="true"], [inert]');
}
/** Only central rAF calls this in production; exported for independent geometry checks. */
export function measureNodeAnchors(node: HTMLElement): NodeAnchors | undefined {
  diagnostics.measurements++;
  const nr = rect(node); diagnostics.layoutReads++;
  const width = parseFloat(getComputedStyle(node).width) || node.offsetWidth, scale = width ? nr.width / width : 1;
  if (!scale || !Number.isFinite(scale)) return undefined;
  const relative = (r: DOMRect): Box => ({ x: q((r.left - nr.left) / scale), y: q((r.top - nr.top) / scale), width: q(r.width / scale), height: q(r.height / scale) });
  const pick = (s: string) => [...node.querySelectorAll(s)].find(visible);
  const center = (el: Element, withX = false): FootnoteAnchor => {
    const b = relative(rect(el)); return { ...(withX ? { x: q(b.x + b.width / 2) } : {}), y: q(b.y + b.height / 2) };
  };
  const anchors: NodeAnchors = {};
  const paper = pick('[data-edge-anchor="paper"]') ?? pick('.field-card');
  if (paper) anchors.paper = relative(rect(paper));
  const stamp = pick('[data-edge-anchor="stamp"]') ?? pick('.tag:not(.tag--mini)') ?? pick('[data-edge-anchor="tag-hole"]');
  if (stamp) { const c = center(stamp, true); anchors.stamp = { x: c.x!, y: c.y }; anchors.tagHole = anchors.stamp; }
  const rail = pick('[data-edge-anchor="rail"], .field-card__rail, .field-card__length-rail');
  if (rail) anchors.railY = center(rail).y;
  const text = pick('[data-edge-anchor="quote-text"], .field-card__quote-text');
  if (text) anchors.quoteTextY = center(text).y;
  for (const el of node.querySelectorAll<HTMLElement>('[data-edge-anchor="excerpt-row"][data-quote-id], mark[data-quote-id]')) {
    if (!visible(el) || anchors.excerptRows?.[el.dataset.quoteId!]) continue;
    const marked = el.querySelector<HTMLElement>('mark[data-quote-id]') ?? el;
    diagnostics.layoutReads++; const first = marked.getClientRects()[0];
    if (first) {
      const b = relative(first);
      const lineHeight = parseFloat(getComputedStyle(marked).lineHeight) || b.height;
      (anchors.excerptRows ??= {})[el.dataset.quoteId!] = { y: q(b.y + Math.min(b.height, lineHeight) / 2) };
    }
  }
  for (const el of node.querySelectorAll<HTMLElement>('[data-edge-anchor="para-ref"][data-cite-key]')) {
    if (visible(el)) (anchors.paragraphRefs ??= {})[el.dataset.citeKey!] ??= center(el, true);
  }
  for (const el of node.querySelectorAll<HTMLElement>('[data-edge-anchor="footnote"][data-cite-key], [data-footnote][data-cite-key]')) {
    if (visible(el)) (anchors.footnotes ??= {})[el.dataset.citeKey!] ??= center(el);
  }
  for (const el of node.querySelectorAll<HTMLElement>('[data-footnote]')) {
    const index = Number(el.dataset.footnote);
    if (Number.isInteger(index) && index >= 1 && visible(el)) (anchors.footnoteRows ??= {})[index] ??= center(el);
  }
  return anchors;
}
