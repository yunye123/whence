import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Clapperboard, GripVertical, PenLine, Plus } from 'lucide-react';
import { Words } from '../../cards/Words';
import ProvenanceTag from '../../components/ProvenanceTag';
import type { BoardNode } from '../../model';
import { timecode } from '../../model';
import { timeRangeLabel } from '../../source-location';
import type { ResolvedReference } from '../draft-editor/sources';
import ShotFrame from './ShotFrame';
import { formatDuration, isPictureNote, isScriptLine, shotPickTime } from './script-model';
import type { ScriptBeat, ScriptLine, ScriptModel, ScriptScene, ScriptShot } from './script-model';
import { isSameSlot, sceneAt } from './script-edit';
import type { ScriptSlot } from './script-edit';
import type { ScriptEditing } from './script-editing';

export interface ScriptActions {
  /** Back to the film at the excerpt (draft navigation keeps the way back, C11 / K9-20). */
  open: (reference: ResolvedReference) => void;
  /**
   * Open a film (the scene's place, or a film to pick a shot from) on the same trip. With `line` (“补一个镜头”) the
   * watching page can give the chosen sentences to that line as its picture (“配给这一行”).
   */
  openSource: (sourceId: string, time?: number, line?: ScriptLine) => void;
  /** Open this line in 正文 with the caret at the start of the paragraph (read-only windows, code blocks). */
  edit: (line: ScriptLine) => void;
  /** Leave the script view. */
  showBody: () => void;
}

const noEditing = { subscribe: () => () => {}, getSnapshot: () => null };
const editableLine = (line: ScriptLine) => line.kind !== 'code';
const isModKey = (event: { ctrlKey: boolean; metaKey: boolean }) => event.ctrlKey || event.metaKey;

/**
 * 脚本视图 (DESIGN_SYSTEM §6.29): the same draft laid out as a shooting script. A table (role table, so screen readers
 * announce rows and columns) of scenes; each line has its number in 正文, the picture it is tied to (the frame at the
 * excerpt's start + the standard provenance tag, which returns to that second of the film), its words and its length.
 * Editing (step two): a line's words are edited in place (a range view of the body editor, `ScriptEditing`); a row or a
 * scene is dragged by its handle, or moved with Alt+↑ / Alt+↓, and every change is one undo step in the body's history.
 */
