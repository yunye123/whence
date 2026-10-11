import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { formatDraftQuote, parseDraftReferences } from '../src/draft-references';
import type { BoardNode } from '../src/model';
import { createExampleBoard } from '../src/templates';
import { analyzeDraftReferences, referenceExtension, referenceScope, referenceSpans } from '../src/inspector/draft-editor/references';
import { buildScript, isScriptLine, scriptTimeResolver } from '../src/inspector/script-view/script-model';
import type { ScriptLine, ScriptModel } from '../src/inspector/script-view/script-model';
import { isSameSlot, keepReferences, lineAt, lineStartOf, moveLine, moveScene, removeEmptyLine, splitLine, stepScene, stepSlot } from '../src/inspector/script-view/script-edit';
import type { TextChange } from '../src/inspector/script-view/script-edit';
import { SCRIPT_CSV_HEADER, csvField, exportScriptCsv, scriptExportRows, scriptPrintHtml, scriptSource } from '../src/inspector/script-view/script-export';

// 脚本视图第二步（编辑，DESIGN_SYSTEM §6.29）: every edit is a plain text change of the same Markdown body (K1). These
// tests lock what a move, a split and a protected reference do to the body byte for byte, and what the CSV and the
// printed script contain.

const lines = (model: ScriptModel) => model.scenes.flatMap(scene => scene.rows.filter(isScriptLine));
const words = (line: ScriptLine) => line.segments.map(segment => 'text' in segment ? segment.text : `[${segment.footnote}]`).join('');
const apply = (text: string, changes: readonly TextChange[]) => [...changes].sort((a, b) => b.from - a.from).reduce((out, change) => out.slice(0, change.from) + change.insert + out.slice(change.to), text);

function film() {
  const video: BoardNode = { id: 'film-1', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'video', title: '样片', body: '', poster: '/samples/poster.webp' } };
  const quote = (id: string, text: string, start: number, end: number): BoardNode => ({ id, type: 'card', position: { x: 0, y: 0 }, data: { kind: 'quote', title: `摘录 · ${start}`, body: '', citation: { nodeId: video.id, title: '样片', text, start, end } } });
  return { video, quote };
}

const SCRIPT = ['## 开场', '', '第一行。', '', '第二行。', '', '## 中段', '', '第三行。', '', '第四行。', '', '## 结尾', '', '第五行。'].join('\n');

