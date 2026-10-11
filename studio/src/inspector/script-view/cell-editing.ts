import { Annotation, Compartment, EditorSelection, EditorState, Transaction } from '@codemirror/state';
import type { Extension, SelectionRange } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, drawSelection, keymap, placeholder as placeholderExtension } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { defaultKeymap, isolateHistory, redo, undo } from '@codemirror/commands';
import type { DraftEditorHandle } from '../draft-editor/handle';
import { analyzeDraftReferences, referenceExtension, referenceScope, referenceSpans, setReferenceInfo } from '../draft-editor/references';
import type { ReferenceInfo } from '../draft-editor/references';
import { markdownExtension } from '../draft-editor/markdown';
import { buildScript, isPictureNote } from './script-model';
import type { ScriptLine, ScriptModel } from './script-model';
import { keepReferences, lineAt, lineStartOf, moveLine, moveScene, removeEmptyLine, scriptLines, splitLine, stepScene, stepSlot } from './script-edit';
import type { ScriptSlot, TextChange } from './script-edit';

/**
 * 旁白格内直接编辑（DESIGN_SYSTEM §6.29）：格里是一个小 CodeMirror，它的文档就是正文里这一行的那一段（[textFrom, to]）。
 * 正文编辑器（写作页那一个，脚本视图里只隐藏不卸载）始终是唯一的真相与唯一的撤销历史：
 * - 格里的每次改动按偏移平移后原样派发给正文编辑器（同一份 Markdown、同样的 UTF-16 偏移，K1、K9-14），带上原来的
 *   userEvent，所以连续打字、输入法组合在正文的历史里照常合并成一步；正文拒绝（只读、超长）时格里也不改。
 * - 正文编辑器的其他改动（撤销重做、移动行、分段、版本恢复）回到格里：按正文的光标找到它所在的那一行，把格换到那一行。
 * - 引用在格里同样是上标签（同一个 referenceField，序号接着前面的引用），不能被删成半截链接（keepReferences）。
 */

/** Cell transactions that only mirror the body (no echo back). */
const fromBody = Annotation.define<boolean>();
/** Body transactions that came from the cell (the cell already holds them). */
const fromCell = Annotation.define<boolean>();

export type CaretHint = 'start' | 'end' | { x: number; y: number };
const editable = (line: ScriptLine) => line.kind !== 'code';

/** Smallest single change that turns `before` into `after`. */
function minimalChange(before: string, after: string): TextChange {
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endBefore = before.length, endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) { endBefore--; endAfter--; }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}

const shiftRange = (range: SelectionRange, offset: number) => EditorSelection.range(range.anchor + offset, range.head + offset);
const blankLineAt = (text: string, position: number) => {
  const start = lineStartOf(text, position);
  const newline = text.indexOf('\n', position);
  return !text.slice(start, newline < 0 ? text.length : newline).trim();
};

/** The cell holds nothing but reference links and blank space. */
function wordless(view: EditorView): boolean {
  let text = view.state.doc.toString();
  for (const span of [...referenceSpans(view.state)].sort((a, b) => b.from - a.from)) text = text.slice(0, span.from) + text.slice(span.to);
  return !text.trim();
}

