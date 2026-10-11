import type { CaretHint, MoveNotice, ScriptEditingEngine, ScriptEditingOptions } from './cell-editing';
import type { ReferenceInfo } from '../draft-editor/references';
import type { ScriptLine, ScriptModel } from './script-model';
import type { ScriptSlot } from './script-edit';
import { loadedDraftEditor } from '../draft-editor/editor-loader';

/**
 * The script table's editing session (§6.29), as the script view and the writing section use it. The work is done by
 * ScriptEditingEngine (cell-editing.ts), which needs CodeMirror and so arrives with the editor chunk (CORE-32). The
 * panel opens a draft once that chunk is in, so the engine exists from the start and every call goes straight to it.
 * Without it (server rendering, or the editor still on its way) the session answers like an engine whose body editor
 * has not mounted yet (no open cell, nothing moves), and it starts the engine on the first call after the chunk arrives.
 */
export class ScriptEditing {
  private engine: ScriptEditingEngine | null = null;
  private destroyed = false;
  private readonly waiting = new Set<() => void>();
  private info: ReadonlyMap<number, ReferenceInfo> | null = null;
  private state = { edited: false, readOnly: false, describedBy: '' };

  constructor(private readonly options: ScriptEditingOptions) { this.connect(); }

  private connect(): ScriptEditingEngine | null {
    if (this.engine || this.destroyed) return this.engine;
    const kit = loadedDraftEditor();
    if (!kit) return null;
    const engine = new kit.ScriptEditingEngine(this.options);
    engine.edited = this.state.edited;
    engine.readOnly = this.state.readOnly;
    engine.describedBy = this.state.describedBy;
    if (this.info) engine.setReferenceInfo(this.info);
    // Listeners that subscribed before the engine existed hear its changes from now on.
    if (this.waiting.size) engine.subscribe(() => { for (const listener of [...this.waiting]) listener(); });
    this.engine = engine;
    return engine;
  }

  subscribe = (listener: () => void) => {
    const engine = this.connect();
    if (engine) return engine.subscribe(listener);
    this.waiting.add(listener);
    return () => { this.waiting.delete(listener); };
  };
  getSnapshot = () => this.engine ? this.engine.getSnapshot() : null;

  /** A cell or a move changed the body since the script was opened (正文 then shows where). */
  get edited() { return this.engine ? this.engine.edited : this.state.edited; }
  set edited(value: boolean) { if (this.engine) this.engine.edited = value; else this.state.edited = value; }
  get readOnly() { return this.engine ? this.engine.readOnly : this.state.readOnly; }
  set readOnly(value: boolean) { if (this.engine) this.engine.readOnly = value; else this.state.readOnly = value; }
  /** sr-only description of the cell's keys (ScriptView's hint element). */
  get describedBy() { return this.engine ? this.engine.describedBy : this.state.describedBy; }
  set describedBy(value: string) { if (this.engine) this.engine.describedBy = value; else this.state.describedBy = value; }

  setReferenceInfo(info: ReadonlyMap<number, ReferenceInfo>) { this.info = info; this.connect()?.setReferenceInfo(info); }
  takeFocusTarget(): { kind: 'line' | 'scene'; start: number } | null { return this.connect()?.takeFocusTarget() ?? null; }
  takeNotice(): MoveNotice | null { return this.connect()?.takeNotice() ?? null; }
  start(line: ScriptLine, hint: CaretHint): boolean { return this.connect()?.start(line, hint) ?? false; }
  attach = (element: HTMLElement | null) => { this.connect()?.attach(element); };
  finish(focusStatic: boolean) { this.connect()?.finish(focusStatic); }
  destroy() { this.destroyed = true; this.waiting.clear(); this.engine?.destroy(); }
  step(line: ScriptLine, direction: -1 | 1, model?: ScriptModel | null): boolean { return this.connect()?.step(line, direction, model) ?? false; }
  moveLine(line: ScriptLine, slot: ScriptSlot, model?: ScriptModel | null): boolean { return this.connect()?.moveLine(line, slot, model) ?? false; }
  moveScene(index: number, before: number, model?: ScriptModel | null): boolean { return this.connect()?.moveScene(index, before, model) ?? false; }
  stepScene(index: number, direction: -1 | 1): boolean { return this.connect()?.stepScene(index, direction) ?? false; }
  undo(): boolean { return this.connect()?.undo() ?? false; }
  redo(): boolean { return this.connect()?.redo() ?? false; }
}