test('lines know their own start, their own block end and where the cell edits', () => {
  const { board, draft } = (() => { const board = createExampleBoard('video'); return { board, draft: board.nodes.find(node => node.data.kind === 'draft')! }; })();
  const body = draft.data.body;
  const model = buildScript(body, scriptTimeResolver(board.nodes));
  for (const line of lines(model)) {
    assert.ok(line.from <= line.start && line.start <= line.textFrom && line.textFrom <= line.to, `line ${line.number} ranges are ordered`);
    assert.ok(line.ownTo <= line.to);
  }
  const note = lines(model)[0];
  assert.equal(body.slice(note.start, note.textFrom), '画面：', 'the cell edits the words after a plainly written label');
  const quote = lines(model).find(line => line.kind === 'quote')!;
  assert.equal(body.slice(quote.textFrom, quote.textFrom + 2), '> ', 'a quotation keeps its mark in the cell (hidden there as in 正文)');
  assert.ok(quote.ownTo < quote.to, 'the reference block folded into the quotation is after its own block');
  assert.match(body.slice(quote.ownTo, quote.to), /^\n\n\[来源：/);
  for (const scene of model.scenes) assert.equal(scene.to, Math.max(...scene.rows.map(row => row.to)), 'a scene ends with its last row');
});

test('moving a line within a scene, across scenes and to a scene’s end changes only that paragraph’s place', () => {
  const model = buildScript(SCRIPT);
  const [one, two, three, four, five] = lines(model);
  const down = moveLine(SCRIPT, model, one, { scene: 0, row: 2 })!;
  assert.equal(down.body, SCRIPT.replace('第一行。\n\n第二行。', '第二行。\n\n第一行。'));
  assert.equal(down.body.slice(down.start, down.start + 4), '第一行。');
  const across = moveLine(SCRIPT, model, four, { scene: 0, row: 1 })!;
  assert.equal(across.body, ['## 开场', '', '第一行。', '', '第四行。', '', '第二行。', '', '## 中段', '', '第三行。', '', '## 结尾', '', '第五行。'].join('\n'));
  const toEnd = moveLine(SCRIPT, model, two, { scene: 2, row: 1 })!;
  assert.equal(toEnd.body, ['## 开场', '', '第一行。', '', '## 中段', '', '第三行。', '', '第四行。', '', '## 结尾', '', '第五行。', '', '第二行。'].join('\n'));
  assert.equal(toEnd.body.slice(toEnd.start, toEnd.start + 4), '第二行。');
  const last = moveLine(SCRIPT, model, five, { scene: 1, row: 0 })!;
  assert.equal(last.body, ['## 开场', '', '第一行。', '', '第二行。', '', '## 中段', '', '第五行。', '', '第三行。', '', '第四行。', '', '## 结尾'].join('\n'), 'the last paragraph takes the blank line before it');
  assert.equal(apply(SCRIPT, across.changes), across.body, 'the changes are positions in the body before the move');
  // Where the line already is: nothing to do.
  assert.equal(moveLine(SCRIPT, model, three, { scene: 1, row: 0 }), null);
  assert.equal(moveLine(SCRIPT, model, three, { scene: 1, row: 1 }), null);
  assert.ok(isSameSlot(model, three, { scene: 1, row: 1 }));
  // The whole body survives a round trip.
  const back = moveLine(across.body, buildScript(across.body), lines(buildScript(across.body))[1], { scene: 1, row: 1 })!;
  assert.equal(back.body, SCRIPT);
});

test('a line carries its excerpt (the reference block folded into it) when it moves', () => {
  const { video, quote } = film();
  const nodes = [video, quote('q-1', '原片里的一句。', 10, 16)];
  const body = ['## 一', '', `第一行：${formatDraftQuote(nodes[1])}`.trimEnd(), '', '## 二', '', '第二行。'].join('\n');
  const model = buildScript(body, scriptTimeResolver(nodes));
  const shot = lines(model).find(line => line.shots.length)!;
  const moved = moveLine(body, model, shot, { scene: 1, row: 1 })!;
  const after = buildScript(moved.body, scriptTimeResolver(nodes));
  assert.equal(after.scenes[1].rows.filter(isScriptLine).at(-1)!.shots[0]?.start, 10, 'the picture is still this line’s');
  assert.equal(parseDraftReferences(moved.body).length, 1, 'the link is moved whole, never split');
  assert.ok(moved.body.indexOf('第二行。') < moved.body.indexOf('> 原片里的一句。'), 'the quotation now follows 第二行');
  assert.ok(moved.body.indexOf('第一行：') < moved.body.indexOf('## 二'), 'the line it followed stays in its scene');
  assert.ok(moved.body.indexOf('> 原片里的一句。') < moved.body.indexOf('[来源：'), 'its quotation and link stay together, in order');
  assert.equal(moved.body.length, body.length, 'nothing is added or lost (blank lines trade places)');
});

test('a line written right under its heading moves without taking the heading', () => {
  const body = ['## 开场', '第一行。', '', '第二行。', '', '## 结尾', '', '第三行。'].join('\n');
  const model = buildScript(body);
  const first = lines(model)[0];
  assert.equal(first.from, 0, 'the block starts at the heading');
  assert.equal(body.slice(first.start, first.start + 4), '第一行。', 'the line starts after it');
  const moved = moveLine(body, model, first, { scene: 1, row: 1 })!;
  assert.equal(moved.body, ['## 开场', '', '第二行。', '', '## 结尾', '', '第三行。', '', '第一行。'].join('\n'));
});

test('Alt+↑ / Alt+↓ steps past one row, and across a scene boundary at the first or last row', () => {
  const model = buildScript(SCRIPT);
  const [one, two, three, , five] = lines(model);
  assert.deepEqual(stepSlot(model, one, 1), { scene: 0, row: 2 });
  assert.deepEqual(stepSlot(model, two, 1), { scene: 1, row: 0 }, 'down from the last row: the start of the next scene');
  assert.deepEqual(stepSlot(model, three, -1), { scene: 0, row: 2 }, 'up from the first row: the end of the scene before');
  assert.equal(stepSlot(model, one, -1), null);
  assert.equal(stepSlot(model, five, 1), null);
  const moved = moveLine(SCRIPT, model, two, stepSlot(model, two, 1)!)!;
  assert.equal(moved.body, ['## 开场', '', '第一行。', '', '## 中段', '', '第二行。', '', '第三行。', '', '第四行。', '', '## 结尾', '', '第五行。'].join('\n'));
});

test('moving a scene takes its heading and every row; the untitled lead stays first', () => {
  const model = buildScript(SCRIPT);
  const up = moveScene(SCRIPT, model, 2, 0)!;
  assert.equal(up.body, ['## 结尾', '', '第五行。', '', '## 开场', '', '第一行。', '', '第二行。', '', '## 中段', '', '第三行。', '', '第四行。'].join('\n'));
  const end = moveScene(SCRIPT, model, 0, 3)!;
  assert.equal(end.body, ['## 中段', '', '第三行。', '', '第四行。', '', '## 结尾', '', '第五行。', '', '## 开场', '', '第一行。', '', '第二行。'].join('\n'));
  assert.equal(moveScene(SCRIPT, model, 1, 1), null);
  assert.equal(moveScene(SCRIPT, model, 1, 2), null);
  assert.equal(stepScene(model, 0, -1), null);
  assert.equal(stepScene(model, 1, 1), 3);
  const lead = '开头一段。\n\n' + SCRIPT;
  const withLead = buildScript(lead);
  assert.equal(moveScene(lead, withLead, 1, 0), null, 'nothing moves above the lead');
  assert.equal(stepScene(withLead, 1, -1), null);
});

test('Enter splits a line at the caret; at the end of its words the new line goes after its excerpt', () => {
  const { video, quote } = film();
  const nodes = [video, quote('q-1', '原片里的一句。', 10, 16)];
  const body = ['## 一', '', `前一行。${formatDraftQuote(nodes[1])}`.trimEnd(), '', '后一行。'].join('\n');
  const model = buildScript(body, scriptTimeResolver(nodes));
  const quoted = lines(model).find(line => line.kind === 'quote')!;
  const end = splitLine(body, quoted, quoted.ownTo);
  assert.equal(end.change.from, quoted.to, 'after the folded reference block');
  const ended = apply(body, [end.change]);
  assert.equal(ended.slice(end.caret - 2, end.caret + 2), '\n\n\n\n', 'the caret is on a new, empty paragraph');
  assert.equal(buildScript(ended, scriptTimeResolver(nodes)).lineCount, model.lineCount, 'an empty paragraph is not a line until it has words');
  const middle = splitLine(body, quoted, quoted.textFrom + 2 + 3);
  const split = apply(body, [middle.change]);
  assert.match(split, /> 原片里\n\n> 的一句。/, 'a quotation keeps its mark on the new part');
  const plain = lines(model)[0];
  const at = plain.textFrom + 2;
  assert.equal(apply(body, [splitLine(body, plain, at).change]).slice(plain.textFrom, plain.textFrom + 6), '前一\n\n行。');
  // Right after a continuation line’s “> ”: no empty quotation line is left behind.
  const two = '> 第一句，\n> 第二句。';
  const twoLine = lines(buildScript(two))[0];
  const continuation = splitLine(two, twoLine, two.indexOf('第二句'));
  assert.equal(apply(two, [continuation.change]), '> 第一句，\n\n> 第二句。');
});

test('Backspace in an emptied line takes the empty paragraph out again', () => {
  const body = '第一行。\n\n\n\n第二行。';
  const removal = removeEmptyLine(body, 6)!;
  assert.equal(apply(body, [removal.change]), '第一行。\n\n第二行。');
  assert.equal(removal.caret, 4);
  assert.equal(apply('第一行。\n\n', [removeEmptyLine('第一行。\n\n', 6)!.change]), '第一行。');
  assert.equal(removeEmptyLine(body, 0), null);
});

test('a reference stays whole in a cell: deletions keep it, typing after a hoisted excerpt goes before it', () => {
  // “text¹” where the link sits on its own line after a blank line (hoisted): protected [4, 30).
  const hoisted = [{ from: 4, to: 30, hoisted: true }];
  assert.deepEqual(keepReferences([{ from: 0, to: 30, insert: '' }], hoisted), { changes: [{ from: 0, to: 4, insert: '' }], caret: 0 }, 'select all + delete keeps the link');
  assert.deepEqual(keepReferences([{ from: 4, to: 30, insert: '' }], hoisted), { changes: [], caret: 4 }, 'Backspace over the superscript steps before it');
  assert.deepEqual(keepReferences([{ from: 30, to: 30, insert: '字' }], hoisted), { changes: [{ from: 4, to: 4, insert: '字' }], caret: 4 }, 'typing at the very end lands before the excerpt');
  assert.deepEqual(keepReferences([{ from: 2, to: 30, insert: '新' }], hoisted), { changes: [{ from: 2, to: 4, insert: '新' }], caret: 2 });
  assert.equal(keepReferences([{ from: 1, to: 3, insert: 'x' }], hoisted), null, 'changes away from references pass untouched');
  const inline = [{ from: 4, to: 20 }];
  assert.equal(keepReferences([{ from: 20, to: 20, insert: '后' }], inline), null, 'after an inline reference typing stays after it');
  assert.deepEqual(keepReferences([{ from: 10, to: 10, insert: 'x' }], inline), { changes: [{ from: 20, to: 20, insert: 'x' }], caret: 20 });
});

test('a cell numbers its references after the ones before it, apart from the body’s analysis', () => {
  const body = '[来源：样片 00:05](field://node/film-1?t=5)\n\n后面一段。\n\n> 原文\n\n[来源：样片 00:09](field://node/film-1?t=9)';
  const bodySpans = analyzeDraftReferences(body);
  const slice = body.slice(body.indexOf('> 原文'));
  const state = EditorState.create({ doc: slice, extensions: [referenceExtension, referenceScope.of({ base: 1 })] });
  assert.deepEqual(referenceSpans(state).map(span => span.index), [2]);
  assert.equal(referenceSpans(state)[0].mode, 'sup', 'hoisted to the quotation, as in the body');
  assert.equal(analyzeDraftReferences(body), bodySpans, 'the body’s remembered analysis is untouched');
});

test('a text that opens with blank lines before a lone reference is analysed (no endless loop)', () => {
  const spans = analyzeDraftReferences('\n\n[来源：样片 00:05](field://node/film-1?t=5)');
  assert.equal(spans.length, 1);
  assert.equal(spans[0].mode, 'label');
  assert.equal(lineStartOf('\nabc', 0), 0);
  assert.equal(lineStartOf('\nabc', 2), 1);
});

test('lineAt finds the line holding a position (folded references included)', () => {
  const model = buildScript(SCRIPT);
  const [, two] = lines(model);
  assert.equal(lineAt(model, two.start)?.from, two.from);
  assert.equal(lineAt(model, two.to)?.from, two.from);
  assert.equal(lineAt(model, 0), undefined, 'a heading is not a line');
});

test('CSV: one row per line — scene, number, picture, source and time code, words, length', () => {
  const board = createExampleBoard('video');
  const draft = board.nodes.find(node => node.data.kind === 'draft')!;
  const csv = exportScriptCsv(draft.data.body, board.nodes);
  assert.ok(csv.startsWith('﻿'), 'UTF-8 with BOM so spreadsheets read Chinese');
  assert.ok(csv.endsWith('\r\n'));
  const records = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(records[0], SCRIPT_CSV_HEADER.join(','));
  assert.equal(records[0], '场,序号,画面说明,来源与时间码,旁白,时长');
  assert.equal(records.length, 1 + 9);
  assert.match(csv, /\r\n开场,1,路口只有一盏灯，铁锅冒着白汽。不配乐，只留油锅和风声。,,,\r\n/);
  assert.match(csv, /\r\n展开,5,,凌晨四点的早餐摊 01:12–01:26,摊主说，四点出摊不是为了赚钱，是为了等头班公交的司机。,0:14\r\n/);
  assert.equal(csv.includes('field://'), false);
  assert.equal(csv.includes('口播'), false);
});

test('CSV fields are quoted when needed and never start like a formula', () => {
  assert.equal(csvField('普通'), '普通');
  assert.equal(csvField('他说，"走"'), '"他说，""走"""');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('第一行\n第二行'), '"第一行\n第二行"');
  assert.equal(csvField('=1+1'), "'=1+1");
  assert.equal(csvField('@x'), "'@x");
  const { video, quote } = film();
  const nodes = [video, quote('q-1', '甲。', 1, 3), quote('q-2', '乙。', 5, 9)];
  const body = ['## 一', '', '两个镜头：“甲。”[来源：样片 00:01](field://node/film-1?quote=q-1&t=1)“乙。”[来源：样片 00:05](field://node/film-1?quote=q-2&t=5)'].join('\n');
  const { model, references } = scriptSource(body, nodes);
  const [row] = scriptExportRows(model, references).filter(item => item.kind === 'line');
  assert.equal(row.shots.length, 2);
  assert.equal(row.duration, 6);
  assert.match(exportScriptCsv(body, nodes), /\r\n一,1,,"样片 00:01–00:03\n样片 00:05–00:09",两个镜头：“甲。”“乙。”,0:06\r\n/, 'two shots: one cell, one line each');
});

