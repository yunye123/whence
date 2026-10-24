import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPEARANCE_FILE, WINDOW_GROUND, saveAppearance, savedAppearance, windowGround } from '../native/window-appearance';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('CORE-29: the window colour follows the saved appearance, or the system when nothing is saved', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'field-appearance-'));
  try {
    assert.equal(savedAppearance(directory), 'system', 'first start: nothing saved');
    assert.equal(windowGround(savedAppearance(directory), false), WINDOW_GROUND.light);
    assert.equal(windowGround(savedAppearance(directory), true), WINDOW_GROUND.dark);
    saveAppearance(directory, 'light');
    assert.equal(windowGround(savedAppearance(directory), true), '#D2D1CE', 'a light choice wins over a dark system');
    saveAppearance(directory, 'dark');
    assert.equal(windowGround(savedAppearance(directory), false), '#1A1917', 'a dark choice wins over a light system');
    assert.deepEqual(fs.readdirSync(directory), [APPEARANCE_FILE], 'no temporary file is left behind');
    fs.writeFileSync(path.join(directory, APPEARANCE_FILE), '{"preference":"sepia"}');
    assert.equal(savedAppearance(directory), 'system', 'an unknown value is ignored');
    fs.writeFileSync(path.join(directory, APPEARANCE_FILE), 'not json');
    assert.equal(savedAppearance(directory), 'system', 'an unreadable file is ignored');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

const python = process.env.CANVAS_PYTHON || path.join(os.homedir(), 'AppData/Local/Programs/Python/Python312/python.exe');

test('CORE-06: FIELD’s worker writes Chinese marks and never returns its own prompt', { skip: !fs.existsSync(python) && 'Python not installed' }, () => {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(root, 'native', 'workers'))})
import transcribe as t
print(json.dumps({
  "marks": [t.chinese_marks(x) for x in ["视频,", "对吧?", "好!", "第一步:", "1,000", "10:30", "照片﹑", "打﹐", "VDA Large,"]],
  "echo": [t.echoes_prompt(x) for x in [t.PUNCTUATION_PROMPT, "以下是一段普通话口语。", " 使用简体中文", "标点", "一张照片，一段现成的视频", "大家好，今天聊聊口语"]],
  "prompt": t.PUNCTUATION_PROMPT,
}, ensure_ascii=False))
`;
  const run = spawnSync(python, ['-B', '-c', script], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.deepEqual(result.marks, ['视频，', '对吧？', '好！', '第一步：', '1,000', '10:30', '照片，', '打，', 'VDA Large，'], 'a mark after a Western word inside Chinese speech is a Chinese mark too');
  assert.deepEqual(result.echo, [true, true, true, false, false, false], 'only text that is (a part of) the prompt is dropped');
  assert.match(result.prompt, /[，。、]/, 'the prompt itself carries full Chinese punctuation');
});

test('CORE-06: the desktop build uses FIELD’s own worker; the legacy worker stays untouched', () => {
  const build = fs.readFileSync(path.join(root, 'scripts', 'build-native.mjs'), 'utf8');
  const main = fs.readFileSync(path.join(path.dirname(root), 'electron/main.ts'), 'utf8');
  assert.match(build, /path\.join\(studioRoot, 'native', 'workers'\)/);
  assert.match(main, /CANVAS_WORKER_DIR = path\.join\(studioRoot, 'native', 'workers'\)/);
  assert.ok(fs.existsSync(path.join(root, 'native', 'workers', 'transcribe.py')));
  const legacy = path.join(path.dirname(root), 'workers', 'transcribe.py');
  if (fs.existsSync(legacy)) assert.doesNotMatch(fs.readFileSync(legacy, 'utf8'), /initial_prompt/, 'the older app keeps its own worker');
});

test('English-to-Chinese is one IPC on the desktop shell', () => {
  const main = fs.readFileSync(path.join(path.dirname(root), 'electron/main.ts'), 'utf8');
  const desktop = fs.readFileSync(path.join(root, 'native/canvas-desktop.ts'), 'utf8');
  const bridge = fs.readFileSync(path.join(root, 'native/preload-bridge.ts'), 'utf8');
  assert.match(main, /canvasDesktop\.register\(handle, selectDirectory\)/);
  assert.match(desktop, /from '\.\.\/src\/english-translation'/);
  assert.match(desktop, /handle\('translate-english', input => translateEnglish\(input, translationSettingsFromEnv\(process\.env\)\)\)/);
  assert.equal((desktop.match(/translateEnglish/g) ?? []).length, 2);
  assert.match(bridge, /studio:translate-english/);
  assert.match(desktop, /handle\('fetch-web-page'/);
  assert.match(bridge, /studio:fetch-web-page/);
});

test('2026-10-07 rename: the desktop window is titled 来处 and carries the app icon (field.ico keeps its file name)', () => {
  const main = fs.readFileSync(path.join(path.dirname(root), 'electron/main.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(path.dirname(root), 'electron/preload.ts'), 'utf8');
  const build = fs.readFileSync(path.join(root, 'scripts', 'build-native.mjs'), 'utf8');
  assert.match(main, /title: '来处'/);
  assert.match(main, /path\.join\(studioRoot, 'desktop-assets', 'field\.ico'\)/);
  assert.equal(main.match(/dialog\.showMessageBox\(window, \{ title: '来处', type: '(info|question|error)'/g)?.length, 3, 'the close-time message boxes are titled 来处, not the process name');
  assert.match(preload, /from '\.\.\/studio\/native\/preload-bridge'/);
  assert.match(preload, /exposeVideoImports\(\)/);
  assert.match(preload, /reportAppearance\(\)/);
  assert.doesNotMatch(build, /replaceOnce/);
  assert.doesNotMatch(build, /translateEnglish/);
  assert.doesNotMatch(build, /云野参考画布/);
  assert.doesNotMatch(build, /originalsUnchanged/);
  const ico = fs.readFileSync(path.join(root, 'desktop-assets', 'field.ico'));
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1], 'an .ico file');
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, index) => ico[6 + index * 16] || 256);
  for (const size of [16, 24, 32, 48, 256]) assert.ok(sizes.includes(size), `the icon has a ${size}px image`);
});