class LabelWidget extends WidgetType {
  constructor(readonly label: string) { super(); }
  eq(other: LabelWidget) { return other.label === this.label; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'draft-script__label';
    span.textContent = this.label;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
  ignoreEvent() { return true; }
}

/** The label shown in front of the words, as in the static cell (“字幕”, “音效”…; 旁白 and a picture note's 画面 go without saying). */
export function cellLabel(line: ScriptLine | null): string | undefined {
  if (!line?.label || line.label === '旁白' || isPictureNote(line)) return undefined;
  return line.textFrom > line.start ? line.label : undefined;
}

const labelDecoration = (label?: string): Extension => label
  ? EditorView.decorations.of(Decoration.set([Decoration.widget({ widget: new LabelWidget(label), side: -1 }).range(0)]))
  : [];

/** The CodeMirror base theme is unlayered: properties it sets are overridden here with tokens (as draft-editor/theme.ts). */
const scriptCellTheme = EditorView.theme({
  '&': { color: 'inherit', backgroundColor: 'transparent', font: 'inherit' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', overflow: 'visible' },
  '.cm-content': { padding: '0', minHeight: 'var(--script-cell-line, 28px)', caretColor: 'var(--light-fg)', fontFamily: 'inherit', whiteSpace: 'pre-wrap' },
  '.cm-line': { padding: '0' },
  // The static cell draws a quotation's rule at its left edge and sets the words 14px in (inspector-writing.css §5).
  '.cm-line.cm-md-quote': { paddingLeft: '14px' },
  '.cm-line.cm-md-list': { paddingLeft: '1.3em' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--light-fg)', marginLeft: '-1px' },
  '&.cm-editor.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-editor.cm-editor .cm-selectionBackground': { backgroundColor: 'var(--text-selection)' },
  '.cm-content ::selection': { backgroundColor: 'var(--text-selection)' },
  '.cm-placeholder': { color: 'var(--fg-3)', fontStyle: 'normal' },
});

/** A reference never loses half its link in a cell; typing after an excerpt hoisted to the paragraph's end goes before it. */
const protectReferences = EditorState.transactionFilter.of(transaction => {
  if (!transaction.docChanged || transaction.annotation(fromBody)) return transaction;
  const spans = referenceSpans(transaction.startState);
  if (!spans.length) return transaction;
  const list: TextChange[] = [];
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => list.push({ from: fromA, to: toA, insert: inserted.toString() }));
  const kept = keepReferences(list, spans.map(span => ({ from: span.hideFrom, to: span.hideTo, hoisted: span.hideFrom < span.from })));
  if (!kept) return transaction;
  const changes = transaction.startState.changes(kept.changes);
  const userEvent = transaction.annotation(Transaction.userEvent);
  return { changes, selection: EditorSelection.cursor(changes.mapPos(kept.caret, 1)), scrollIntoView: true, ...(userEvent ? { userEvent } : {}) };
});

/** Default bindings that would reshape the paragraph behind the script's back (move or copy lines, comment, indent). */
const RESERVED = new Set(['Escape', 'Mod-Enter', 'Alt-ArrowUp', 'Alt-ArrowDown', 'Shift-Alt-ArrowUp', 'Shift-Alt-ArrowDown', 'Shift-Mod-k', 'Mod-[', 'Mod-]', 'Mod-Alt-\\', 'Mod-/', 'Alt-A', 'Shift-Alt-a', 'Mod-i', 'Alt-l', 'Ctrl-m', 'Shift-Mod-m']);

export interface ScriptEditingOptions {
  /** The body editor (hidden in 脚本 but mounted): the one document and the one history. */
  getMain: () => DraftEditorHandle | null;
  /** Ctrl+S in a cell (the body saves by itself; the band says so). */
  onSave?: () => void;
}

export interface MoveNotice { kind: 'line' | 'scene'; start: number; message: string }

/**
 * One editing session at a time, shared by the whole script table: which line's cell is open (`getSnapshot` = its
 * `textFrom`, or null), the cell editor itself, and the moves (rows and scenes), all as transactions on the body editor.
 * Loaded with the editor (editor-kit.ts); the script view talks to it through the ScriptEditing facade (script-editing.ts).
 */
export class ScriptEditingEngine {
  private listeners = new Set<() => void>();
  private snapshot: number | null = null;
  private view: EditorView | null = null;
  private host: HTMLElement | null = null;
  private from = 0;
  private to = 0;
  private ownEnd = 0;
  private hint: CaretHint | null = null;
  private relocating = false;
  private unsubscribe: (() => void) | null = null;
  private info: ReadonlyMap<number, ReferenceInfo> = new Map();
  private readonly scope = new Compartment();
  private readonly label = new Compartment();
  private readonly names = new Compartment();
  private focusTarget: { kind: 'line' | 'scene'; start: number } | null = null;
  private notice: MoveNotice | null = null;
  private recheck = false;
  /** A cell or a move changed the body since the script was opened (正文 then shows where). */
  edited = false;
  readOnly = false;
  /** sr-only description of the cell's keys (ScriptView's hint element). */
  describedBy = '';

  constructor(private readonly options: ScriptEditingOptions) {}

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private emit() { for (const listener of [...this.listeners]) listener(); }
  private setSnapshot(value: number | null) { if (this.snapshot === value) return; this.snapshot = value; this.emit(); }
  private main(): EditorView | null { return this.options.getMain()?.view ?? null; }
  private model(): ScriptModel | null { const main = this.main(); return main ? buildScript(main.state.doc.toString()) : null; }

