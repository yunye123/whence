import { parseDraftReferences } from '../../draft-references';
import { isScriptLine } from './script-model';
import type { ScriptLine, ScriptModel } from './script-model';

/**
 * 脚本视图的编辑（DESIGN_SYSTEM §6.29 “编辑”）：都是对同一份 Markdown `body` 的文本改动（K1）。
 * - 移动一行 = 把这一段（连同折进它的引用段）挪到另一处，前后各留一个空行；跨场同理。
 * - 移动一场 = 把从 `##` 到本场最后一行的整块挪到另一场之前（或最后）。
 * - 在旁白格里按 Enter = 在光标处把这一段分成两段；光标在这一行自己的字的末尾时，新段落放在这一行（含引用）之后。
 * 每个函数只给出改动（起止都在改动前的正文里，UTF-16 偏移，K9-14）与改动后的正文，由调用方作为一步撤销派发。
 */

export interface TextChange { from: number; to: number; insert: string }
export interface ScriptMove {
  changes: TextChange[];
  body: string;
  /** Where the moved block starts in the new body. */
  start: number;
  /** New start minus old start: maps a position inside the moved block. */
  shift: number;
}

/** Insert before `scenes[scene].rows[row]`; `row === rows.length` is the end of the scene. */
export interface ScriptSlot { scene: number; row: number }

