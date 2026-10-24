import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { toolPaths } from '../../electron/media';

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
