import { parseDraftReferences } from '../../draft-references';
import type { DraftReference } from '../../draft-references';
import type { BoardNode } from '../../model';
import { draftParagraphIndexAt, plainMarkdown, singleLineText } from '../../source-location';

/**
 * 脚本视图的数据（DESIGN_SYSTEM §6.29）：同一份 Markdown `body` 的另一种排版，不新增字段（K1）。
 * - `## 标题` = 一场；标题里写的时间段（“开场 00:00–00:43”）是这一场在原片里的位置。
 * - 场下每个段落 = 一行；行号就是写作页左侧的段号（draftParagraphIndexAt），两边逐行一致。
 * - 段落里引用的视频摘录（`field://…&t=`）= 这一行的画面；只有引用链接的段落折进上一行（与写作页的上标一致）。
 * - 时长：一行 = 它引用的视频片段起止之和；一场 = 标题写明的时间段，没写时取各行之和；都没有时为 undefined（界面写“—”）。
 */

/** Where a reference points in a film. `video: false` (a text excerpt) makes it a footnote, not a shot. */
export interface ScriptTime { video: boolean; start?: number; end?: number }
export type ScriptTimeResolver = (reference: DraftReference, index: number) => ScriptTime | undefined;

export interface ScriptShot {
  /** 1-based body order, the same number as the superscript, the footnote and the margin card. */
  reference: number;
  sourceNodeId: string;
  quoteNodeId?: string;
  start?: number;
  end?: number;
}
export type ScriptSegment = { text: string } | { footnote: number };
export type ScriptLineKind = 'text' | 'quote' | 'list' | 'code';

export interface ScriptLine {
  /** The paragraph number the writing page shows for this paragraph; undefined for a reference with no paragraph. */
  number?: number;
  /** Block range in the LF-normalised body, including the reference-only blocks folded into it. */
  from: number;
  to: number;
  /** Where this line's own text starts: `from`, or the line after a `##` heading written right above it (no blank line). */
  start: number;
  /** End of the line's own block, before the reference-only blocks folded into it (`to` when nothing is folded). */
  ownTo: number;
  /**
   * Start of the range the script cell edits ([textFrom, to]): after a writer's label (“画面：”), which stays a label;
   * the start of the block for quotations and lists, whose marks the cell keeps (hidden, as in 正文).
   */
  textFrom: number;
  /** Where the caret goes when this line is edited in 正文: the first character of its own words. */
  caret: number;
  kind: ScriptLineKind;
  /** A leading “画面：”“旁白：”… written by the writer, shown as a quiet label instead of text. */
  label?: string;
  segments: ScriptSegment[];
  shots: ScriptShot[];
  /** Seconds covered by the timed shots of this line. */
  duration?: number;
}

export interface ScriptBeat { kind: 'beat'; title: string; from: number; to: number }

export interface ScriptScene {
  /** Scene title without the time range; '' for the lines before the first `##` (or a draft without scenes). */
  title: string;
  /** False for the untitled lead: the lines before the first scene heading. */
  headed: boolean;
  from: number;
  /** End of the scene's last row (or of its heading line when it has none). */
  to: number;
  /** The time range written in the heading, in seconds. */
  heading?: { start: number; end?: number };
  rows: (ScriptLine | ScriptBeat)[];
  duration?: number;
  durationFrom?: 'heading' | 'shots';
}

export interface ScriptModel {
  scenes: ScriptScene[];
  /** Headed scenes only (the untitled lead is not a scene). */
  sceneCount: number;
  lineCount: number;
  /** Sum of the scene durations that are known. */
  total?: number;
  /** Headed scenes whose duration is not known. */
  untimedScenes: number;
  /** Shots with a start time (a frame to show and a place to return to). */
  timedShots: number;
  /** Headings that carry a time range. */
  timedHeadings: number;
  /** Lines that start with a script label (画面：…). */
  labeledLines: number;
  /** Distinct video sources referenced anywhere, in body order. */
  videoSources: string[];
}

