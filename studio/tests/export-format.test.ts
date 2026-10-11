import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_FORMATS, EXPORT_COPY, parseFormatMemory, formatMemoryValue, defaultExportFormat, moveExportFormat, defaultScriptDraft, exportFilename } from '../src/dialogs/export-format';
import type { BoardNode } from '../src/model';

test('release 1 defaults to Markdown, restores per board, ignores invalid/unavailable formats', () => {
  const available = EXPORT_FORMATS.map(format => format.id);
  const memory = parseFormatMemory('{"one":"script","two":"moodboard","bad":"cover"}');
  assert.equal(defaultExportFormat('new', memory, available), 'markdown');
  assert.equal(defaultExportFormat('one', memory, available), 'script');
  assert.equal(defaultExportFormat('two', memory, available), 'moodboard');
  assert.equal(defaultExportFormat('one', memory, ['markdown', 'package']), 'markdown');
  assert.equal(defaultExportFormat('one', memory, available, 'moodboard'), 'moodboard');
  assert.equal(defaultExportFormat('one', memory, ['markdown'], 'moodboard'), 'markdown');
  assert.deepEqual(parseFormatMemory('broken'), {});
  assert.deepEqual(parseFormatMemory('[]'), {});
  const special = parseFormatMemory('{"__proto__":"script","constructor":"directory"}');
  assert.equal(Object.getPrototypeOf(special), Object.prototype);
  assert.equal(Object.hasOwn(special, '__proto__'), true);
  assert.equal(special.__proto__, 'script');
  assert.equal(parseFormatMemory(formatMemoryValue(memory, 'new', 'package')).one, 'script');
  assert.equal(parseFormatMemory(formatMemoryValue(memory, 'new', 'package')).new, 'package');
  assert.equal(EXPORT_FORMATS.length, 5);
  assert.ok(!EXPORT_FORMATS.some(format => String(format.id) === 'cover'));
});

test('format arrows wrap and skip unavailable formats; Home/End select the boundaries', () => {
  const available = ['script', 'markdown', 'package'] as const;
  assert.equal(moveExportFormat('package', 'ArrowRight', available), 'script');
  assert.equal(moveExportFormat('script', 'ArrowUp', available), 'package');
  assert.equal(moveExportFormat('markdown', 'Home', available), 'script');
  assert.equal(moveExportFormat('markdown', 'End', available), 'package');
  assert.equal(moveExportFormat('markdown', 'Escape', available), undefined);
  assert.equal(moveExportFormat('markdown', 'ArrowDown', []), undefined);
});

test('script picks inspected draft then supplied recent draft; saved-version time is a compatible fallback', () => {
  const draft = (id: string, date?: string): BoardNode => ({ id, type: 'card', position: { x: 0, y: 0 }, data: { kind: 'draft', title: id, body: '原文\r\n不变', draftVersions: date ? [{ id: 'v', title: id, body: '', createdAt: date }] : [] } });
  const nodes = [draft('older', '2026-10-01'), draft('newer', '2026-10-09'), draft('unsaved')];
  const snapshot = JSON.stringify(nodes);
  assert.equal(defaultScriptDraft(nodes, 'older', 'unsaved')?.id, 'older');
  assert.equal(defaultScriptDraft(nodes, undefined, 'unsaved')?.id, 'unsaved');
  assert.equal(defaultScriptDraft(nodes)?.id, 'newer');
  assert.equal(defaultScriptDraft([]), undefined);
  assert.equal(JSON.stringify(nodes), snapshot);
  assert.equal(exportFilename('a:/b', 'package'), 'a--b.field.json');
  assert.equal(exportFilename('', 'markdown'), '文稿.md');
  assert.equal(EXPORT_COPY.noDraft, '本画布没有文稿。先添加一篇文稿，再导出分镜脚本。');
});