  /** The superscripts' names and tooltips (source titles), as in the body editor. */
  setReferenceInfo(info: ReadonlyMap<number, ReferenceInfo>) {
    this.info = info;
    this.view?.dispatch({ effects: setReferenceInfo.of(info), annotations: fromBody.of(true) });
  }

  /** The row to focus after the next render (a keyboard move or undo from a static cell), consumed once. */
  takeFocusTarget() { const target = this.focusTarget; this.focusTarget = null; return target; }
  /** The row or scene that just moved (to bring into view and mark once), consumed once. */
  takeNotice() { const notice = this.notice; this.notice = null; return notice; }

  /** Open a line's cell; the caret goes to the clicked point, the start or the end of its words. */
  start(line: ScriptLine, hint: CaretHint): boolean {
    const main = this.main();
    if (!main || this.readOnly || !editable(line)) return false;
    if (this.view) this.close();
    this.place(line);
    this.hint = hint;
    this.view = this.createView(main.state.doc.sliceString(this.from, this.to), line);
    this.unsubscribe = this.options.getMain()?.subscribe(this.onBody) ?? null;
    this.relocating = true;
    this.setSnapshot(line.textFrom);
    return true;
  }

  /** Ref of the element that holds the open cell (the row re-renders around it; a moved row gives a new element). */
  attach = (element: HTMLElement | null) => {
    if (!element) { this.host = null; return; }
    this.host = element;
    const view = this.view;
    if (!view) return;
    if (view.dom.parentElement !== element) element.append(view.dom);
    view.requestMeasure();
    view.focus();
    if (this.hint) {
      const caret = this.caretFor(this.hint, view);
      this.hint = null;
      view.dispatch({ selection: EditorSelection.cursor(caret), scrollIntoView: true });
    }
    this.relocating = false;
  };

  /** Leave the cell. With `focusStatic` the line's own (static) cell gets focus back after the render. */
  finish(focusStatic: boolean) {
    const at = this.snapshot;
    this.close();
    if (focusStatic && at !== null) {
      const line = this.model() && scriptLines(this.model()!).find(item => item.textFrom === at);
      if (line) this.focusTarget = { kind: 'line', start: line.start };
    }
    this.setSnapshot(null);
  }

  destroy() { this.close(); this.listeners.clear(); }

  private close() {
    const view = this.view;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.view = null;
    this.host = null;
    this.hint = null;
    this.relocating = false;
    view?.destroy();
  }

  private place(line: ScriptLine) {
    this.from = line.textFrom;
    this.to = line.to;
    this.ownEnd = Math.max(line.textFrom, Math.min(line.ownTo, line.to));
  }

  private caretFor(hint: CaretHint, view: EditorView): number {
    const length = view.state.doc.length;
    const end = Math.max(0, Math.min(length, this.ownEnd - this.from));
    if (hint === 'start') return 0;
    if (hint === 'end') return end;
    const at = view.posAtCoords(hint);
    return at === null ? end : Math.min(at, end);
  }

  private base(textFrom: number): number {
    const main = this.main();
    if (!main) return 0;
    return analyzeDraftReferences(main.state.doc.toString()).filter(span => span.from < textFrom).length;
  }

