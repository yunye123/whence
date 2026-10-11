import type { BoardNode } from '../../model';
import { singleLineText, timeRangeLabel } from '../../source-location';
import { resolveReferences } from '../draft-editor/sources';
import type { ResolvedReference } from '../draft-editor/sources';
import { analyzeDraftReferences } from '../draft-editor/reference-analysis';
import { buildScript, formatDuration, isPictureNote, isScriptLine, scriptTimeResolver } from './script-model';
import type { ScriptLine, ScriptModel, ScriptSegment } from './script-model';

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const superscript = (value: number) => String(value).split('').map(digit => SUPERSCRIPT[Number(digit)]).join('');
const cell = (value: string) => value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '<br>').trim() || '—';

/** “共 3 场 9 行，成片约 2:20” — the same words as the footer. */
export function scriptSummaryText(model: ScriptModel): string {
  const lines = `${model.lineCount} 行`;
  const head = model.sceneCount ? `共 ${model.sceneCount} 场 ${lines}` : `${lines}，还没有分场`;
  if (model.total === undefined) return model.sceneCount ? `${head}，成片时长未定` : head;
  return `${head}，成片约 ${formatDuration(model.total)}${model.untimedScenes ? `（${model.untimedScenes} 场未定）` : ''}`;
}

/** The model and the resolved references of one draft, as every export reads them. */
export function scriptSource(body: string, nodes: readonly BoardNode[]): { model: ScriptModel; references: ResolvedReference[] } {
  const model = buildScript(body, scriptTimeResolver(nodes));
  const references = resolveReferences(analyzeDraftReferences(body.replace(/\r\n?/g, '\n')), nodes);
  return { model, references };
}

/** A shot as the exports write it: the source's title and the place in it (“凌晨四点的早餐摊 01:12–01:26”). */
export interface ExportShot { reference: number; title: string; location?: string; start?: number; end?: number; sourceNodeId: string; gone: boolean }

/**
 * One row of the exported script, the same split as on screen: a “画面：” line (with or without an excerpt) describes
 * the picture; every other line is 旁白 (a writer's label other than 旁白 stays in front of the words).
 */
export interface ExportRow {
  kind: 'line' | 'beat' | 'empty-scene';
  scene: string;
  sceneIndex: number;
  number?: number;
  /** The writer's description of the shot (“画面：…” lines). */
  picture: string;
  shots: ExportShot[];
  /** Words with footnote markers, for the PDF; `words` is the plain text. */
  segments: ScriptSegment[];
  words: string;
  label?: string;
  quote: boolean;
  duration?: number;
}

const segmentText = (segments: readonly ScriptSegment[]) => segments.map(segment => 'text' in segment ? segment.text : '').join('').replace(/[ \t]+$/g, '');

export function scriptExportRows(model: ScriptModel, references: readonly ResolvedReference[]): ExportRow[] {
  const byIndex = new Map(references.map(reference => [reference.index, reference]));
  const rows: ExportRow[] = [];
  model.scenes.forEach((scene, sceneIndex) => {
    const name = scene.headed ? scene.title || '未命名的一场' : '开头';
    if (!scene.rows.length) rows.push({ kind: 'empty-scene', scene: name, sceneIndex, picture: '', shots: [], segments: [], words: '', quote: false });
    for (const row of scene.rows) {
      if (!isScriptLine(row)) { rows.push({ kind: 'beat', scene: name, sceneIndex, picture: '', shots: [], segments: [{ text: row.title }], words: row.title, quote: false }); continue; }
      const shots: ExportShot[] = row.shots.map(shot => {
        const reference = byIndex.get(shot.reference);
        return { reference: shot.reference, title: reference?.title ?? '来源卡片', location: reference?.location ?? timeRangeLabel(shot.start, shot.end), start: shot.start, end: shot.end, sourceNodeId: shot.sourceNodeId, gone: !reference?.source };
      });
      const describes = isPictureNote(row) || row.label === '画面' || row.label === '镜头';
      const label = !describes && row.label && row.label !== '旁白' ? row.label : undefined;
      rows.push({
        kind: 'line', scene: name, sceneIndex, ...(row.number !== undefined ? { number: row.number } : {}),
        picture: describes ? segmentText(row.segments) : '',
        shots,
        segments: describes ? [] : row.segments,
        words: describes ? '' : `${label ? `${label}：` : ''}${segmentText(row.segments)}`,
        ...(label ? { label } : {}),
        quote: row.kind === 'quote',
        ...(row.duration !== undefined ? { duration: row.duration } : {}),
      });
    }
  });
  return rows;
}

