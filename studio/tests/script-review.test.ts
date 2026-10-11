import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildScript, isPictureNote, isScriptLine, shotPickTime } from '../src/inspector/script-view/script-model';
import ScriptView from '../src/inspector/script-view/ScriptView';
import { frameTimes } from '../src/inspector/script-view/ShotFrame';
import { BoardContext } from '../src/board-context';
import type { BoardActions } from '../src/board-context';

// Round 3 script review (the video blogger pass): a line marked “画面：” without an excerpt is a shot still to find,
// “补一个镜头” opens the film next to the scene's own shots, and a thumbnail never settles on the black first frame.

const link = (n: number, t: number) => `[来源：样片 ${n}](field://node/film-1?t=${t})`;
const body = ['## 开场', '', '画面：路口只有一盏灯。', '', `> 凌晨四点。${link(1, 25)}`, '', '旁白：先交代人。', '', '## 出摊', '', '镜头贴着锅。', '', `> 蒸笼一掀开。${link(2, 61)}`].join('\n');

test('a “画面：” or “镜头：” line without an excerpt is a picture note; with an excerpt or another label it is not', () => {
  const model = buildScript(body);
  const lines = model.scenes.flatMap(scene => scene.rows.filter(isScriptLine));
  assert.deepEqual(lines.map(line => [line.label ?? '', isPictureNote(line)]), [['画面', true], ['', false], ['旁白', false], ['', false], ['', false]]);
  const shot = buildScript(`## 一\n\n画面：灯。${link(1, 5)}`).scenes[0].rows.filter(isScriptLine)[0];
  assert.equal(isPictureNote(shot), false, 'a 画面 line that already has its excerpt shows the frame');
});

test('补一个镜头 opens the film at the scene range, else next to the shots of the same scene', () => {
  const model = buildScript(body);
  const [opening, stall] = model.scenes;
  const lines = (index: number) => model.scenes[index].rows.filter(isScriptLine);
  assert.equal(shotPickTime(opening, lines(0)[0]), 25, 'before the first shot: at that shot');
  assert.equal(shotPickTime(opening, lines(0)[2]), 25, 'after a shot without an end: at its start');
  assert.equal(shotPickTime(stall, lines(1)[0]), 61);
  const timed = buildScript('## 结尾 01:50–02:20\n\n收摊。').scenes[0];
  assert.equal(shotPickTime(timed, timed.rows.filter(isScriptLine)[0]), 110, 'a heading range wins');
  const bare = buildScript('## 空\n\n只有文字。').scenes[0];
  assert.equal(shotPickTime(bare, bare.rows.filter(isScriptLine)[0]), undefined);
});

test('a thumbnail looks past a black opening: first frame, then further into the excerpt, inside it', () => {
  assert.deepEqual(frameTimes(0, 6).map(value => Math.round(value * 100) / 100), [0.04, 1, 2]);
  assert.deepEqual(frameTimes(72, 74).map(value => Math.round(value * 100) / 100), [72.04, 72.6, 73]);
  for (const value of frameTimes(10, 10.3)) assert.ok(value < 10.3, 'never past the excerpt');
});

test('the picture note renders in the 画面 cell with its own 补一个镜头; its 旁白 cell is empty', () => {
  const noop = () => {};
  const film = { id: 'film-1', type: 'card' as const, position: { x: 0, y: 0 }, data: { kind: 'video' as const, title: '样片', body: '' } };
  const board = { nodes: [film], getMediaUrl: () => undefined, readOnly: false } as unknown as BoardActions;
  const model = buildScript(body);
  const html = renderToStaticMarkup(createElement(BoardContext.Provider, { value: board },
    createElement(ScriptView, { model, references: [], nodes: [film], readOnly: false, actions: { open: noop, openSource: noop, edit: noop, showBody: noop } })));
  const row = html.slice(html.indexOf('is-picture-note'), html.indexOf('</div></div>', html.indexOf('is-picture-note')) + 200);
  assert.match(row, /draft-script__shot-note/);
  assert.match(row, /路口只有一盏灯/);
  assert.match(row, /补一个镜头/);
  assert.match(html, /<span class="sr-only">没有旁白<\/span>/);
  assert.equal(/class="draft-script__label">画面/.test(html), false, 'no 画面 chip inside the 画面 column');
  assert.equal(/class="draft-script__label">旁白/.test(html), false, 'no 旁白 chip inside the 旁白 column');
});