test('the printed script: landscape A4, a header row on every page, frames, tags, 宋体 words, sources; no internal links', () => {
  const board = createExampleBoard('video');
  const draft = board.nodes.find(node => node.data.kind === 'draft')!;
  const { model, references } = scriptSource(draft.data.body, board.nodes);
  const html = scriptPrintHtml({ title: draft.data.title, model, references, pictures: new Map([[1, 'data:image/webp;base64,AAAA']]), date: '2026 年 10 月 7 日' });
  assert.match(html, /@page \{ size: A4 landscape;/);
  assert.match(html, /<thead><tr><th class="num">#<\/th><th>画面<\/th><th>旁白<\/th><th class="time">时长<\/th><\/tr><\/thead>/);
  assert.match(html, /thead \{ display: table-header-group; \}/, 'the column header repeats on every page');
  assert.equal((html.match(/<tr class="scene">/g) ?? []).length, 3);
  assert.equal((html.match(/<tr class="line">/g) ?? []).length, 9);
  assert.match(html, /<img class="thumb" src="data:image\/webp;base64,AAAA"/);
  assert.match(html, /<span class="tag__body">01:12–01:26<\/span>/);
  assert.match(html, /<span class="tag__body">00:00–00:43<\/span>/, 'a scene’s place in the film');
  assert.match(html, /<sup class="tuck">1<\/sup>/, 'the footnote tucks after the full stop as on screen');
  assert.match(html, /<div class="note">路口只有一盏灯/, 'a picture note sits in the dashed frame');
  assert.match(html, /<section class="sources"><h2>来源<\/h2>/);
  assert.match(html, /共 <b>3<\/b> 场 <b>9<\/b> 行，成片约 <b>2:20<\/b>/);
  assert.equal(html.includes('field://'), false);
  assert.ok(html.includes('<span class="brand">来处</span>'), 'the header carries the product name (renamed from 原野 on 2026-10-07)');
  assert.equal(html.includes('口播'), false);
  assert.equal(/<script/i.test(html), false, 'nothing runs in the print document');
});

test('the printed script escapes what the writer typed', () => {
  const body = '## <b>场</b>\n\n他写了 <script>alert(1)</script> & “引号”。';
  const { model, references } = scriptSource(body, []);
  const html = scriptPrintHtml({ title: 'A & <B>', model, references, pictures: new Map(), date: '今天' });
  assert.equal(html.includes('<script>alert'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; “引号”。/);
  assert.match(html, /<title>A &amp; &lt;B&gt;<\/title>/);
});
