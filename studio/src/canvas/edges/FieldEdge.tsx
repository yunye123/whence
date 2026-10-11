import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react';
import { EdgeLabelRenderer, useStore, useStoreApi, type EdgeProps, type ReactFlowState } from '@xyflow/react';
import { PenLine, Trash2 } from 'lucide-react';
import { anchorSignature, getAnchorVersion, refreshNodeAnchors, subscribeAnchors } from './anchors';
import { cubicAt, type Point } from './geometry';
import { selectEdgeLayout, selectEdgeLod, zoomTier } from './layout';
import { connectionTracker, EDGE_LABEL_MAX, getEditingEdge, labelledEdge, setEditingEdge, subscribeEditing } from './label-edit';
import type { FieldFlowEdge } from './flow-edges';

// ── 键盘焦点（标签在另一个 DOM 子树里，靠这个小 store 知道哪条线有焦点） ─────────
let focusedEdge: string | null = null;
const focusListeners = new Set<() => void>();
const setFocusedEdge = (id: string | null) => { if (focusedEdge === id) return; focusedEdge = id; for (const listener of [...focusListeners]) listener(); };
const subscribeFocus = (listener: () => void) => { focusListeners.add(listener); return () => { focusListeners.delete(listener); }; };
const getFocusedEdge = () => focusedEdge;

const selectTier = (state: ReactFlowState) => zoomTier(state.transform[2]);
/** 能连线的时候才能改线（只读窗口、平移工具都不能）。 */
const selectCanEdit = (state: ReactFlowState) => state.nodesConnectable && state.elementsSelectable;
/** 标签框的字号补偿：屏幕上不小于 12px，概览档也一样（标签在概览档不显示，框却可能开着）；按量化缩放取值。 */
const editorScale = (zoom: number) => Math.max(1, Math.round(100 / zoomTier(zoom)) / 100);

/** 一段标签文字：数字用 Inter 等宽数字（§6.17“数字 12px Inter 500”）。 */
function LabelText({ text, cite = false }: { text: string; cite?: boolean }) {
  const paragraph = cite ? /^写进第 (\d+) 段$/.exec(text)?.[1] : undefined;
  if (paragraph) return <>写进<span className="field-edge-label__paragraph">{paragraph}</span></>;
  return <>{text.split(/(\d+)/).map((part, index) => (index % 2 ? <span key={index} className="field-edge-label__num">{part}</span> : part))}</>;
}

/**
 * 原位标签框（EG-M3）：与标签同字体，屏幕上不小于 12px。Enter 保存，Esc 放弃，点到别处时有改动就保存；可以不填。
 * 按键不再往外传：Esc 不会关掉面板，字母不会触发画布快捷键。
 */
function EdgeLabelEditor({ initial, center, scale, onDone }: { initial: string; center: Point; scale: number; onDone: (text: string | null, viaKeyboard: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const [value, setValue] = useState(initial);
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.select();
  }, []);
  const finish = (text: string | null, viaKeyboard: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(text, viaKeyboard);
  };
  return (
    <div
      className="field-edge-editor nodrag nopan nowheel"
      style={{ transform: `translate(${center.x}px, ${center.y}px) translate(-50%, -50%)`, '--edge-label-scale': scale } as CSSProperties}
      onPointerDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onContextMenu={event => event.stopPropagation()}
    >
      <input
        ref={input}
        className="field-edge-editor__input"
        aria-label="连线标签"
        placeholder="写一句关系，可不填"
        maxLength={EDGE_LABEL_MAX}
        enterKeyHint="done"
        spellCheck={false}
        value={value}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') { event.preventDefault(); finish(value, true); }
          else if (event.key === 'Escape') { event.preventDefault(); finish(null, true); }
        }}
        onBlur={() => finish(value, false)}
      />
      <span className="field-edge-editor__hint" aria-hidden="true">Enter 保存 · Esc 跳过</span>
    </div>
  );
}

/**
 * 来处连线（PLAN §2.7）：墨色摘录线、朱色写进虚线、墨色关系线。两端墨点落在纸缘。
 * 已保存连线的 `type`（smoothstep 等）都映射到这里，存储契约不变。
 *
 * 保存的连线可以写标签（EG-M3、FC-08）：刚连好时弹出可以不填的标签框；单独选中一条线时线下出现操作条
 * “加标签 / 改标签 · 删除”；双击线或标签、在有焦点的线上按 F2（已选中时 Enter 也行）都打开标签框；右键线会选中它。
 */