export default memo(function ScriptView({ model, references, nodes, readOnly, actions, editing }: {
  model: ScriptModel;
  references: readonly ResolvedReference[];
  nodes: readonly BoardNode[];
  readOnly: boolean;
  actions: ScriptActions;
  editing?: ScriptEditing | null;
}) {
  const hintId = useId();
  const tableRef = useRef<HTMLDivElement>(null);
  const store = editing ?? noEditing;
  const editingAt = useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
  const [message, setMessage] = useState('');
  const byIndex = useMemo(() => new Map(references.map(reference => [reference.index, reference])), [references]);
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  // One film behind the whole script: a scene's time range and an empty picture both point into it. A script written
  // from nothing has no excerpt yet: on a board with a single film, that film is the one to pick shots from, so the
  // first “补一个镜头” (and “配给这一行”) is there before any picture is (video blogger review, round 4).
  const film = model.videoSources.length === 1 ? byId.get(model.videoSources[0])
    : model.videoSources.length === 0 ? onlyFilm(nodes) : undefined;
  const canEdit = !readOnly && !!editing;
  if (editing) { editing.readOnly = readOnly; editing.describedBy = hintId; }
  const drag = useScriptDrag(tableRef, model, editing ?? null);

  // After a keyboard move or an undo from a static cell, focus follows the line (its old element may be gone); a moved
  // row or scene comes into view and is marked once.
  useLayoutEffect(() => {
    if (!editing) return;
    const table = tableRef.current;
    const notice = editing.takeNotice();
    const target = editing.takeFocusTarget();
    if (!table) return;
    if (notice) {
      setMessage(notice.message);
      const row = table.querySelector<HTMLElement>(notice.kind === 'scene' ? `.draft-script__row--scene[data-from="${notice.start}"]` : `.draft-script__row--line[data-start="${notice.start}"]`);
      if (row) {
        row.scrollIntoView({ block: 'nearest' });
        row.classList.remove('is-moved');
        void row.offsetWidth;
        row.classList.add('is-moved');
      }
    }
    if (target) {
      const control = target.kind === 'scene'
        ? table.querySelector<HTMLElement>(`.draft-script__row--scene[data-from="${target.start}"] .draft-script__scene-grip`)
        : table.querySelector<HTMLElement>(`.draft-script__row--line[data-start="${target.start}"] .draft-script__line`);
      control?.focus({ preventScroll: !!notice });
      if (!notice) control?.scrollIntoView({ block: 'nearest' });
    }
  });

  if (!model.sceneCount && !model.timedShots) {
    return <section className="draft-script draft-script--empty" aria-label="分镜脚本">
      <div className="draft-script__empty">
        <div className="draft-script__sketch" aria-hidden="true">
          {[0, 1, 2].map(row => <span key={row} className="draft-script__sketch-row"><i /><b /><em /></span>)}
        </div>
        <h3>这篇文稿还没有分场</h3>
        <Words as="p" text="脚本按小标题分场，每段是一行。在正文里写下“开场”“结尾”这样的小标题，再从视频里摘一句插进来，这一行就有了画面和时长。" />
        <button type="button" className="btn btn--line btn--sm" onClick={actions.showBody}><PenLine size={14} aria-hidden="true" />回到正文</button>
      </div>
    </section>;
  }

  // A cell whose paragraph is still empty (Enter at the end of a line, or every word deleted) has no row in the model:
  // it is shown where the paragraph will be, so the writer keeps typing in place.
  const lines = model.scenes.flatMap(scene => scene.rows.filter(isScriptLine));
  const pending = editingAt !== null && !lines.some(line => line.textFrom === editingAt) ? editingAt : null;
  const pendingScene = pending === null ? -1 : sceneAt(model, pending);

  const notice = !model.sceneCount
    ? '还没有分场：在正文里用“小标题”把文稿分成几场，每场下面的段落就是一行。'
    : !model.videoSources.length ? (film && !readOnly
      ? `这份脚本还没有画面：在一行上点“补一个镜头”，从“${film.data.title.trim() || '视频'}”里挑句子配给它，这一行就有了画面和时长。`
      : '这份脚本还没有画面：在视频的观看页摘录句子，插进正文，这一行就有了画面和时长。') : null;
  const hint = readOnly ? '按回车在正文里查看这一段'
    : '按回车修改这一行；修改时 Enter 新起一行，Esc 完成。Alt 加上下方向键把这一行移到上一行或下一行之外';
  return <section className="draft-script" aria-label="分镜脚本">
    {notice && <p className="draft-script__notice"><Clapperboard size={15} aria-hidden="true" /><span>{notice}</span></p>}
    <p id={hintId} className="sr-only">{hint}</p>
    <p className="sr-only" aria-live="polite">{message}</p>
    <div ref={tableRef} className={`draft-script__table${drag.active ? ' is-dragging' : ''}`} role="table" aria-label={`分镜脚本，${model.sceneCount ? `${model.sceneCount} 场，` : ''}${model.lineCount} 行`}>
      <div className="draft-script__columns" role="rowgroup">
        <div className="draft-script__row draft-script__row--columns" role="row">
          <span role="columnheader" className="draft-script__num">#</span>
          <span role="columnheader" className="draft-script__picture">画面</span>
          <span role="columnheader" className="draft-script__words">旁白</span>
          <span role="columnheader" className="draft-script__time">时长</span>
        </div>
      </div>
      {/* Keys by place, not by body offset: typing in a line shifts the offsets of every row below it, and offset keys
          would mount those rows again on every keystroke. */}
      {model.scenes.map((scene, index) => <Scene key={scene.headed ? `scene-${index}` : 'lead'} scene={scene} index={index} film={film} byIndex={byIndex} byId={byId} hintId={hintId}
        readOnly={readOnly} canEdit={canEdit} actions={actions} editing={editing ?? null} editingAt={editingAt}
        pending={pendingScene === index ? pending : null} drag={drag} sceneCount={model.sceneCount} />)}
      {drag.indicator && <div className={`draft-script__drop${drag.indicator.scene ? ' is-scene' : ''}`} style={{ top: drag.indicator.top }} aria-hidden="true" />}
    </div>
    {drag.ghost}
  </section>;
});

