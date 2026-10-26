import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MEDIA_TOOLS_FILE, clearMediaTools, parseMediaTools, readMediaTools, writeMediaTools } from '../native/media-tools';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'field-media-tools-'));
}

test('saved tool paths stay in the profile and a blank form returns to the default', () => {
  const directory = tempDir();
  try {
    assert.deepEqual(readMediaTools(directory), { python: '', ffmpeg: '', ffprobe: '', model: '' });
    const saved = writeMediaTools(directory, { python: '  D:\\Python\\python.exe  ', ffmpeg: '', ffprobe: 'C:\\ffmpeg\\ffprobe.exe', model: '' });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.settings.python, 'D:\\Python\\python.exe');
    assert.equal(saved.settings.ffprobe, 'C:\\ffmpeg\\ffprobe.exe');
    const file = fs.readFileSync(path.join(directory, MEDIA_TOOLS_FILE), 'utf8');
    assert.match(file, /"version":1/);
    assert.equal(readMediaTools(directory).python, 'D:\\Python\\python.exe');
    const cleared = clearMediaTools(directory);
    assert.equal(cleared.ok, true);
    assert.equal(fs.existsSync(path.join(directory, MEDIA_TOOLS_FILE)), false);
    const blank = writeMediaTools(directory, { python: ' ', ffmpeg: '', ffprobe: '', model: '' });
    assert.equal(blank.ok, true);
    assert.equal(fs.existsSync(path.join(directory, MEDIA_TOOLS_FILE)), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('tool paths reject a broken value and ignore an unfamiliar file', () => {
  const directory = tempDir();
  try {
    assert.equal(parseMediaTools({ python: 'a\nb' }).ok, false);
    assert.equal(parseMediaTools({ python: 'x'.repeat(1001) }).ok, false);
    assert.equal(parseMediaTools(null).ok, false);
    fs.writeFileSync(path.join(directory, MEDIA_TOOLS_FILE), '{');
    assert.deepEqual(readMediaTools(directory), { python: '', ffmpeg: '', ffprobe: '', model: '' });
    fs.writeFileSync(path.join(directory, MEDIA_TOOLS_FILE), JSON.stringify({ version: 2, python: 'elsewhere' }));
    assert.equal(readMediaTools(directory).python, '');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