const shotText = (shot: ExportShot) => [shot.title, shot.location].filter(Boolean).join(' ');

/**
 * 导出脚本（Markdown 表格，§6.29 “导出”的第一种）：每场一张“# | 画面 | 旁白 | 时长”表，画面写来源与时间码，旁白是可读正文
 * （引用序号写成上标数字），最后列出全部来源。不写画布内部链接（离开来处就打不开），正文 `body` 不变（K1）。
 */
export function exportScriptMarkdown(title: string, body: string, nodes: readonly BoardNode[]): string {
  const { model, references } = scriptSource(body, nodes);
  const byIndex = new Map(references.map(reference => [reference.index, reference]));
  const picture = (line: ScriptLine) => line.shots.length
    ? line.shots.map(shot => {
      const reference = byIndex.get(shot.reference);
      const where = reference?.location ?? timeRangeLabel(shot.start, shot.end);
      return [reference?.title ?? '来源卡片', where].filter(Boolean).join(' ');
    }).join('<br>')
    : '';
  const text = (line: ScriptLine) => line.segments.map(segment => 'text' in segment ? segment.text : superscript(segment.footnote)).join('');
  const words = (line: ScriptLine) => `${line.label ? `${line.label}：` : ''}${text(line)}`;
  const out: string[] = [`# ${title || '未命名文稿'}`, '', scriptSummaryText(model), ''];
  for (const scene of model.scenes) {
    const range = scene.heading ? timeRangeLabel(scene.heading.start, scene.heading.end) : undefined;
    const length = scene.duration !== undefined ? formatDuration(scene.duration) : undefined;
    const details = [range, length && `时长 ${length}`].filter(Boolean).join('，');
    out.push(`## ${scene.headed ? scene.title || '未命名的一场' : '开头'}${details ? `（${details}）` : ''}`, '');
    out.push('| # | 画面 | 旁白 | 时长 |', '| :-: | --- | --- | --: |');
    for (const row of scene.rows) {
      if (!isScriptLine(row)) { out.push(`| | | **${cell(row.title)}** | |`); continue; }
      // A “画面：” line without an excerpt describes the shot: it goes in the 画面 column, as on screen.
      if (isPictureNote(row)) out.push(`| ${row.number ?? ''} | ${cell(text(row))} | — | — |`);
      else out.push(`| ${row.number ?? ''} | ${cell(picture(row))} | ${cell(words(row))} | ${row.duration !== undefined ? formatDuration(row.duration) : '—'} |`);
    }
    out.push('');
  }
  if (references.length) {
    out.push('## 来源', '');
    for (const reference of references) {
      const where = reference.location ? ` ${reference.location}` : '';
      const quote = reference.text ? `：${singleLineText(reference.text)}` : '';
      out.push(`${reference.index}. ${reference.title}${where}${quote}${reference.source ? '' : '（来源卡片已不在画布上）'}`);
    }
    out.push('');
  }
  return out.join('\n');
}

/** RFC 4180 field; a field that a spreadsheet would read as a formula starts with an apostrophe. */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const SCRIPT_CSV_HEADER = ['场', '序号', '画面说明', '来源与时间码', '旁白', '时长'] as const;