/** The board's one film (a video card that plays: imported media, a sample or a link with media), if there is exactly one. */
function onlyFilm(nodes: readonly BoardNode[]): BoardNode | undefined {
  const films = nodes.filter(node => node.data.kind === 'video' && !node.data.videoImport?.error && (node.data.mediaId || node.data.url || node.data.transcript?.length));
  return films.length === 1 ? films[0] : undefined;
}

function Scene({ scene, index, film, byIndex, byId, hintId, readOnly, canEdit, actions, editing, editingAt, pending, drag, sceneCount }: {
  scene: ScriptScene;
  index: number;
  film?: BoardNode;
  byIndex: ReadonlyMap<number, ResolvedReference>;
  byId: ReadonlyMap<string, BoardNode>;
  hintId: string;
  readOnly: boolean;
  canEdit: boolean;
  actions: ScriptActions;
  editing: ScriptEditing | null;
  editingAt: number | null;
  pending: number | null;
  drag: ScriptDrag;
  sceneCount: number;
}) {
  const range = scene.heading ? timeRangeLabel(scene.heading.start, scene.heading.end) : undefined;
  const title = scene.title || (scene.headed ? '未命名的一场' : '');
  const rows: (ScriptLine | ScriptBeat)[] = [...scene.rows];
  if (pending !== null) {
    const synthetic: ScriptLine = { from: pending, to: pending, start: pending, ownTo: pending, textFrom: pending, caret: pending, kind: 'text', segments: [], shots: [] };
    const at = rows.findIndex(row => row.from > pending);
    rows.splice(at < 0 ? rows.length : at, 0, synthetic);
  }
  const movable = canEdit && scene.headed && sceneCount > 1;
  const onSceneKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!editing || !['ArrowUp', 'ArrowDown'].includes(event.key) || event.shiftKey || isModKey(event)) return;
    event.preventDefault();
    editing.stepScene(index, event.key === 'ArrowUp' ? -1 : 1);
  };
  return <div className={`draft-script__scene${scene.headed ? '' : ' is-lead'}${drag.dragging?.kind === 'scene' && drag.dragging.index === index ? ' is-lifted' : ''}`} role="rowgroup" data-scene={index}>
    {scene.headed && <div className="draft-script__row draft-script__row--scene" role="row" data-from={scene.from}>
      <div role="cell" aria-colspan={3} className="draft-script__scene-name">
        {movable && <button type="button" className="draft-script__scene-grip" aria-label={`移动「${title}」这一场`} title="拖动改顺序，或按 Alt+↑ / Alt+↓"
          onKeyDown={onSceneKey} onPointerDown={event => drag.start(event, { kind: 'scene', index })}><GripVertical size={14} aria-hidden="true" /></button>}
        <h3 className="draft-script__scene-title">{title}</h3>
        {range && (film
          ? <span className="draft-script__scene-tag" data-script-focus={`scene-${scene.from}`}><ProvenanceTag label={range} actionLabel={`回到原片 ${timecode(scene.heading!.start)}`} title={`回到原片 ${range}：${film.data.title || '视频'}`} onActivate={() => actions.openSource(film.id, scene.heading!.start)} /></span>
          : <span className="draft-script__scene-range tabular">{range}</span>)}
      </div>
      <div role="cell" className="draft-script__time draft-script__scene-time">
        <Duration seconds={scene.duration} dash />
      </div>
    </div>}
    {rows.map((row, rowIndex) => isScriptLine(row)
      ? <Line key={pending !== null && row.from === pending && row.to === pending ? 'pending' : `line-${rowIndex - (pending !== null && rowIndex > rows.findIndex(item => item.from === pending && item.to === pending) ? 1 : 0)}`} line={row} scene={scene} rowIndex={rowIndex} film={film} byIndex={byIndex} byId={byId} hintId={hintId}
        readOnly={readOnly} canEdit={canEdit} actions={actions} editing={editing} open={editingAt !== null && editingAt === row.textFrom} drag={drag} />
      : <div key={`beat-${rowIndex}`} className="draft-script__row draft-script__row--beat" role="row" data-from={row.from} data-row={rowIndex}>
        <div role="cell" aria-colspan={4}><h4 className="draft-script__beat">{row.title}</h4></div>
      </div>)}
  </div>;
}