  private attributes(line: ScriptLine | null): Extension {
    const note = !!line && isPictureNote(line);
    const name = line?.number !== undefined ? `第 ${line.number} 行${note ? '画面说明' : '旁白'}` : note ? '画面说明' : '新的一行';
    return [
      EditorView.contentAttributes.of({ 'aria-label': name, role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', translate: 'no', ...(this.describedBy ? { 'aria-describedby': this.describedBy } : {}) }),
      placeholderExtension(note ? '写下这个镜头' : '写下这一行'),
    ];
  }

  private createView(text: string, line: ScriptLine | null): EditorView {
    const keys = [
      { key: 'Escape', run: () => { this.finish(true); return true; } },
      { key: 'Mod-Enter', run: () => { this.finish(true); return true; } },
      { key: 'Enter', run: () => this.split() },
      { key: 'Shift-Enter', run: () => this.split() },
      { key: 'Alt-ArrowUp', run: () => this.stepCurrent(-1) },
      { key: 'Alt-ArrowDown', run: () => this.stepCurrent(1) },
      { key: 'Mod-z', preventDefault: true, run: () => { this.undo(); return true; } },
      { key: 'Mod-y', preventDefault: true, run: () => { this.redo(); return true; } },
      { key: 'Shift-Mod-z', preventDefault: true, run: () => { this.redo(); return true; } },
      { key: 'Mod-s', preventDefault: true, run: () => { this.options.onSave?.(); return true; } },
      { key: 'Backspace', run: (view: EditorView) => this.removeEmpty(view) },
      { key: 'ArrowUp', run: (view: EditorView) => this.edge(view, -1) },
      { key: 'ArrowDown', run: (view: EditorView) => this.edge(view, 1) },
    ];
    const view = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: [
          drawSelection(),
          EditorView.lineWrapping,
          keymap.of(keys),
          keymap.of(defaultKeymap.filter(binding => !binding.key || !RESERVED.has(binding.key))),
          this.names.of(this.attributes(line)),
          this.scope.of(referenceScope.of({ base: this.base(this.from) })),
          this.label.of(labelDecoration(cellLabel(line))),
          referenceExtension,
          markdownExtension,
          protectReferences,
          scriptCellTheme,
          EditorView.domEventHandlers({
            keydown: event => {
              // Esc closes the cell, not focus writing or the panel (the inspector routes Esc on its root).
              if (event.key === 'Escape' && !event.isComposing) event.stopPropagation();
              return false;
            },
            focusout: (event, current) => {
              const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
              if (next && current.dom.contains(next)) return false;
              window.setTimeout(() => { if (this.view === current && !this.relocating && !current.hasFocus) this.finish(false); }, 0);
              return false;
            },
            compositionend: () => { if (this.recheck) { this.recheck = false; queueMicrotask(() => this.check()); } return false; },
          }),
        ],
      }),
      dispatchTransactions: (transactions, current) => this.fromCellTransactions(transactions, current),
    });
    view.dom.classList.add('script-cell__editor');
    view.dispatch({ effects: setReferenceInfo.of(this.info), annotations: fromBody.of(true) });
    return view;
  }

  /** Cell → body: the same change shifted by the cell's offset, with the cell's selection and user event. */
  private fromCellTransactions(transactions: readonly Transaction[], view: EditorView) {
    for (const transaction of transactions) {
      const main = this.main();
      if (!transaction.docChanged || transaction.annotation(fromBody) || !main) {
        view.update([transaction]);
        if (main && transaction.selection && !transaction.annotation(fromBody) && view === this.view) {
          main.dispatch({ selection: EditorSelection.create(transaction.newSelection.ranges.map(range => shiftRange(range, this.from)), transaction.newSelection.mainIndex), annotations: fromCell.of(true) });
        }
        continue;
      }
      const changes: TextChange[] = [];
      transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => changes.push({ from: fromA + this.from, to: toA + this.from, insert: inserted.toString() }));
      const before = main.state.doc;
      const userEvent = transaction.annotation(Transaction.userEvent);
      main.dispatch({
        changes,
        selection: EditorSelection.create(transaction.newSelection.ranges.map(range => shiftRange(range, this.from)), transaction.newSelection.mainIndex),
        annotations: fromCell.of(true),
        scrollIntoView: false,
        ...(userEvent ? { userEvent } : {}),
      });
      // Refused by the body (read-only window, length limit): the cell keeps the stored text too.
      if (main.state.doc === before) continue;
      view.update([transaction]);
      const delta = transaction.newDoc.length - transaction.startState.doc.length;
      this.to += delta;
      this.ownEnd = Math.min(this.to, Math.max(this.from, transaction.changes.mapPos(this.ownEnd - this.from, 1) + this.from));
      this.edited = true;
      queueMicrotask(() => this.check());
    }
  }

  /** After typing: when the paragraph's shape changed (a label typed, a paragraph pasted), follow the caret's line. */
  private check() {
    const main = this.main(), view = this.view;
    if (!main || !view) return;
    if (view.composing) { this.recheck = true; return; }
    const model = buildScript(main.state.doc.toString());
    const head = main.state.selection.main.head;
    const line = lineAt(model, head);
    if (!line) return; // An emptied cell: no paragraph to show, the cell stays where it is.
    if (!editable(line)) { this.finish(false); return; }
    if (line.textFrom === this.from && line.to === this.to) return;
    // Every word deleted but the excerpt kept: the link alone folds into the line above for now; the cell stays here,
    // so what is typed next becomes this line's words again, with its picture.
    if (wordless(view)) return;
    this.retarget(line, head);
  }

  /** Body → cell: an undo, a move, a split, a restore. The cell goes to the line that holds the body's caret. */
  private onBody = (update: ViewUpdate) => {
    if (!this.view || !update.docChanged) return;
    if (update.transactions.every(transaction => transaction.annotation(fromCell))) return;
    queueMicrotask(() => this.resync());
  };

  private resync() {
    const main = this.main();
    if (!main || !this.view) return;
    const text = main.state.doc.toString();
    const head = main.state.selection.main.head;
    const line = lineAt(buildScript(text), head);
    if (line && editable(line)) { this.retarget(line, head); return; }
    if (!line && blankLineAt(text, head)) { this.retargetEmpty(head); return; }
    this.finish(false);
  }

  private retarget(line: ScriptLine, head: number) {
    const main = this.main(), view = this.view;
    if (!main || !view) return;
    const text = main.state.doc.sliceString(line.textFrom, line.to);
    this.place(line);
    const current = view.state.doc.toString();
    // The caret stays in the words: a position inside an excerpt folded at the end goes before it.
    const caret = Math.max(0, Math.min(head, this.ownEnd) - line.textFrom);
    view.dispatch({
      ...(current === text ? {} : { changes: minimalChange(current, text) }),
      selection: EditorSelection.cursor(Math.min(caret, text.length)),
      effects: [this.scope.reconfigure(referenceScope.of({ base: this.base(line.textFrom) })), this.label.reconfigure(labelDecoration(cellLabel(line))), this.names.reconfigure(this.attributes(line))],
      annotations: fromBody.of(true),
    });
    if (this.snapshot !== line.textFrom) { this.relocating = true; this.setSnapshot(line.textFrom); }
  }

  /** A new, still empty paragraph at `position` (after Enter at the end of a line): a cell with nothing in it yet. */
  private retargetEmpty(position: number) {
    const view = this.view;
    if (!view) return;
    this.from = this.to = this.ownEnd = position;
    const current = view.state.doc.toString();
    view.dispatch({
      ...(current ? { changes: { from: 0, to: current.length, insert: '' } } : {}),
      effects: [this.scope.reconfigure(referenceScope.of({ base: this.base(position) })), this.label.reconfigure([]), this.names.reconfigure(this.attributes(null))],
      annotations: fromBody.of(true),
    });
    if (this.snapshot !== position) { this.relocating = true; this.setSnapshot(position); }
  }

  /** The line whose cell is open, from the body as it is now (null for an emptied, not yet written paragraph). */
  private current(model: ScriptModel): ScriptLine | undefined {
    return scriptLines(model).find(line => line.textFrom === this.from);
  }

  // ── Enter, Backspace, arrows inside a cell ─────────────────────────────────────────────────────────────────────

  private split(): boolean {
    const main = this.main(), view = this.view;
    if (!main || !view) return true;
    const selection = view.state.selection.main;
    if (!selection.empty) view.dispatch({ changes: { from: selection.from, to: selection.to }, selection: EditorSelection.cursor(selection.from), userEvent: 'delete' });
    const text = main.state.doc.toString();
    const model = buildScript(text);
    const line = this.current(model);
    if (!line) return true; // Enter in a still empty paragraph: nothing to split.
    const position = this.from + view.state.selection.main.head;
    const { change, caret } = splitLine(text, line, position);
    main.dispatch({ changes: change, selection: EditorSelection.cursor(caret), userEvent: 'input', scrollIntoView: false });
    return true;
  }

  private removeEmpty(view: EditorView): boolean {
    const main = this.main();
    if (!main || view.state.doc.length) return false;
    const removal = removeEmptyLine(main.state.doc.toString(), this.from);
    if (!removal) return true;
    main.dispatch({ changes: removal.change, selection: EditorSelection.cursor(removal.caret), userEvent: 'delete.backward', scrollIntoView: false });
    return true;
  }

  /** ↑ on the first visual line / ↓ on the last: the cell of the line above / below. */
  private edge(view: EditorView, direction: -1 | 1): boolean {
    const selection = view.state.selection.main;
    if (!selection.empty) return false;
    const moved = view.moveVertically(selection, direction > 0);
    if (moved.head !== selection.head) return false;
    const model = this.model();
    if (!model) return false;
    const lines = scriptLines(model).filter(editable);
    const index = lines.findIndex(line => line.textFrom === this.from);
    const target = index < 0 ? undefined : lines[index + direction];
    if (!target) return false;
    this.start(target, direction > 0 ? 'start' : 'end');
    return true;
  }

  // ── Moves (rows and scenes), undo and redo: transactions on the body editor ─────────────────────────────────────

  private stepCurrent(direction: -1 | 1): boolean {
    const model = this.model();
    const line = model && this.current(model);
    if (model && line) this.step(line, direction, model);
    return true;
  }

  /** Alt+↑ / Alt+↓: one row up or down, across scene boundaries. */
  step(line: ScriptLine, direction: -1 | 1, model = this.model()): boolean {
    if (!model) return false;
    const slot = stepSlot(model, line, direction);
    return slot ? this.moveLine(line, slot, model) : false;
  }

  /** Move a line to a slot as one undo step; the caret (and an open cell) goes with it. */
  moveLine(line: ScriptLine, slot: ScriptSlot, model = this.model()): boolean {
    const main = this.main();
    if (!main || !model || this.readOnly) return false;
    const text = main.state.doc.toString();
    const result = moveLine(text, model, line, slot);
    if (!result) return false;
    const head = main.state.selection.main.head;
    const caret = this.view && head >= line.start && head <= line.to ? head + result.shift : result.start + (line.textFrom - line.start);
    main.dispatch({ changes: result.changes, selection: EditorSelection.cursor(caret), userEvent: 'move.line', annotations: isolateHistory.of('full'), scrollIntoView: false });
    this.edited = true;
    const moved = scriptLines(buildScript(main.state.doc.toString())).find(item => item.start === result.start);
    const scene = buildScript(main.state.doc.toString()).scenes[slot.scene];
    const where = scene?.headed ? `「${scene.title || '未命名的一场'}」` : '开头';
    this.notice = { kind: 'line', start: result.start, message: `已移到${where}${moved?.number !== undefined ? `，现在是第 ${moved.number} 行` : ''}` };
    if (!this.view) this.focusTarget = { kind: 'line', start: result.start };
    this.emit();
    return true;
  }

  /** Move a whole scene before another one (or to the end) as one undo step. */
  moveScene(index: number, before: number, model = this.model()): boolean {
    const main = this.main();
    if (!main || !model || this.readOnly) return false;
    if (this.view) this.finish(false);
    const result = moveScene(main.state.doc.toString(), model, index, before);
    if (!result) return false;
    main.dispatch({ changes: result.changes, selection: EditorSelection.cursor(result.start), userEvent: 'move.scene', annotations: isolateHistory.of('full'), scrollIntoView: false });
    this.edited = true;
    const title = model.scenes[index].title || '未命名的一场';
    const position = buildScript(main.state.doc.toString()).scenes.filter(scene => scene.headed).findIndex(scene => scene.from === result.start) + 1;
    this.notice = { kind: 'scene', start: result.start, message: `「${title}」已移到第 ${position} 场` };
    this.focusTarget = { kind: 'scene', start: result.start };
    this.emit();
    return true;
  }

  /** Alt+↑ / Alt+↓ on a scene's handle. */
  stepScene(index: number, direction: -1 | 1): boolean {
    const model = this.model();
    if (!model) return false;
    const before = stepScene(model, index, direction);
    return before === null ? false : this.moveScene(index, before, model);
  }

  /** Undo / redo in the body's history (the cell's typing, moves, 正文 edits: one history). */
  undo(): boolean { return this.history(undo); }
  redo(): boolean { return this.history(redo); }
  private history(command: typeof undo): boolean {
    const main = this.main();
    if (!main || this.readOnly) return false;
    const done = command({ state: main.state, dispatch: transaction => main.dispatch(transaction) });
    if (done && !this.view) {
      // From a static cell: focus goes to the line the undone change was in (the old element may be gone).
      const line = lineAt(buildScript(main.state.doc.toString()), main.state.selection.main.head);
      if (line) this.focusTarget = { kind: 'line', start: line.start };
      this.edited = true;
      this.emit();
    }
    return done;
  }
}
