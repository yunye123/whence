import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ocrCommand, ocrLaunch } from '../native/image-text';

test('installer OCR wins over a personal ocr.cmd, and a chosen path wins over both', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'field-ocr-home-'));
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'field-ocr-runtime-'));
  const personal = path.join(home, '.local', 'bin', 'ocr.cmd');
  const bundled = path.join(runtime, 'ocr', 'ocr.cmd');
  fs.mkdirSync(path.dirname(personal), { recursive: true });
  fs.mkdirSync(path.dirname(bundled), { recursive: true });
  fs.writeFileSync(personal, '@echo off\r\n');
  fs.writeFileSync(bundled, '@echo off\r\n');
  try {
    assert.equal(ocrCommand({}, 'win32', home), personal);
    assert.equal(ocrCommand({ CANVAS_RUNTIME: runtime }, 'win32', home), bundled);
    assert.equal(ocrCommand({ CANVAS_OCR: 'D:\\tools\\ocr.cmd', CANVAS_RUNTIME: runtime }, 'win32', home), 'D:\\tools\\ocr.cmd');
    assert.equal(ocrCommand({}, 'win32', path.join(home, 'empty')), '');
    fs.mkdirSync(path.join(runtime, 'python'), { recursive: true });
    fs.writeFileSync(path.join(runtime, 'python', 'python.exe'), '');
    fs.writeFileSync(path.join(runtime, 'ocr', 'ocr_fast.py'), '');
    const launch = ocrLaunch(bundled, path.join(runtime, 'pictures'), { CANVAS_RUNTIME: runtime }, 'win32');
    assert.equal(launch.executable, path.join(runtime, 'python', 'python.exe'));
    assert.equal(launch.verbatim, false);
    assert.equal(launch.args.at(-1), '--fast');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(runtime, { recursive: true, force: true });
  }
});