function FieldEdgeView({ id, source, target, data, selected, label: storedLabelValue }: EdgeProps<FieldFlowEdge>) {
  const version = useSyncExternalStore(subscribeAnchors, getAnchorVersion, getAnchorVersion);
  const geometry = useStore(useCallback((state: ReactFlowState) => selectEdgeLayout(state, version).geometry.get(id), [id, version]));
  const label = useStore(useCallback((state: ReactFlowState) => selectEdgeLayout(state, version).labels.get(id), [id, version]));
  const lod = useStore(selectEdgeLod);
  const tier = useStore(selectTier);
  const focused = useSyncExternalStore(subscribeFocus, getFocusedEdge, getFocusedEdge);
  const editing = useSyncExternalStore(subscribeEditing, getEditingEdge, getEditingEdge) === id;
  const canEdit = useStore(selectCanEdit) && !data?.derived;
  // The action bar belongs to a thread selected on its own (cards selected too get the card bar instead).
  const alone = useStore(useCallback((state: ReactFlowState) => !!selected
    && state.edges.reduce((count, edge) => count + (edge.selected ? 1 : 0), 0) === 1 && !state.nodes.some(node => node.selected), [selected]));
  // Quantized like the labels (K9-7); only the thread whose box is open subscribes.
  const editScale = useStore(useCallback((state: ReactFlowState) => (editing ? editorScale(state.transform[2]) : 1), [editing]));
  const store = useStoreApi();
  const pathRef = useRef<SVGPathElement>(null);
  const from = data?.from ?? source, to = data?.to ?? target;
  const storedLabel = typeof storedLabelValue === 'string' ? storedLabelValue : '';
  const live = useRef({ canEdit, selected: !!selected });
  live.current = { canEdit, selected: !!selected };

  // Measure the cards' anchors after commit, only when their size, data or LOD changed.
  useLayoutEffect(() => {
    const root = pathRef.current?.closest('.react-flow');
    const { nodeLookup } = store.getState();
    for (const nodeId of from === to ? [from] : [from, to]) {
      const node = nodeLookup.get(nodeId);
      if (node) refreshNodeAnchors(root, nodeId, anchorSignature(node.measured?.width ?? 0, node.measured?.height ?? 0, node.data, lod, tier));
    }
  });

  // A thread this drag just created offers its label box once (empty is fine: Enter, Esc or a click elsewhere).
  useEffect(() => {
    if (data?.kind === 'pencil' && !data.derived && !storedLabel && connectionTracker.claim(id, source, target)) setEditingEdge(id);
    // Mount only: the claim is about the moment this thread appeared.
  }, []);
  useEffect(() => () => { if (getEditingEdge() === id) setEditingEdge(null); }, [id]);

  const hasGeometry = !!geometry;
  useEffect(() => {
    const group = pathRef.current?.closest<SVGGElement>('.react-flow__edge');
    if (!group) return;
    const onFocus = () => setFocusedEdge(group.matches(':focus-visible') ? id : null);
    const onBlur = () => { if (focusedEdge === id) setFocusedEdge(null); };
    // F2 names the label (Enter too, once the thread is selected; the first Enter selects it, React Flow's rule).
    const onKey = (event: KeyboardEvent) => {
      if (event.target !== group || !live.current.canEdit || event.isComposing) return;
      if (event.key === 'F2' || (event.key === 'Enter' && live.current.selected)) {
        event.preventDefault();
        event.stopPropagation();
        setEditingEdge(id);
      }
    };
    group.addEventListener('focus', onFocus);
    group.addEventListener('blur', onBlur);
    group.addEventListener('keydown', onKey);
    return () => { group.removeEventListener('focus', onFocus); group.removeEventListener('blur', onBlur); group.removeEventListener('keydown', onKey); onBlur(); };
  }, [id, hasGeometry]);

  const selectFromLabel = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    if (!label) return;
    const state = store.getState();
    const owner = state.edgeLookup.get(label.owner);
    if (!owner || owner.selectable === false || !state.elementsSelectable) return;
    state.addSelectedEdges([label.owner]);
  }, [label, store]);

  /** Right click: select the thread so its action bar shows (there is no browser menu on a thread). */
  const selectFromMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const state = store.getState();
    if (data?.derived || !state.elementsSelectable) return;
    state.addSelectedEdges([id]);
  }, [data?.derived, id, store]);

  const openEditor = useCallback((event?: MouseEvent) => {
    event?.stopPropagation();
    if (canEdit) setEditingEdge(id);
  }, [canEdit, id]);

  const finishEditing = useCallback((text: string | null, viaKeyboard: boolean) => {
    if (getEditingEdge() === id) setEditingEdge(null);
    if (text !== null) {
      const state = store.getState();
      const edge = state.edgeLookup.get(id);
      const item = edge && labelledEdge(edge, text);
      // App's onEdgesChange applies it with changeBoard: saved, validated and undoable like any thread edit.
      if (item) state.triggerEdgeChanges([{ type: 'replace', id, item }]);
    }
    if (viaKeyboard) requestAnimationFrame(() => pathRef.current?.closest<SVGGElement>('.react-flow__edge')?.focus({ preventScroll: true }));
  }, [id, store]);

  const removeEdge = useCallback(() => {
    const state = store.getState();
    const shell = pathRef.current?.closest<HTMLElement>('.canvas-shell');
    state.triggerEdgeChanges([{ type: 'select', id, selected: false }, { type: 'remove', id }]);
    requestAnimationFrame(() => shell?.focus({ preventScroll: true }));
  }, [id, store]);

  if (!geometry) return null;
  const { d, start, end, kind } = geometry;
  const labelFocused = !!label && focused !== null && label.members.includes(focused);
  // Keep congested labels hidden even when selected; aria carries the full stored label.
  const showLabel = !editing && !!label && label.clean && lod !== 'far';
  const middle = cubicAt(geometry.curve, .5);
  const editorAt = label ? label.center : middle;
  // The action bar never covers the thread (CANVAS-12): 10px beyond the label on the side away from the line,
  // or 10px above the middle of a thread without a label.
  const barBelow = showLabel && !!label && label.center.y > label.anchor.y;
  const barAt = showLabel && label ? { x: label.center.x, y: barBelow ? label.box.y + label.box.height : label.box.y } : middle;

  return (
    <>
      <path ref={pathRef} className="field-edge__hit" d={d} onDoubleClick={canEdit ? openEditor : undefined} onContextMenu={selectFromMenu} />
      <path className={`field-edge__line field-edge__line--${kind}${kind === 'cite' ? ' field-edge--cite' : ''}`} d={d} />
      {kind !== 'cite' && <>
        <circle className="field-edge__dot" cx={start.x} cy={start.y} r={2.5} />
        <circle className="field-edge__dot" cx={end.x} cy={end.y} r={2.5} />
      </>}
      {showLabel && label.leader && label.owner === id && (
        <path className="field-edge__leader" d={`M${label.leader.from.x} ${label.leader.from.y}L${label.leader.to.x} ${label.leader.to.y}`} />
      )}
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className={[
              'field-edge-label', 'nodrag', 'nopan', `field-edge-label--${label.kind}`,
              label.emphasis && `is-${label.emphasis}`, (selected || label.selected) && 'is-selected', labelFocused && 'is-focused',
            ].filter(Boolean).join(' ')}
            data-edge-label={label.owner}
            title={label.text}
            aria-hidden="true"
            style={{ transform: `translate(${label.center.x}px, ${label.center.y}px) translate(-50%, -50%)`, '--edge-label-scale': label.scale } as CSSProperties}
            onClick={selectFromLabel}
            onDoubleClick={canEdit ? openEditor : event => event.stopPropagation()}
            onContextMenu={selectFromMenu}
          >
            <LabelText text={label.text} cite={kind === 'cite'} />
          </div>
        </EdgeLabelRenderer>
      )}
      {editing && canEdit && (
        <EdgeLabelRenderer>
          <EdgeLabelEditor initial={storedLabel} center={editorAt} scale={editScale} onDone={finishEditing} />
        </EdgeLabelRenderer>
      )}
      {alone && canEdit && !editing && (
        <EdgeLabelRenderer>
          {/* Screen-sized like the card bar (K8): the inverse of the live zoom, written by lod.ts as --z. */}
          <div
            className="field-edge-tools nodrag nopan nowheel"
            role="toolbar"
            aria-label="连线操作"
            style={{ transform: `translate(${barAt.x}px, ${barAt.y}px) scale(calc(1 / var(--z, 1))) translate(-50%, ${barBelow ? '10px' : 'calc(-100% - 10px)'})` }}
            onPointerDown={event => event.stopPropagation()}
            onDoubleClick={event => event.stopPropagation()}
            onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
          >
            <button type="button" className="field-edge-tools__btn" onClick={() => setEditingEdge(id)} title="F2">
              <PenLine size={15} strokeWidth={1.75} aria-hidden="true" />{storedLabel ? '改标签' : '加标签'}
            </button>
            <span className="field-edge-tools__rule" aria-hidden="true" />
            <button type="button" className="field-edge-tools__btn" aria-label="删除连线" title="删除连线 (Del)" onClick={removeEdge}>
              <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />删除
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const FieldEdge = memo(FieldEdgeView);
