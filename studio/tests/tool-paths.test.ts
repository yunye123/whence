import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setSavedToolPaths, toolPaths } from '../../electron/media';

test('toolPaths does not launch a process: Windows keeps AppData defaults, other systems use PATH names, CANVAS_* wins', () => {
  const home = path.join('/home', 'example');
  const windows = {
    python: path.join(home, 'AppData/Local/Programs/Python/Python312/python.exe'),
    ffmpeg: path.join(home, 'AppData/Local/Programs/ffmpeg/bin/ffmpeg.exe'),
    ffprobe: path.join(home, 'AppData/Local/Programs/ffmpeg/bin/ffprobe.exe'),
    model: path.join(home, '.cache/faster-whisper/large-v3'),
  };
  const portable = {
    python: 'python3',
    ffmpeg: 'ffmpeg',
    ffprobe: 'ffprobe',
    model: path.join(home, '.cache/faster-whisper/large-v3'),
  };
  assert.deepEqual(toolPaths({}, 'win32', home), windows);
  assert.deepEqual(toolPaths({}, 'darwin', home), portable);
  assert.deepEqual(toolPaths({}, 'linux', home), portable);
  const env = { CANVAS_PYTHON: 'custom-python', CANVAS_FFMPEG: 'custom-ffmpeg', CANVAS_FFPROBE: 'custom-ffprobe', CANVAS_MODEL: 'custom-model' };
  assert.deepEqual(toolPaths(env, 'win32', home), { python: 'custom-python', ffmpeg: 'custom-ffmpeg', ffprobe: 'custom-ffprobe', model: 'custom-model' });
  assert.deepEqual(toolPaths(env, 'linux', home), { python: 'custom-python', ffmpeg: 'custom-ffmpeg', ffprobe: 'custom-ffprobe', model: 'custom-model' });
});

test('a path saved in 本机工具 wins over CANVAS_*; a blank saved field keeps the environment', () => {
  const home = path.join('/home', 'example');
  setSavedToolPaths({ python: 'saved-python', ffmpeg: '  ', ffprobe: '', model: '' });
  try {
    const paths = toolPaths({ CANVAS_PYTHON: 'env-python', CANVAS_FFMPEG: 'env-ffmpeg' }, 'linux', home);
    assert.equal(paths.python, 'saved-python');
    assert.equal(paths.ffmpeg, 'env-ffmpeg');
    assert.equal(paths.ffprobe, 'ffprobe');
    assert.equal(toolPaths({ CANVAS_PYTHON: 'env-python' }, 'linux', home, true).python, 'env-python');
  } finally {
    setSavedToolPaths(null);
  }
});

test('an installer runtime is used when the individual CANVAS_* variables are empty', () => {
  const home = path.join('/home', 'example');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'field-runtime-'));
  const python = path.join(root, 'python', 'python.exe');
  const ffmpeg = path.join(root, 'ffmpeg', 'ffmpeg.exe');
  const ffprobe = path.join(root, 'ffmpeg', 'ffprobe.exe');
  const model = path.join(root, 'models', 'faster-whisper', 'large-v3', 'model.bin');
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.mkdirSync(path.dirname(ffmpeg), { recursive: true });
  fs.mkdirSync(path.dirname(model), { recursive: true });
  for (const file of [python, ffmpeg, ffprobe, model]) fs.writeFileSync(file, '');
  try {
    const paths = toolPaths({ CANVAS_RUNTIME: root }, 'win32', home);
    assert.equal(paths.python, python);
    assert.equal(paths.ffmpeg, ffmpeg);
    assert.equal(paths.ffprobe, ffprobe);
    assert.equal(paths.model, path.dirname(model));
    assert.equal(toolPaths({ CANVAS_RUNTIME: root, CANVAS_PYTHON: 'env-python' }, 'win32', home).python, 'env-python');
    assert.equal(toolPaths({ CANVAS_RUNTIME: path.join(root, 'missing') }, 'win32', home).python, path.join(home, 'AppData/Local/Programs/Python/Python312/python.exe'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