function Duration({ seconds, dash }: { seconds?: number; dash?: boolean }) {
  // A line without a timed excerpt has no length yet: its cell stays blank (a dash on every such line read as noise);
  // a scene without one still says so with a dash.
  if (seconds === undefined) return <span className="draft-script__none">{dash && <span aria-hidden="true">—</span>}<span className="sr-only">时长未定</span></span>;
  return <span className="tabular">{formatDuration(seconds)}</span>;
}

function Line({ line, scene, rowIndex, film, byIndex, byId, hintId, readOnly, canEdit, actions, editing, open, drag }: {
  line: ScriptLine;
  scene: ScriptScene;
  rowIndex: number;
  film?: BoardNode;
  byIndex: ReadonlyMap<number, ResolvedReference>;
  byId: ReadonlyMap<string, BoardNode>;
  hintId: string;
  readOnly: boolean;
  canEdit: boolean;
  actions: ScriptActions;
  editing: ScriptEditing | null;
  open: boolean;
  drag: ScriptDrag;
}) {
  const first = line.shots[0];
  const firstReference = first ? byIndex.get(first.reference) : undefined;
  const words: ReactNode[] = line.segments.map((segment, index) => {
    if ('text' in segment) return <span key={index}>{segment.text}</span>;
    const previous = line.segments[index - 1];
    const afterPunct = !!previous && 'text' in previous && /[、。，；：！？）」』”’》〉】]$/.test(previous.text);
    const reference = byIndex.get(segment.footnote);
    return <sup key={index} className={`draft-script__ref tabular${afterPunct ? ' is-after-punct' : ''}${reference && !reference.source ? ' is-gone' : ''}`}>{segment.footnote}</sup>;
  });
  const hasWords = line.segments.some(segment => 'text' in segment);
  const note = isPictureNote(line);
  const inPlace = canEdit && editableLine(line);
  const synthetic = line.to === line.from && !line.segments.length && !line.shots.length;
  const onLineKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!editing || !inPlace || !event.altKey || isModKey(event) || event.shiftKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    editing.step(line, event.key === 'ArrowUp' ? -1 : 1);
  };
  const cell = open
    ? <div ref={editing?.attach} className={`script-cell${line.kind === 'quote' ? ' is-quote' : ''}`} />
    : <button type="button" className="draft-script__line" data-script-focus={`line-${line.from}`} data-cell={line.textFrom} aria-describedby={hintId}
      title={inPlace ? '修改这一行（Enter）' : readOnly ? '在正文里查看这一段' : '在正文里修改这一段'}
      onKeyDown={onLineKey}
      onClick={event => {
        if (inPlace && editing) editing.start(line, event.detail === 0 ? 'end' : { x: event.clientX, y: event.clientY });
        else actions.edit(line);
      }}>
      {/* A label that repeats its column (“画面：” in 画面, “旁白：” in 旁白) goes without saying; it stays for screen readers. */}
      {line.label && <span className={note || line.label === '旁白' ? 'sr-only' : 'draft-script__label'}>{line.label}<span className="sr-only">：</span></span>}
      {hasWords ? words : line.shots.length ? <><span className="draft-script__muted">只有画面</span>{words}</> : <span className="draft-script__muted">{note ? '写下这个镜头' : '写下这一行'}</span>}
      <PenLine size={14} className="draft-script__edit" aria-hidden="true" />
    </button>;
  const fill = film && !readOnly && !synthetic
    ? <button type="button" className={`draft-script__fill${note ? ' draft-script__fill--note' : ''}`} data-script-focus={`fill-${line.from}`} title={`打开“${film.data.title || '视频'}”的观看页，从这一场挑一个镜头`} onClick={() => actions.openSource(film.id, shotPickTime(scene, line), line)}>
      <Plus size={14} aria-hidden="true" /><span>补一个镜头</span>
    </button>
    : null;
  const number = <span role="cell" className="draft-script__num tabular">
    <span className="draft-script__num-text">{line.number ?? ''}</span>
    {inPlace && !synthetic && <span className="draft-script__grip" aria-hidden="true" title="拖动改顺序（在旁白上也可按 Alt+↑ / Alt+↓）"
      onPointerDown={event => drag.start(event, { kind: 'line', line })}><GripVertical size={14} /></span>}
  </span>;
  const lifted = drag.dragging?.kind === 'line' && drag.dragging.line.from === line.from;
  const rowProps = { role: 'row', 'data-from': line.from, 'data-start': line.start, 'data-row': synthetic ? undefined : rowIndex };
  if (note) {
    // A shot described in words and still to find (“画面：路口只有一盏灯”): the description fills the 画面 column inside
    // the dashed frame of a missing shot; this line has no 旁白.
    return <div className={`draft-script__row draft-script__row--line is-${line.kind} is-picture-note${open ? ' is-open' : ''}${lifted ? ' is-lifted' : ''}`} {...rowProps}>
      {number}
      <div role="cell" className="draft-script__picture">
        <div className="draft-script__shot-note">{cell}{fill}</div>
      </div>
      <div role="cell" className="draft-script__words"><span className="sr-only">没有旁白</span></div>
      <span role="cell" className="draft-script__time"><Duration seconds={line.duration} /></span>
    </div>;
  }
  return <div className={`draft-script__row draft-script__row--line is-${line.kind}${first ? ' has-shot' : ''}${open ? ' is-open' : ''}${synthetic ? ' is-pending' : ''}${lifted ? ' is-lifted' : ''}`} {...rowProps}>
    {number}
    <div role="cell" className="draft-script__picture">
      {first ? <>
        {/* The frame is a pointer shortcut to the same place as the tag below it; the tag is the keyboard stop. */}
        <span className={`draft-shot-button${firstReference?.source ? '' : ' is-gone'}`}
          title={firstReference?.source ? firstReference.actionLabel : '来源卡片已不在当前画布'}
          onClick={() => { if (firstReference?.source) actions.open(firstReference); }}
        ><ShotFrame source={byId.get(first.sourceNodeId)} time={first.start} end={first.end} /></span>
        <span className="draft-script__tags">{line.shots.map(shot => <span key={shot.reference} className="draft-script__tag" data-script-focus={`ref-${shot.reference}`}><ShotTag shot={shot} reference={byIndex.get(shot.reference)} actions={actions} /></span>)}</span>
      </> : fill ?? (readOnly ? <span className="draft-script__fill is-static">没有画面</span> : null)}
    </div>
    <div role="cell" className="draft-script__words">{cell}</div>
    <span role="cell" className="draft-script__time"><Duration seconds={line.duration} /></span>
  </div>;
}