function apply(text: string, changes: readonly TextChange[]): string {
  let out = text;
  for (const change of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  return out;
}

const blank = (text: string, from: number, to: number) => !text.slice(from, to).trim();
/** Start of the line holding `position` (`lastIndexOf('\n', -1)` would still look at index 0). */
export const lineStartOf = (text: string, position: number) => position <= 0 ? 0 : text.lastIndexOf('\n', position - 1) + 1;

/** Start of the first non-blank line after the line that ends at `end` (end = a line end), or -1 at the end of the text. */
export function nextContentStart(text: string, end: number): number {
  let position = end;
  while (position < text.length) {
    const lineStart = position + 1;
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline < 0 ? text.length : newline;
    if (!blank(text, lineStart, lineEnd)) return lineStart;
    if (newline < 0) return -1;
    position = lineEnd;
  }
  return -1;
}

/** End of the last non-blank line before the line that starts at `start`, or 0. */
export function previousContentEnd(text: string, start: number): number {
  let position = start;
  while (position > 0) {
    const lineEnd = position - 1;
    const lineStart = lineStartOf(text, lineEnd);
    if (!blank(text, lineStart, lineEnd)) return lineEnd;
    position = lineStart;
  }
  return 0;
}

/** Where a line sits: its scene and its index among the scene's rows (lines and beats). */
export function lineSlot(model: ScriptModel, line: ScriptLine): ScriptSlot | null {
  for (let scene = 0; scene < model.scenes.length; scene++) {
    const row = model.scenes[scene].rows.findIndex(item => isScriptLine(item) && item.from === line.from);
    if (row >= 0) return { scene, row };
  }
  return null;
}

/** All the lines in body order. */
export const scriptLines = (model: ScriptModel): ScriptLine[] => model.scenes.flatMap(scene => scene.rows.filter(isScriptLine));

/** The line whose block holds `position` (its own start to its end, folded references included). */
export function lineAt(model: ScriptModel, position: number): ScriptLine | undefined {
  return scriptLines(model).find(line => line.start <= position && position <= line.to);
}

/** The scene a position belongs to (the last scene starting at or before it). */
export function sceneAt(model: ScriptModel, position: number): number {
  let found = 0;
  model.scenes.forEach((scene, index) => { if (scene.from <= position) found = index; });
  return found;
}

/**
 * The slot one step up or down from a line (Alt+↑ / Alt+↓): past the neighbouring row of its scene; from a scene's
 * first row up to the end of the scene before, from its last row down to the start of the scene after.
 */
export function stepSlot(model: ScriptModel, line: ScriptLine, direction: -1 | 1): ScriptSlot | null {
  const at = lineSlot(model, line);
  if (!at) return null;
  const rows = model.scenes[at.scene].rows;
  if (direction < 0) {
    if (at.row > 0) return { scene: at.scene, row: at.row - 1 };
    return at.scene > 0 ? { scene: at.scene - 1, row: model.scenes[at.scene - 1].rows.length } : null;
  }
  if (at.row < rows.length - 1) return { scene: at.scene, row: at.row + 2 };
  return at.scene < model.scenes.length - 1 ? { scene: at.scene + 1, row: 0 } : null;
}

/** Whether dropping a line in a slot leaves it where it is (just above or just below itself). */
export function isSameSlot(model: ScriptModel, line: ScriptLine, slot: ScriptSlot): boolean {
  const at = lineSlot(model, line);
  return !!at && at.scene === slot.scene && (slot.row === at.row || slot.row === at.row + 1);
}

/** Cut [remFrom, remTo) and put `block` at `at` (before a block: block + blank line; at an end: blank line + block). */
function relocate(text: string, block: { from: number; to: number }, remove: { from: number; to: number }, at: number, atEnd: boolean): ScriptMove | null {
  if (at > remove.from && at < remove.to) return null;
  const moved = text.slice(block.from, block.to);
  const insert = atEnd ? `\n\n${moved}` : `${moved}\n\n`;
  const changes: TextChange[] = [{ from: remove.from, to: remove.to, insert: '' }, { from: at, to: at, insert }].sort((a, b) => a.from - b.from || a.to - b.to);
  const body = apply(text, changes);
  if (body === text) return null;
  const offset = atEnd ? 2 : 0;
  const start = at <= remove.from ? at + offset : at - (remove.to - remove.from) + offset;
  return { changes, body, start, shift: start - block.from };
}

/** The text to cut for a block: with the blank lines after it, or (last in the text) the blank lines before it. */
function cutRange(text: string, from: number, to: number, joined: boolean): { from: number; to: number } {
  // Written right under its heading (no blank line): take the line break before it, so the heading keeps its own line.
  if (joined) return { from: from - 1, to };
  const next = nextContentStart(text, to);
  return next >= 0 ? { from, to: next } : { from: previousContentEnd(text, from), to };
}

/**
 * Move a line (one paragraph, with the reference blocks folded into it) to a slot. The rest of the body is unchanged
 * byte for byte apart from the blank lines around the moved paragraph. Null when the slot is where the line already is.
 */
export function moveLine(body: string, model: ScriptModel, line: ScriptLine, slot: ScriptSlot): ScriptMove | null {
  const text = body.replace(/\r\n?/g, '\n');
  const scene = model.scenes[slot.scene];
  if (!scene || slot.row < 0 || slot.row > scene.rows.length || isSameSlot(model, line, slot)) return null;
  const remove = cutRange(text, line.start, line.to, line.start > line.from);
  const target = scene.rows[slot.row];
  if (!target) return relocate(text, { from: line.start, to: line.to }, remove, scene.to, true);
  return relocate(text, { from: line.start, to: line.to }, remove, isScriptLine(target) ? target.start : target.from, false);
}

/** Move a whole scene (its heading and every row under it) before another scene, or to the end (`before === scenes.length`). */
export function moveScene(body: string, model: ScriptModel, index: number, before: number): ScriptMove | null {
  const text = body.replace(/\r\n?/g, '\n');
  const scene = model.scenes[index];
  if (!scene?.headed || before === index || before === index + 1 || before < 0 || before > model.scenes.length) return null;
  // The untitled lead stays first: nothing moves above it.
  if (before < model.scenes.length && !model.scenes[before].headed) return null;
  const remove = cutRange(text, scene.from, scene.to, false);
  if (before === model.scenes.length) {
    const last = model.scenes[model.scenes.length - 1];
    return relocate(text, { from: scene.from, to: scene.to }, remove, last.to, true);
  }
  return relocate(text, { from: scene.from, to: scene.to }, remove, model.scenes[before].from, false);
}

/** The scene one step up or down (Alt+↑ / Alt+↓ on its handle), as the `before` index for moveScene. */
export function stepScene(model: ScriptModel, index: number, direction: -1 | 1): number | null {
  if (!model.scenes[index]?.headed) return null;
  if (direction < 0) return index > 0 && model.scenes[index - 1].headed ? index - 1 : null;
  return index < model.scenes.length - 1 ? index + 2 : null;
}

/**
 * Enter in a line's cell at `position`: a new paragraph. In the middle of the words the paragraph splits there (a
 * quotation keeps its mark on the new part); at the end of the line's own words the new paragraph goes after the
 * whole line, so the excerpt folded into this line stays with it. Returns the change and the caret in the new body.
 */
export function splitLine(body: string, line: ScriptLine, position: number): { change: TextChange; caret: number } {
  const text = body.replace(/\r\n?/g, '\n');
  const ownEnd = Math.min(line.ownTo, line.to);
  const from = Math.max(line.textFrom, position);
  // Only reference links left after the caret (an inline “…”[来源](…) ending the line) count as the end of the words.
  let words = text.slice(from, Math.max(from, ownEnd));
  for (const reference of parseDraftReferences(text)) {
    if (reference.from >= from && reference.to <= ownEnd) words = words.replace(text.slice(reference.from, reference.to), '');
  }
  if (position >= ownEnd || !words.trim()) return { change: { from: line.to, to: line.to, insert: '\n\n' }, caret: line.to + 2 };
  if (line.kind === 'quote') {
    // Right after a continuation line's “> ”: split before that line, so no empty quotation line is left behind.
    const lineStart = lineStartOf(text, position);
    if (lineStart > line.start && /^[ \t]{0,3}>[ \t]?$/.test(text.slice(lineStart, position))) {
      return { change: { from: lineStart - 1, to: position, insert: '\n\n> ' }, caret: lineStart - 1 + 4 };
    }
    return { change: { from: position, to: position, insert: '\n\n> ' }, caret: position + 4 };
  }
  return { change: { from: position, to: position, insert: '\n\n' }, caret: position + 2 };
}

/**
 * Backspace in an emptied cell: take the empty paragraph (the blank lines it left) out again, caret at the end of the
 * line above. `at` is where the empty paragraph was; null when there is no line above in the text.
 */
export function removeEmptyLine(body: string, at: number): { change: TextChange; caret: number } | null {
  const text = body.replace(/\r\n?/g, '\n');
  const lineStart = lineStartOf(text, at);
  const newline = text.indexOf('\n', at);
  const lineEnd = newline < 0 ? text.length : newline;
  if (!blank(text, lineStart, lineEnd) || lineStart === 0) return null;
  const end = previousContentEnd(text, lineStart);
  // Remove from the end of the paragraph above to the start of this empty line: the paragraph above keeps its own
  // blank line to whatever follows.
  return { change: { from: end, to: lineStart, insert: '' }, caret: end };
}

/** A reference's hidden range in a cell: the link (and, when hoisted to the paragraph's end, the blank lines before it). */
export interface ProtectedRange { from: number; to: number; hoisted?: boolean }

/**
 * Keep reference links whole in a script cell (§6.29 “出处签在格内仍是签”): a change that cuts into a reference keeps
 * only its parts outside the reference; typing just after an excerpt hoisted to the end of the paragraph goes before it
 * (the link keeps its own line, so it stays this line's picture). Null when nothing needed changing. `caret` is where
 * the caret belongs, in the document before the change (map it through the result with assoc 1).
 */
export function keepReferences(changes: readonly TextChange[], protect: readonly ProtectedRange[]): { changes: TextChange[]; caret: number } | null {
  let touched = false;
  let caret = 0;
  const out: TextChange[] = [];
  for (const change of changes) {
    let { from, to } = change;
    const { insert } = change;
    const after = insert && from === to ? protect.find(range => range.hoisted && from === range.to) : undefined;
    if (after) { from = to = after.from; touched = true; }
    const container = protect.find(range => from > range.from && from < range.to);
    const hits = protect.filter(range => from < range.to && to > range.from);
    if (!hits.length && !container) { out.push({ from, to, insert }); caret = from; continue; }
    touched = true;
    let pieces: [number, number][] = from < to ? [[from, to]] : [];
    for (const range of hits) {
      pieces = pieces.flatMap(([a, b]): [number, number][] => a < range.to && b > range.from
        ? ([[a, Math.min(b, range.from)], [Math.max(a, range.to), b]] as [number, number][]).filter(([x, y]) => y > x)
        : [[a, b]]);
    }
    // Text typed inside a reference (IME can put it there) lands next to it: before a hoisted one, after an inline one.
    const at = container ? (container.hoisted ? container.from : container.to) : from;
    let placed = !insert;
    for (const [a, b] of pieces) {
      if (!placed && a === at) { out.push({ from: a, to: b, insert }); placed = true; }
      else out.push({ from: a, to: b, insert: '' });
    }
    if (!placed) out.push({ from: at, to: at, insert });
    caret = at;
  }
  if (!touched) return null;
  return { changes: out.sort((a, b) => a.from - b.from || a.to - b.to), caret };
}