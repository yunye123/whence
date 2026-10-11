import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateFileExportInput, writeSelectedExport, fileExportError, FILE_EXPORT_LIMITS } from '../native/file-export';
import { saveExport } from '../src/file-export';

const bytes = (text: string) => new TextEncoder().encode(text);
const base = path.resolve('output/quality-20261003');
async function fixture() {
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'file-export-test-'));
  return { directory, async clean() {
    assert.equal(path.dirname(directory), base); assert.ok(path.basename(directory).startsWith('file-export-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  } };
}

test('export input is bounded, owns the byte slice and cannot smuggle renderer paths', () => {
  const data = bytes('前中文后').subarray(3, 9);
  const checked = validateFileExportInput({ format: 'markdown', suggestedName: '文稿/来源:一.md', data });
  assert.equal(checked.suggestedName, '文稿-来源-一.md');
  assert.deepEqual(checked.data, bytes('中文'));
  data.fill(0); assert.deepEqual(checked.data, bytes('中文'));
  assert.equal(validateFileExportInput({ format: 'txt', suggestedName: 'CON.txt', data: bytes('') }).suggestedName, '来处-CON.txt');
  assert.throws(() => validateFileExportInput({ format: 'txt', suggestedName: '稿', data: bytes('x'), path: 'other' }), /不支持的字段/);
  assert.throws(() => validateFileExportInput({ format: 'docx', suggestedName: '稿', data: bytes('x') }), /不受支持/); // pdf and png are supported since CORE-30
  assert.throws(() => validateFileExportInput({ format: 'txt', suggestedName: '稿', data: new Uint8Array(FILE_EXPORT_LIMITS.txt + 1) }), /4 MiB/);
  assert.throws(() => validateFileExportInput({ format: 'field-json', suggestedName: '稿', data: bytes('') }), /不能为空/);
  assert.throws(() => validateFileExportInput({ format: 'txt', suggestedName: '稿', data: [1, 2] }), /格式不正确/);
});

test('native export saves exact Unicode bytes, replaces a file and leaves no temporary files', async () => {
  const temporary = await fixture();
  try {
    const target = path.join(temporary.directory, '作品.md');
    await fs.writeFile(target, '旧稿');
    const data = bytes('# 我的作品\n\n原文\r\n🙂\n');
    const result = await writeSelectedExport(target, { format: 'markdown', suggestedName: '作品.md', data });
    assert.deepEqual(result, { status: 'saved', path: target });
    assert.deepEqual(new Uint8Array(await fs.readFile(target)), data);
    assert.deepEqual(await fs.readdir(temporary.directory), ['作品.md']);
  } finally { await temporary.clean(); }
});

test('failed replacement is cleaned and cannot report saved or delete the chosen target', async () => {
  const temporary = await fixture();
  try {
    const target = path.join(temporary.directory, '目标.md'); await fs.mkdir(target);
    await fs.writeFile(path.join(target, '保留.txt'), '原始资料');
    await assert.rejects(writeSelectedExport(target, { format: 'markdown', suggestedName: '稿.md', data: bytes('新稿') }));
    assert.equal(await fs.readFile(path.join(target, '保留.txt'), 'utf8'), '原始资料');
    assert.deepEqual(await fs.readdir(temporary.directory), ['目标.md']);
    await assert.rejects(writeSelectedExport('renderer-relative.md', { format: 'markdown', suggestedName: '稿.md', data: bytes('新稿') }), /保存窗口/);
    await assert.rejects(writeSelectedExport(path.join(temporary.directory, 'missing', '稿.md'), { format: 'markdown', suggestedName: '稿.md', data: bytes('新稿') }), /已不存在/);
  } finally { await temporary.clean(); }
});

test('native errors retain helpful reasons through the IPC wrapper without exposing paths', () => {
  const error = Object.assign(new Error('ENOSPC C:\\private\\secret'), { code: 'ENOSPC' });
  const clean = fileExportError(error);
  assert.match(clean.message, /空间不足/);
  assert.equal(fileExportError(clean).message, clean.message);
  assert.doesNotMatch(fileExportError(new Error('private native stack')).message, /private/);
});

function replaceGlobal(name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return () => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); };
}

test('frontend passes the native saved, cancelled and failed outcomes through exactly', async () => {
  const input = { format: 'markdown' as const, suggestedName: '稿.md', data: bytes('内容') };
  for (const result of [{ status: 'saved' as const, path: 'selected.md' }, { status: 'cancelled' as const }]) {
    let seen: unknown;
    const restore = replaceGlobal('window', { fieldFileExport: { save: async (value: unknown) => { seen = value; return result; } } });
    try { assert.deepEqual(await saveExport(input), result); assert.equal(seen, input); } finally { restore(); }
  }
  const restore = replaceGlobal('window', { fieldFileExport: { save: async () => { throw new Error('文件未保存'); } } });
  try { await assert.rejects(saveExport(input), /文件未保存/); } finally { restore(); }
});

test('browser export starts a download and retains its URL until deferred cleanup', async () => {
  const events: string[] = [];
  const anchor = { href: '', download: '', click() { events.push('clicked'); }, remove() { events.push('removed'); } };
  let cleanup: (() => void) | undefined, delay = 0, delivered: Blob | undefined;
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const restoreWindow = replaceGlobal('window', {});
  const restoreDocument = replaceGlobal('document', { body: { append(value: unknown) { assert.equal(value, anchor); events.push('appended'); } }, createElement() { return anchor; } });
  const restoreTimeout = replaceGlobal('setTimeout', (callback: () => void, milliseconds: number) => { cleanup = callback; delay = milliseconds; return 1; });
  URL.createObjectURL = (blob: Blob) => { delivered = blob; return 'blob:test-export'; };
  URL.revokeObjectURL = url => { assert.equal(url, 'blob:test-export'); events.push('revoked'); };
  try {
    const result = await saveExport({ format: 'txt', suggestedName: '我的稿', data: bytes('原文🙂') });
    assert.deepEqual(result, { status: 'download-started' });
    assert.equal(anchor.download, '我的稿.txt'); assert.equal(anchor.href, 'blob:test-export');
    assert.equal(await delivered!.text(), '原文🙂');
    assert.deepEqual(events, ['appended', 'clicked', 'removed']); assert.ok(delay >= 10_000);
    cleanup!(); assert.deepEqual(events, ['appended', 'clicked', 'removed', 'revoked']);
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; restoreTimeout(); restoreDocument(); restoreWindow(); }
});

test('CORE-30: the desktop export channel saves PNG and PDF moodboards and refuses a payload without their signature', async () => {
  const { validateFileExportInput } = await import('../native/file-export');
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const pdf = new TextEncoder().encode('%PDF-1.7\n%…');
  assert.equal(validateFileExportInput({ format: 'png', suggestedName: '光的灵感板', data: png }).suggestedName, '光的灵感板.png');
  assert.equal(validateFileExportInput({ format: 'pdf', suggestedName: '光的灵感板.pdf', data: pdf }).suggestedName, '光的灵感板.pdf');
  assert.throws(() => validateFileExportInput({ format: 'png', suggestedName: 'x', data: pdf }), /PNG内容不完整/);
  assert.throws(() => validateFileExportInput({ format: 'pdf', suggestedName: 'x', data: new Uint8Array() }), /PDF内容不完整/);
});