function ShotTag({ shot, reference, actions }: { shot: ScriptShot; reference?: ResolvedReference; actions: ScriptActions }) {
  const label = reference?.location ?? timeRangeLabel(shot.start, shot.end);
  if (!reference?.source) return <ProvenanceTag gone label={label ?? '来源'} />;
  if (!label) return <button type="button" className="draft-script__open" onClick={() => actions.open(reference)}>打开原片</button>;
  return <ProvenanceTag label={label} actionLabel={reference.actionLabel} title={`${reference.actionLabel}：${reference.title}`} onActivate={() => actions.open(reference)} />;
}

// ── Dragging rows and scenes ────────────────────────────────────────────────────────────────────────────────────

type DragPayload = { kind: 'line'; line: ScriptLine } | { kind: 'scene'; index: number };
interface DropSlot { y: number; line?: ScriptSlot; scene?: number }
interface ScriptDrag {
  active: boolean;
  dragging: DragPayload | null;
  indicator: { top: number; scene: boolean } | null;
  ghost: ReactNode;
  start: (event: ReactPointerEvent<HTMLElement>, payload: DragPayload) => void;
}

const DRAG_THRESHOLD = 4;
const EDGE = 56;

/**
 * Pointer dragging by a row's or a scene's handle: past a few pixels the row lifts, a light-coloured insertion line
 * (the table's caret) shows where it will land, a small label follows the pointer, the panel scrolls near its edges;
 * Esc cancels. Dropping is one move = one undo step (ScriptEditing.moveLine / moveScene).
 */