export const isScriptLine = (row: ScriptLine | ScriptBeat): row is ScriptLine => (row as ScriptBeat).kind !== 'beat';

/**
 * A line the writer marked “画面：” or “镜头：” that has no excerpt yet: it describes the picture, so the script shows it in
 * the 画面 column (a shot still to find), not under 旁白.
 */
export const isPictureNote = (line: ScriptLine): boolean => !line.shots.length && (line.label === '画面' || line.label === '镜头');

const HEADING = /^[ \t]{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const QUOTE = /^[ \t]{0,3}>[ \t]?/;
const LIST = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/;
/** Labels a script writer puts before a paragraph. “口播” is deliberately not one of them (K11). */
const LABEL = /^(画面|镜头|旁白|字幕|音效|同期声|配乐|转场)[ \t]*[：:][ \t]*/;
const CLOCK = '(\\d{1,2}:\\d{2}(?::\\d{2})?)';
const RANGE = new RegExp(`${CLOCK}(?:[ \\t]*[–—~～\\-至到][ \\t]*${CLOCK})?`);

/** “01:12” → 72, “1:02:03” → 3723. */
export function parseClock(value: string): number | undefined {
  const parts = value.split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return undefined;
}

/**
 * A time range written in a scene heading: “开场 00:00–00:43”, “开场（00:00 - 00:43）”, “00:43~01:50 展开”.
 * Returns the seconds and the title with the range (and the brackets or separators around it) taken out.
 */
export function headingTime(text: string): { title: string; start?: number; end?: number } {
  const match = RANGE.exec(text);
  if (!match) return { title: text.trim() };
  const start = parseClock(match[1]);
  const end = match[2] ? parseClock(match[2]) : undefined;
  if (start === undefined) return { title: text.trim() };
  const before = text.slice(0, match.index).replace(/[ \t]*[（(【\[｜|·•—–-]?[ \t]*$/, '');
  const after = text.slice(match.index + match[0].length).replace(/^[ \t]*[）)】\]｜|·•—–-]?[ \t]*/, '');
  // A range is the scene's place and comes out of the title; a single clock time only when it stands at either end
  // (“早上 7:10 的公交” keeps its words).
  const strip = !!match[2] || !before.trim() || !after.trim();
  const title = strip ? `${before}${before && after ? ' ' : ''}${after}`.trim() : text.trim();
  return { title, start, ...(end !== undefined && end > start ? { end } : {}) };
}

/** Seconds as a duration: 0:14, 2:20, 1:02:03. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600), minutes = Math.floor((whole % 3600) / 60), rest = whole % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Without the board, a reference with `t=` is the only sign of a film position. */
export const bodyTimeResolver: ScriptTimeResolver = reference => reference.time !== undefined ? { video: true, start: reference.time } : undefined;

/** The board's view of each reference: the excerpt's own start and end when it is still there (same rule as resolveReferences). */
export function scriptTimeResolver(nodes: readonly BoardNode[]): ScriptTimeResolver {
  const byId = new Map(nodes.map(node => [node.id, node]));
  return reference => {
    const source = byId.get(reference.sourceNodeId);
    const candidate = reference.quoteNodeId ? byId.get(reference.quoteNodeId) : undefined;
    const citation = candidate?.data.kind === 'quote' && candidate.data.citation?.nodeId === reference.sourceNodeId ? candidate.data.citation : undefined;
    const video = source?.data.kind === 'video' || reference.time !== undefined || citation?.start !== undefined;
    if (!video) return undefined;
    const start = citation?.start ?? reference.time;
    return { video, start, end: citation?.end };
  };
}

type LineKind = 'blank' | 'heading' | 'fence' | 'code' | 'reference' | 'text';

interface Block { first: number; last: number }

/** Join the lines of one paragraph: a break between Chinese characters disappears, other runs of whitespace become one space. */
function readable(text: string, kind: ScriptLineKind): string {
  const plain = plainMarkdown(text);
  if (kind === 'code') return plain.replace(/^[ \t]{0,3}(?:`{3,}|~{3,}).*$/gm, '').replace(/^\n+|\n+$/g, '');
  // List items stay one per line (the view keeps the breaks); prose and quotations flow as one paragraph.
  if (kind === 'list') return plain.split('\n').map(item => singleLineText(item)).filter(Boolean).join('\n');
  return singleLineText(plain);
}

const cache = new Map<string, ScriptModel>();

/**
 * Split a draft into scenes and lines. `resolve` says which references are film positions (default: the `t=`
 * in the link). Results for the default resolver are cached per body (the footer and the view ask for the same).
 */
export function buildScript(body: string, resolve: ScriptTimeResolver = bodyTimeResolver): ScriptModel {
  const text = body.replace(/\r\n?/g, '\n');
  if (resolve === bodyTimeResolver) {
    const hit = cache.get(text);
    if (hit) return hit;
  }
  const starts = [0];
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) starts.push(index + 1);
  const count = starts.length;
  const lineEnd = (line: number) => (line + 1 < count ? starts[line + 1] - 1 : text.length);
  const lineText = (line: number) => text.slice(starts[line], lineEnd(line));
  const lineOf = (offset: number) => { let line = count - 1; while (line > 0 && starts[line] > offset) line--; return line; };

  const references = parseDraftReferences(text);
  const byLine = new Map<number, number[]>();
  references.forEach((reference, index) => { const line = lineOf(reference.from); byLine.set(line, [...(byLine.get(line) ?? []), index]); });
  const referenceOnly = new Set<number>();
  for (const [line, indexes] of byLine) {
    let rest = lineText(line);
    const shift = starts[line];
    for (const index of [...indexes].sort((a, b) => references[b].from - references[a].from)) {
      rest = rest.slice(0, references[index].from - shift) + rest.slice(references[index].to - shift);
    }
    if (!rest.trim()) referenceOnly.add(line);
  }

  const kinds: LineKind[] = new Array(count);
  let fence: string | null = null;
  for (let line = 0; line < count; line++) {
    const value = lineText(line);
    const marker = FENCE.exec(value);
    if (fence) {
      const closes = !!marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !value.slice(marker[0].length).trim();
      kinds[line] = closes ? 'fence' : 'code';
      if (closes) fence = null;
      continue;
    }
    if (marker) { fence = marker[1]; kinds[line] = 'fence'; continue; }
    kinds[line] = !value.trim() ? 'blank' : referenceOnly.has(line) ? 'reference' : HEADING.test(value) ? 'heading' : 'text';
  }
  const blocks: Block[] = [];
  for (let line = 0; line < count;) {
    if (kinds[line] === 'blank') { line++; continue; }
    let last = line;
    while (last + 1 < count && kinds[last + 1] !== 'blank') last++;
    blocks.push({ first: line, last });
    line = last + 1;
  }

  const times = references.map((reference, index) => resolve(reference, index));
  const scenes: ScriptScene[] = [];
  let scene: ScriptScene = { title: '', headed: false, from: 0, to: 0, rows: [] };
  scenes.push(scene);
  let previous: ScriptLine | undefined;
  const videoSources: string[] = [];

  const shotsIn = (from: number, to: number): ScriptShot[] => references.flatMap((reference, index) => {
    if (reference.from < from || reference.from >= to) return [];
    const time = times[index];
    if (!time?.video) return [];
    if (!videoSources.includes(reference.sourceNodeId)) videoSources.push(reference.sourceNodeId);
    return [{ reference: index + 1, sourceNodeId: reference.sourceNodeId, ...(reference.quoteNodeId ? { quoteNodeId: reference.quoteNodeId } : {}),
      ...(time.start !== undefined ? { start: time.start } : {}), ...(time.end !== undefined && time.start !== undefined && time.end > time.start ? { end: time.end } : {}) }];
  });
  const segmentsIn = (from: number, to: number, kind: ScriptLineKind): ScriptSegment[] => {
    const segments: ScriptSegment[] = [];
    let cursor = from;
    const push = (slice: string) => { const value = readable(slice, kind); if (value) segments.push({ text: value }); };
    references.forEach((reference, index) => {
      if (reference.from < from || reference.from >= to) return;
      if (reference.from > cursor) push(text.slice(cursor, reference.from));
      segments.push({ footnote: index + 1 });
      cursor = reference.to;
    });
    if (cursor < to) push(text.slice(cursor, to));
    return segments;
  };
  const withDuration = (line: ScriptLine): ScriptLine => {
    const spans = line.shots.filter(shot => shot.start !== undefined && shot.end !== undefined);
    return spans.length ? { ...line, duration: spans.reduce((sum, shot) => sum + (shot.end! - shot.start!), 0) } : line;
  };
  const startScene = (raw: string, from: number, headEnd: number) => {
    const parsed = headingTime(raw);
    scene = { title: parsed.title, headed: true, from, to: headEnd, rows: [], ...(parsed.start !== undefined ? { heading: { start: parsed.start, ...(parsed.end !== undefined ? { end: parsed.end } : {}) } } : {}) };
    scenes.push(scene);
    previous = undefined;
  };

  for (const block of blocks) {
    const from = starts[block.first], to = lineEnd(block.last);
    const blockKinds = kinds.slice(block.first, block.last + 1);
    if (blockKinds.every(kind => kind === 'reference')) {
      const shots = shotsIn(from, to);
      if (previous) {
        const merged = withDuration({ ...previous, to, shots: [...previous.shots, ...shots], segments: [...previous.segments, ...segmentsIn(from, to, previous.kind)] });
        scene.rows[scene.rows.indexOf(previous)] = merged;
        scene.to = to;
        previous = merged;
      } else {
        // Nothing to hang on (first thing in a scene): a row of its own, picture only.
        const line = withDuration({ from, to, start: from, ownTo: to, textFrom: from, caret: to, kind: 'text', segments: segmentsIn(from, to, 'text'), shots });
        scene.rows.push(line);
        scene.to = to;
        previous = line;
      }
      continue;
    }
    let bodyFirst = block.first;
    const firstText = lineText(block.first);
    const heading = blockKinds[0] === 'heading' ? HEADING.exec(firstText) : null;
    if (heading) {
      const level = heading[1].length;
      if (level === 2) startScene(heading[2], from, lineEnd(block.first));
      else if (block.first === block.last) { scene.rows.push({ kind: 'beat', title: plainMarkdown(heading[2]).trim(), from, to }); scene.to = to; previous = undefined; }
      if (block.first === block.last) continue;
      if (level === 2) bodyFirst = block.first + 1;
    }
    const bodyFrom = starts[bodyFirst];
    const first = lineText(bodyFirst);
    const kind: ScriptLineKind = kinds[bodyFirst] === 'fence' || kinds[bodyFirst] === 'code' ? 'code' : QUOTE.test(first) ? 'quote' : LIST.test(first) ? 'list' : 'text';
    const lead = kind === 'quote' ? QUOTE.exec(first)![0].length : kind === 'list' ? LIST.exec(first)![0].length : (/^[ \t]*/.exec(first)?.[0].length ?? 0);
    let segments = segmentsIn(bodyFrom, to, kind);
    let label: string | undefined;
    let textFrom = bodyFrom;
    const opening = segments[0];
    if (kind !== 'code' && opening && 'text' in opening) {
      const match = LABEL.exec(opening.text);
      if (match) {
        label = match[1];
        const rest = opening.text.slice(match[0].length);
        segments = rest ? [{ text: rest }, ...segments.slice(1)] : segments.slice(1);
        // The cell edits the words after the label when the label is written plainly (“画面：” rather than “**画面**：”).
        const raw = kind === 'text' ? LABEL.exec(text.slice(bodyFrom + lead, to)) : null;
        if (raw) textFrom = bodyFrom + lead + raw[0].length;
      }
    }
    const number = draftParagraphIndexAt(text, from);
    const line = withDuration({ ...(number !== undefined ? { number } : {}), from, to, start: bodyFrom, ownTo: to, textFrom, caret: bodyFrom + lead, kind, ...(label ? { label } : {}), segments, shots: shotsIn(from, to) });
    scene.rows.push(line);
    scene.to = to;
    previous = line;
  }

  // The untitled lead only exists when it holds something.
  if (!scenes[0].rows.length) scenes.shift();
  let total: number | undefined;
  let untimedScenes = 0;
  for (const item of scenes) {
    const lineDurations = item.rows.filter(isScriptLine).map(row => row.duration).filter((value): value is number => value !== undefined);
    if (item.heading?.end !== undefined) { item.duration = item.heading.end - item.heading.start; item.durationFrom = 'heading'; }
    else if (lineDurations.length) { item.duration = lineDurations.reduce((sum, value) => sum + value, 0); item.durationFrom = 'shots'; }
    if (item.duration !== undefined) total = (total ?? 0) + item.duration;
    else if (item.headed) untimedScenes++;
  }
  const lines = scenes.flatMap(item => item.rows.filter(isScriptLine));
  const model: ScriptModel = {
    scenes,
    sceneCount: scenes.filter(item => item.headed).length,
    lineCount: lines.length,
    ...(total !== undefined ? { total } : {}),
    untimedScenes,
    timedShots: lines.reduce((sum, line) => sum + line.shots.filter(shot => shot.start !== undefined).length, 0),
    timedHeadings: scenes.filter(item => item.heading).length,
    labeledLines: lines.filter(line => line.label).length,
    videoSources,
  };
  if (resolve === bodyTimeResolver) {
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(text, model);
  }
  return model;
}

/**
 * Where in the film to pick a shot for a line that has none (“补一个镜头”): the scene's own time range when the heading
 * has one; otherwise next to the scene's shots — right after the shot above this line, else at the shot below it.
 */
export function shotPickTime(scene: ScriptScene, line: ScriptLine): number | undefined {
  if (scene.heading) return scene.heading.start;
  const lines = scene.rows.filter(isScriptLine);
  const at = lines.indexOf(line);
  for (let index = at - 1; index >= 0; index--) {
    const shot = [...lines[index].shots].reverse().find(item => item.start !== undefined);
    if (shot) return shot.end ?? shot.start;
  }
  for (let index = at + 1; index < lines.length; index++) {
    const shot = lines[index].shots.find(item => item.start !== undefined);
    if (shot) return shot.start;
  }
  return undefined;
}

/**
 * Whether a draft reads as a script before anyone chose a view (the example “早餐摊 · 分镜脚本” does): at least two
 * scenes, written like a script (most scene headings carry a time range, or lines start with 画面：/镜头：…), and at
 * least one film position. An article with sections and one quoted video stays in 正文.
 */
export function prefersScript(body: string): boolean {
  const model = buildScript(body);
  if (model.sceneCount < 2) return false;
  const scripted = model.timedHeadings >= Math.ceil(model.sceneCount / 2) || model.labeledLines >= 2;
  return scripted && (model.timedShots > 0 || model.timedHeadings > 0);
}

/** “共 3 场 8 行，成片约 2:20” as parts, so the numbers can be set in tabular figures. */
export function scriptSummary(model: ScriptModel): { scenes: number; lines: number; total?: string; untimed: number } {
  return { scenes: model.sceneCount, lines: model.lineCount, ...(model.total !== undefined ? { total: formatDuration(model.total) } : {}), untimed: model.untimedScenes };
}