/**
 * 导出脚本表格 CSV（§6.29）：每行一条——场、序号、画面说明、来源与时间码、旁白、时长。UTF-8 带 BOM（表格软件按 UTF-8 打开中文）、
 * CRLF 换行；一行有几个镜头时来源写成几行（同一格内换行）；小标题（###）写成“【…】”占一行；没有内部链接。
 */
export function exportScriptCsv(body: string, nodes: readonly BoardNode[]): string {
  const { model, references } = scriptSource(body, nodes);
  const lines = [SCRIPT_CSV_HEADER.join(',')];
  for (const row of scriptExportRows(model, references)) {
    const fields = row.kind === 'beat' ? [row.scene, '', '', '', `【${row.words}】`, '']
      : row.kind === 'empty-scene' ? [row.scene, '', '', '', '', '']
        : [row.scene, row.number === undefined ? '' : String(row.number), row.picture, row.shots.map(shotText).join('\n'), row.words, row.duration === undefined ? '' : formatDuration(row.duration)];
    lines.push(fields.map(csvField).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// ── PDF：分镜脚本的打印版 ────────────────────────────────────────────────────────────────────────────────────

/** Ink and white paper of the printed script. Existing palette keys stay compatible with print callers. */
export interface PrintPalette { ink: string; ink2: string; ink3: string; rule: string; ruleStrong: string; source: string; tag: string; tagOn: string; paper: string; sunken: string }
export const PRINT_PALETTE_FALLBACK: PrintPalette = {
  ink: 'rgb(34, 31, 27)', ink2: 'rgb(72, 69, 63)', ink3: 'rgb(89, 85, 79)', rule: 'rgba(38, 38, 38, 0.12)', ruleStrong: 'rgba(38, 38, 38, 0.24)',
  source: 'rgb(72, 69, 63)', tag: 'rgb(165, 39, 26)', tagOn: 'rgb(34, 31, 27)', paper: 'rgb(255, 255, 255)', sunken: 'rgb(242, 241, 238)',
};

export interface PrintFonts { serif: string; sans: string; num: string }
export const PRINT_FONTS_FALLBACK: PrintFonts = {
  serif: "'Noto Serif SC Variable', 'Songti SC', 'SimSun', serif",
  sans: "'Noto Sans SC Variable', 'Microsoft YaHei UI', 'PingFang SC', sans-serif",
  num: "'IBM Plex Mono', 'Noto Sans SC Variable', monospace",
};

export interface ScriptPrintInput {
  title: string;
  model: ScriptModel;
  references: readonly ResolvedReference[];
  /** Picture per reference index (a data URL of the shot's frame, else the source's poster). */
  pictures: ReadonlyMap<number, string>;
  /** “2026 年 10 月 7 日”. */
  date: string;
  /** Resolves the font files of `fontFaces` (the page's own base URL). */
  base?: string;
  /** The page's @font-face rules (absolute URLs), so the print uses the same 宋体 and figures as the screen. */
  fontFaces?: string;
  palette?: PrintPalette;
  fonts?: PrintFonts;
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cssString = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;
/** Same solid ▶ / ¶ glyphs as ProvenanceTag; printing has no string or punched hole. */
const STAMP_PLAY = '<svg viewBox="0 0 24 24" data-provenance-icon="video" aria-hidden="true"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>';
const STAMP_PARAGRAPH = '<svg viewBox="0 0 9 12" data-provenance-icon="text" aria-hidden="true"><path d="M3.9 .6H8.6V11.4H7V2.1H5.9V11.4H4.3V7H3.9A3.2 3.2 0 0 1 3.9 .6Z"/></svg>';
const tag = (label: string, video = true, gone = false) => `<span class="tag${gone ? ' tag--gone' : ''}"><span class="tag__head">${video ? STAMP_PLAY : STAMP_PARAGRAPH}</span><span class="tag__body">${escapeHtml(label)}</span></span>`;

function wordsHtml(segments: readonly ScriptSegment[]): string {
  return segments.map((segment, index) => {
    if ('text' in segment) return escapeHtml(segment.text).replace(/\n/g, '<br>');
    const previous = segments[index - 1];
    const tuck = !!previous && 'text' in previous && /[、。，；：！？）」』”’》〉】]$/.test(previous.text);
    return `<sup${tuck ? ' class="tuck"' : ''}>${segment.footnote}</sup>`;
  }).join('');
}

/**
 * The printed script (带缩略图的 PDF, §6.29): A4 landscape, a running header row (# · 画面 · 旁白 · 时长) on every
 * page; each scene a band with its place in the film and its length; each line its frame and tag (time code in tabular
 * figures), the 旁白 in 宋体, its length. A “画面：” description sits in the dashed frame of a shot still to find, as
 * on screen. The sources follow the table. Self-contained HTML (pictures as data URLs), printed by the browser or the
 * desktop's own PDF printer.
 */
export function scriptPrintHtml(input: ScriptPrintInput): string {
  const palette = input.palette ?? PRINT_PALETTE_FALLBACK;
  const fonts = input.fonts ?? PRINT_FONTS_FALLBACK;
  const title = input.title || '未命名文稿';
  const rows = scriptExportRows(input.model, input.references);
  const scenes = input.model.scenes;
  const body: string[] = [];
  let currentScene = -1;
  for (const row of rows) {
    if (row.sceneIndex !== currentScene) {
      currentScene = row.sceneIndex;
      const scene = scenes[row.sceneIndex];
      const range = scene.heading ? timeRangeLabel(scene.heading.start, scene.heading.end) : undefined;
      body.push(`<tr class="scene"><td colspan="3"><span class="scene__title">${escapeHtml(row.scene)}</span>${range ? tag(range) : ''}</td><td class="time">${scene.duration !== undefined ? formatDuration(scene.duration) : '—'}</td></tr>`);
    }
    if (row.kind === 'empty-scene') continue;
    if (row.kind === 'beat') { body.push(`<tr class="beat"><td></td><td colspan="3">${escapeHtml(row.words)}</td></tr>`); continue; }
    const pictures = row.shots.map(shot => {
      const src = input.pictures.get(shot.reference);
      const image = src ? `<img class="thumb" src="${escapeHtml(src)}" alt="">` : '<span class="thumb thumb--blank"></span>';
      return `<figure class="shot">${image}<figcaption>${shot.location ? tag(shot.location, true, shot.gone) : ''}<span class="shot__title">${escapeHtml(shot.title)}${shot.gone ? '（来源卡片已不在画布上）' : ''}</span></figcaption></figure>`;
    }).join('');
    const note = row.picture ? `<div class="note${row.shots.length ? ' note--with-shot' : ''}">${escapeHtml(row.picture)}</div>` : '';
    const words = row.words ? `<div class="words${row.quote ? ' words--quote' : ''}">${row.label ? `<span class="label">${escapeHtml(row.label)}</span>` : ''}${wordsHtml(row.segments)}</div>` : '';
    body.push(`<tr class="line"><td class="num">${row.number ?? ''}</td><td class="pic">${pictures}${note}</td><td>${words}</td><td class="time">${row.duration !== undefined ? formatDuration(row.duration) : ''}</td></tr>`);
  }
  const sources = input.references.length ? `<section class="sources"><h2>来源</h2><ol>${input.references.map(reference => {
    const quote = reference.text ? `<span class="sources__quote">${escapeHtml(singleLineText(reference.text))}</span>` : '';
    return `<li value="${reference.index}"><span class="sources__title">${escapeHtml(reference.title)}</span>${reference.location ? `<span class="sources__where">${tag(reference.location, reference.video, !reference.source)}</span>` : ''}${quote}${reference.source ? '' : '<span class="sources__gone">来源卡片已不在画布上</span>'}</li>`;
  }).join('')}</ol></section>` : '';
  const summary = scriptSummaryText(input.model).replace(/(\d+(?::\d{2}){0,2})/g, '<b>$1</b>');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">${input.base ? `<base href="${escapeHtml(input.base)}">` : ''}
<title>${escapeHtml(title)}</title>
<style>
${input.fontFaces ?? ''}
:root { --ink: ${palette.ink}; --ink-2: ${palette.ink2}; --ink-3: ${palette.ink3}; --rule: ${palette.rule}; --rule-strong: ${palette.ruleStrong}; --source: ${palette.source}; --tag: ${palette.tag}; --tag-on: ${palette.tagOn}; --paper: ${palette.paper}; --sunken: ${palette.sunken};
  --serif: ${fonts.serif}; --sans: ${fonts.sans}; --num: ${fonts.num}; }
@page { size: A4 landscape; margin: 14mm 15mm 15mm;
  @bottom-left { content: ${cssString(title)}; font: 7pt var(--sans); color: var(--ink-3); }
  @bottom-right { content: counter(page) " / " counter(pages); font: 7pt var(--num); font-variant-numeric: tabular-nums; color: var(--ink-3); } }
* { box-sizing: border-box; }
html { print-color-adjust: exact; -webkit-print-color-adjust: exact; background: var(--paper); }
body { margin: 0; color: var(--ink); font: 8.5pt/1.5 var(--sans); font-kerning: normal; }
.doc { position: relative; display: flex; align-items: flex-end; justify-content: space-between; gap: 10mm; padding-bottom: 4.5mm; border-bottom: 1.5pt solid var(--ink); }
.doc::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1.8mm; border-bottom: .5pt solid var(--rule-strong); }
h1 { margin: 0 0 1.6mm; font: 600 19pt/1.3 var(--serif); letter-spacing: .01em; }
.meta { margin: 0; color: var(--ink-3); font: 8pt/1.4 var(--sans); }
.meta b { color: var(--ink-2); font: 600 8pt var(--num); font-variant-numeric: tabular-nums; }
.meta span + span::before { content: "·"; margin: 0 2mm; color: var(--rule-strong); }
.brand { flex: none; color: var(--ink-3); font: 600 7.5pt/1 var(--serif); letter-spacing: .06em; } /* 字标同源：思源宋体 SemiBold，字距 +6% */
table { width: 100%; margin-top: 1.8mm; border-collapse: collapse; table-layout: fixed; border-inline: .5pt solid var(--rule); border-bottom: .5pt solid var(--rule); }
thead { display: table-header-group; }
th { padding: 3.2mm 2.4mm 1.8mm; border-bottom: .5pt solid var(--rule-strong); background: var(--sunken); color: var(--ink-3); font: 500 7pt/1 var(--sans); letter-spacing: .12em; text-align: left; }
col.c-num { width: 11mm; } col.c-pic { width: 66mm; } col.c-time { width: 16mm; }
th.num, td.num, th.time, td.time { text-align: right; }
td { padding: 3mm 2.4mm; vertical-align: top; }
tr.scene td { padding: 6.5mm 2.4mm 2.2mm 0; border-bottom: .5pt solid var(--rule-strong); vertical-align: baseline; }
tr.scene td.time { padding-right: 2.4mm; }
tr.scene { break-inside: avoid; break-after: avoid; }
.scene__title { margin-right: 3mm; font: 600 12pt/1.4 var(--sans); }
tr.scene .time { color: var(--ink); font: 600 9pt var(--num); font-variant-numeric: tabular-nums; }
tr.line { break-inside: avoid; }
tr.line td { border-bottom: .3pt solid var(--rule); }
tr.beat td { padding: 4mm 2.4mm 1mm; color: var(--ink-2); font: 600 8pt var(--sans); }
td.num { color: var(--ink-3); font: 500 7.5pt/2.1 var(--num); font-variant-numeric: tabular-nums; }
td.time { color: var(--ink-2); font: 500 8.5pt/1.95 var(--num); font-variant-numeric: tabular-nums; }
.shot { margin: 0; }
.shot + .shot { margin-top: 2.6mm; }
.thumb { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: .9mm; background: var(--sunken); }
.thumb--blank { box-shadow: inset 0 0 0 .5pt var(--rule); }
figcaption { display: flex; align-items: center; gap: 2mm; margin-top: 1.6mm; min-width: 0; }
.shot__title { overflow: hidden; color: var(--ink-3); font: 7pt/1.3 var(--sans); white-space: nowrap; text-overflow: ellipsis; }
.note { padding: 2mm 2.6mm; border: .6pt dashed var(--rule-strong); border-radius: .9mm; color: var(--ink-2); font: 8.5pt/1.65 var(--serif); }
.note--with-shot { margin-top: 2.4mm; border-style: solid; border-color: var(--rule); }
.words { font: 12pt/1.75 var(--serif); text-align: justify; overflow-wrap: anywhere; }
.words--quote { padding-left: 3.2mm; box-shadow: inset 1pt 0 0 var(--rule-strong); }
.words sup { margin-left: .4mm; color: var(--ink-2); font: 600 6pt/1 var(--num); font-variant-numeric: tabular-nums; vertical-align: .55em; }
.words sup.tuck { margin-left: -1.6mm; }
.label { display: inline-block; margin-right: 2mm; padding: 0 1.4mm; border-radius: .7mm; box-shadow: inset 0 0 0 .5pt var(--rule-strong); color: var(--ink-2); font: 500 6.5pt/1.75 var(--sans); vertical-align: 1.2pt; }
.tag { display: inline-flex; align-items: stretch; flex: none; height: 6.35mm; border: .5pt solid var(--tag); border-radius: .5mm; color: var(--ink); font: 500 9pt/1 var(--num); font-variant-numeric: tabular-nums; white-space: nowrap; vertical-align: middle; }
.tag__head { display: grid; place-items: center; width: 5.82mm; border-right: .5pt solid var(--tag); }
.tag__head svg { display: block; width: 2.38mm; height: 2.38mm; fill: var(--tag); stroke: none; }
.tag__head svg[data-provenance-icon="text"] { width: 1.98mm; height: 2.65mm; }
.tag__body { display: inline-flex; align-items: center; padding: 0 2.1mm; color: var(--ink); }
.tag--gone { border-color: var(--ink-3); border-style: dashed; }
.tag--gone .tag__head { border-color: var(--ink-3); }
.tag--gone .tag__head svg { fill: var(--ink-3); }
.tag--gone .tag__body { color: var(--ink-3); }
.sources { margin-top: 8mm; }
.sources h2 { margin: 0 0 2.4mm; padding-bottom: 1.8mm; border-bottom: .5pt solid var(--rule-strong); color: var(--ink-3); font: 500 7pt/1 var(--sans); letter-spacing: .12em; }
.sources ol { margin: 0; padding-left: 6mm; color: var(--ink-3); font: 8pt/1.6 var(--sans); }
.sources li { margin: 0 0 1.4mm; padding-left: 1mm; break-inside: avoid; }
.sources li::marker { color: var(--ink-2); font: 600 7.5pt var(--num); }
.sources__title { color: var(--ink); }
.sources__where { margin-left: 2mm; color: var(--source); font: 600 7.5pt var(--num); font-variant-numeric: tabular-nums; }
.sources__quote { display: block; color: var(--ink-2); font: 9pt/1.7 var(--serif); }
.sources__gone { margin-left: 2mm; }
</style></head>
<body>
<header class="doc"><div><h1>${escapeHtml(title)}</h1><p class="meta"><span>${summary}</span><span>${escapeHtml(input.date)}</span></p></div><span class="brand">来处</span></header>
<table><colgroup><col class="c-num"><col class="c-pic"><col><col class="c-time"></colgroup>
<thead><tr><th class="num">#</th><th>画面</th><th>旁白</th><th class="time">时长</th></tr></thead>
<tbody>${body.join('\n')}</tbody></table>
${sources}
</body></html>`;
}