function useScriptDrag(tableRef: RefObject<HTMLDivElement | null>, model: ScriptModel, editing: ScriptEditing | null): ScriptDrag {
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [indicator, setIndicator] = useState<{ top: number; scene: boolean } | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const session = useRef<{ payload: DragPayload; pointer: number; startY: number; x: number; y: number; started: boolean; slots: DropSlot[]; slot: DropSlot | null; frame: number; cleanup: () => void } | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  const measure = useCallback((payload: DragPayload): DropSlot[] => {
    const table = tableRef.current;
    if (!table) return [];
    const top = table.getBoundingClientRect().top;
    const current = modelRef.current;
    const slots: DropSlot[] = [];
    const sceneElements = [...table.querySelectorAll<HTMLElement>('.draft-script__scene[data-scene]')];
    if (payload.kind === 'scene') {
      sceneElements.forEach(element => {
        const index = Number(element.dataset.scene);
        if (current.scenes[index]?.headed) slots.push({ y: element.getBoundingClientRect().top - top, scene: index });
      });
      const last = sceneElements.at(-1);
      if (last) slots.push({ y: last.getBoundingClientRect().bottom - top, scene: current.scenes.length });
      return slots;
    }
    for (const element of sceneElements) {
      const scene = Number(element.dataset.scene);
      const rows = [...element.querySelectorAll<HTMLElement>(':scope > .draft-script__row[data-row]')];
      rows.forEach(row => slots.push({ y: row.getBoundingClientRect().top - top, line: { scene, row: Number(row.dataset.row) } }));
      const after = rows.at(-1) ?? element.querySelector<HTMLElement>(':scope > .draft-script__row--scene');
      if (after) slots.push({ y: after.getBoundingClientRect().bottom - top, line: { scene, row: current.scenes[scene]?.rows.length ?? 0 } });
    }
    return slots;
  }, [tableRef]);

  const finish = useCallback((drop: boolean) => {
    const state = session.current;
    if (!state) return;
    session.current = null;
    state.cleanup();
    cancelAnimationFrame(state.frame);
    setDragging(null);
    setIndicator(null);
    if (!drop || !state.started || !state.slot || !editing) return;
    const current = modelRef.current;
    if (state.payload.kind === 'line' && state.slot.line) {
      const line = current.scenes.flatMap(scene => scene.rows.filter(isScriptLine)).find(item => item.from === (state.payload as { line: ScriptLine }).line.from);
      if (line && !isSameSlot(current, line, state.slot.line)) editing.moveLine(line, state.slot.line, undefined);
    } else if (state.payload.kind === 'scene' && state.slot.scene !== undefined) {
      editing.moveScene(state.payload.index, state.slot.scene);
    }
  }, [editing]);

  const update = useCallback(() => {
    const state = session.current, table = tableRef.current;
    if (!state || !table || !state.started) return;
    const y = state.y - table.getBoundingClientRect().top;
    let best: DropSlot | null = null;
    for (const slot of state.slots) if (!best || Math.abs(slot.y - y) < Math.abs(best.y - y)) best = slot;
    state.slot = best;
    setIndicator(best ? { top: best.y, scene: state.payload.kind === 'scene' } : null);
    const ghost = ghostRef.current;
    if (ghost) ghost.style.transform = `translate(${Math.round(state.x + 14)}px, ${Math.round(state.y - 14)}px)`;
  }, [tableRef]);

  const start = useCallback((event: ReactPointerEvent<HTMLElement>, payload: DragPayload) => {
    if (event.button !== 0 || !editing || session.current) return;
    event.preventDefault();
    const grip = event.currentTarget;
    const pointer = event.pointerId;
    grip.setPointerCapture?.(pointer);
    const scroller = tableRef.current?.closest<HTMLElement>('.inspector-scroll') ?? null;
    const onMove = (move: PointerEvent) => {
      const state = session.current;
      if (!state || move.pointerId !== pointer) return;
      state.x = move.clientX;
      state.y = move.clientY;
      if (!state.started) {
        if (Math.abs(move.clientY - state.startY) < DRAG_THRESHOLD) return;
        state.started = true;
        // A cell being written closes first: the move is a separate step.
        if (editing.getSnapshot() !== null) editing.finish(false);
        state.slots = measure(payload);
        setDragging(payload);
        const scroll = () => {
          const current = session.current;
          if (!current) return;
          if (scroller) {
            const box = scroller.getBoundingClientRect();
            const speed = current.y < box.top + EDGE ? -Math.ceil((box.top + EDGE - current.y) / 4) : current.y > box.bottom - EDGE ? Math.ceil((current.y - box.bottom + EDGE) / 4) : 0;
            if (speed) { scroller.scrollTop += speed; update(); }
          }
          current.frame = requestAnimationFrame(scroll);
        };
        state.frame = requestAnimationFrame(scroll);
      }
      update();
    };
    const onUp = (up: PointerEvent) => { if (up.pointerId === pointer) finish(true); };
    const onCancel = () => finish(false);
    const onKey = (key: KeyboardEvent) => { if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); finish(false); } };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    session.current = {
      payload, pointer, startY: event.clientY, x: event.clientX, y: event.clientY, started: false, slots: [], slot: null, frame: 0,
      cleanup: () => {
        grip.removeEventListener('pointermove', onMove);
        grip.removeEventListener('pointerup', onUp);
        grip.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey, true);
        if (grip.hasPointerCapture?.(pointer)) grip.releasePointerCapture(pointer);
      },
    };
  }, [editing, finish, measure, tableRef, update]);

  useEffect(() => () => { session.current?.cleanup(); if (session.current) cancelAnimationFrame(session.current.frame); session.current = null; }, []);

  const label = dragging?.kind === 'line'
    ? `${dragging.line.number !== undefined ? `第 ${dragging.line.number} 行` : '这一行'}${dragging.line.segments.length ? ` · ${dragging.line.segments.map(segment => 'text' in segment ? segment.text : '').join('').slice(0, 18)}` : ''}`
    : dragging?.kind === 'scene' ? `「${model.scenes[dragging.index]?.title || '未命名的一场'}」这一场` : '';
  const ghost = dragging && typeof document !== 'undefined'
    ? createPortal(<div ref={ghostRef} className="draft-script__ghost" aria-hidden="true"><GripVertical size={13} /><span>{label}</span></div>, document.body)
    : null;
  return { active: !!dragging, dragging, indicator, ghost, start };
}
