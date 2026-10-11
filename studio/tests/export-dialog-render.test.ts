import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ModalShell from '../src/shell/ModalShell';

import ExportDialog from '../src/dialogs/ExportDialog';

import { createBoard, createExampleBoard } from '../src/templates';
import { layoutMoodboard, moodGroups, sheetFor, jpegToPdf, type MoodItem } from '../src/dialogs/moodboard';
import { frameContainsCard } from '../src/card-placement';
import type { BoardNode } from '../src/model';

import { attr, getBy, getByRole, isDisabled, mentions, queryAll, textContent } from './helpers/markup';

const noop = () => {};
const inModal = (kind: string, child: ReactElement) => renderToStaticMarkup(createElement(ModalShell, { kind, locked: false, closeDisabled: false, onClose: noop, children: child }));

test('export dialog: titled “导出”; options read as what you get; folder export says why it is unavailable', () => {
  const board = createExampleBoard('creative');
  const html = inModal('export', createElement(ExportDialog, { board, busy: false, directoryAvailable: false, onExportPackage: noop, onExportDirectory: noop, onExportMarkdown: noop }));
  getBy(html, { attrs: { id: 'modal-title' }, text: '导出' });
  const options = getBy(html, { className: 'export-options' });
  assert.equal(attr(options, 'role'), 'radiogroup');
  const radios = queryAll(options, { role: 'radio' });
  assert.equal(radios.length, 5);
  assert.ok(radios.every(radio => radio.tag === 'button'), 'K6 HTML buttons remain');
  const names = radios.map(button => textContent(button));
  assert.ok(names[0].startsWith('分镜脚本'));
  assert.equal(attr(getByRole(options, 'radio', '文稿与参考资料'), 'aria-checked'), 'true');
  assert.ok(names.some(name => name.startsWith('灵感板')));
  assert.ok(names.some(name => name.startsWith('便携画布文件')));
  const folder = getByRole(options, 'radio', '另存完整画布目录');
  assert.ok(isDisabled(folder));
  assert.ok(mentions(folder, '需要桌面版'));
  const empty = inModal('export', createElement(ExportDialog, { board: createBoard('blank'), busy: false, directoryAvailable: true, onExportPackage: noop, onExportDirectory: noop, onExportMarkdown: noop }));
  assert.ok(isDisabled(getByRole(empty, 'radio', /^灵感板/)), 'no images: moodboard export explains instead of opening');
  assert.ok(isDisabled(getByRole(empty, 'radio', '分镜脚本')));
  assert.ok(mentions(empty, '本画布没有文稿。'));
  assert.equal(queryAll(html, { className: 'modal-footer' }).length, 1, 'one shared footer');
  assert.ok(!names.some(name => name.includes('封面')));
});

test('export dialog: selection entry keeps the title and unified footer; optional props preserve contract fixtures', () => {
  const board = createExampleBoard('creative');
  const html = inModal('export', createElement(ExportDialog, { board, busy: false, directoryAvailable: false, onExportPackage: noop, onExportDirectory: noop, onExportMarkdown: noop, initialView: 'moodboard' }));
  getByRole(html, 'dialog', '导出');
  assert.equal(attr(getByRole(html, 'radio', '灵感板'), 'aria-checked'), 'true');
  assert.equal(queryAll(html, { className: 'modal-footer' }).length, 1);
  getByRole(html, 'button', '取消');
  getByRole(html, 'button', '导出');
});

test('moodboard layouts keep every image inside the sheet, unclipped and non-overlapping', () => {
  const ratios = [21 / 9, 16 / 9, 3 / 2, 4 / 3, 1, 4 / 5, 3 / 4, 2 / 3];
  const items: MoodItem[] = ratios.map((ratio, index) => ({ id: `i${index}`, title: `图 ${index}`, note: '', source: '本机导入', ratio }));
  for (const layout of ['rows', 'grid', 'masonry'] as const) {
    for (const format of ['png', 'pdf-a4'] as const) {
      const sheet = sheetFor(format);
      const result = layoutMoodboard(items, sheet, { layout, margin: 24, caption: 'filename', footer: true });
      assert.equal(result.tiles.length, items.length);
      for (const tile of result.tiles) {
        assert.ok(tile.image.x >= 0 && tile.image.y >= 0 && tile.image.x + tile.image.w <= sheet.width + .5 && tile.image.y + tile.image.h <= sheet.height + .5, `${layout} tile inside the sheet`);
        assert.ok(Math.abs(tile.image.w / tile.image.h - tile.item.ratio) < .01, `${layout} keeps the original ratio`);
      }
      for (let a = 0; a < result.tiles.length; a++) for (let b = a + 1; b < result.tiles.length; b++) {
        const p = result.tiles[a].cell, q = result.tiles[b].cell;
        assert.ok(p.x + p.w <= q.x + .5 || q.x + q.w <= p.x + .5 || p.y + p.h <= q.y + .5 || q.y + q.h <= p.y + .5, `${layout} tiles do not overlap`);
      }
    }
  }
  const groups = moodGroups(createExampleBoard('creative'));
  assert.ok(groups.length >= 3, 'two frames plus “全部图片”');
  assert.equal(groups.at(-1)?.id, 'all');
  const pdf = new TextDecoder().decode(jpegToPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 10, 7, 'pdf-a4'));
  assert.ok(pdf.startsWith('%PDF-1.4') && pdf.includes('/DCTDecode') && pdf.trimEnd().endsWith('%%EOF'));
});

test('moodboard groups count like the tray label: imported pictures without a stored height use the canvas measurements (FC-01)', () => {
  const board = createBoard('blank');
  const frame: BoardNode = { id: 'tray', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'frame', title: '新分组', body: '' }, style: { width: 990, height: 820 } };
  // Two rows, stored width only (as imported); on the canvas each picture is as tall as its ratio makes it.
  const ratios = [16 / 9, 9 / 16, 1, 32 / 9, 3 / 2, 4 / 3];
  const images: BoardNode[] = ratios.map((_, index) => ({ id: `img${index}`, type: 'card', position: { x: 24 + (index % 3) * 314, y: index < 3 ? 40 : 580 }, data: { kind: 'image', title: `0${index + 1}`, body: '' }, style: { width: 290 } }));
  board.nodes = [frame, ...images];
  const measurements = Object.fromEntries([[frame.id, { width: 990, height: 820 }], ...images.map((node, index) => [node.id, { width: 290, height: Math.round(290 / ratios[index]) }] as const)]);
  const group = moodGroups(board, undefined, measurements).find(item => item.id === frame.id);
  assert.equal(group?.items.length, 6, 'all six pictures belong to the group');
  assert.equal(group?.items.length, images.filter(node => frameContainsCard(frame, node, measurements)).length, 'the same members as the tray label');
  assert.deepEqual(group?.items.map(item => item.title), ['01', '02', '03', '04', '05', '06'], 'read in rows');
  assert.ok(Math.abs(group!.items[3].ratio - 32 / 9) < .05, 'until the file loads, a picture keeps its measured ratio');
});

test('moodboard layout: masonry fills its box, PNG fits the content, numbers and captions sit under the picture (DLG-07, DLG-17)', () => {
  const items: MoodItem[] = [21 / 9, 16 / 9, 4 / 3, 3 / 2, 3 / 4].map((ratio, index) => ({ id: `m${index}`, title: `图${index + 1}`, note: '', source: '来处示例素材', ratio }));
  const masonry = layoutMoodboard(items, sheetFor('png'), { layout: 'masonry', margin: 24, caption: 'none', footer: true, format: 'png' });
  const box = (tiles: typeof masonry.tiles) => {
    const left = Math.min(...tiles.map(tile => tile.image.x)), top = Math.min(...tiles.map(tile => tile.image.y));
    const right = Math.max(...tiles.map(tile => tile.image.x + tile.image.w)), bottom = Math.max(...tiles.map(tile => tile.image.y + tile.image.h));
    return { left, top, right, bottom, area: (right - left) * (bottom - top) };
  };
  const filled = masonry.tiles.reduce((sum, tile) => sum + tile.image.w * tile.image.h, 0) / box(masonry.tiles).area;
  assert.ok(filled > .85, `masonry leaves no column-sized hole (${filled.toFixed(2)})`);
  const bounds = box(masonry.tiles);
  assert.ok(Math.abs(bounds.left - 24) < 1 && Math.abs(masonry.sheet.width - bounds.right - 24) < 1, 'PNG keeps the chosen margin on both sides');
  assert.ok(masonry.sheet.height < sheetFor('png').height, 'PNG height follows the content');
  assert.ok(masonry.title.y < bounds.top, 'the title sits above the pictures');
  for (const tile of masonry.tiles) {
    assert.ok(tile.caption && tile.caption.y >= tile.image.y + tile.image.h, 'the number is written under the picture, not on it');
    assert.equal(tile.caption!.x, tile.image.x);
  }
  for (let index = 1; index < masonry.tiles.length; index++) {
    const previous = masonry.tiles[index - 1].image, current = masonry.tiles[index].image;
    assert.ok(previous.y < current.y || (previous.y === current.y && previous.x < current.x), 'masonry numbers follow the reading order');
  }
  const grid = layoutMoodboard(items, sheetFor('png'), { layout: 'grid', margin: 48, caption: 'filename', footer: true, format: 'png' });
  for (const tile of grid.tiles) assert.equal(tile.caption!.x, tile.image.x, 'captions start at the picture, not at the cell');
  assert.deepEqual(grid.footerLines, ['1–5　来处示例素材'], 'with file names under the pictures, the footer lists only the sources');
  const pdf = layoutMoodboard(items, sheetFor('pdf-a4'), { layout: 'rows', margin: 24, caption: 'none', footer: false, format: 'pdf-a4' });
  assert.deepEqual(pdf.sheet, { width: sheetFor('pdf-a4').width, height: sheetFor('pdf-a4').height }, 'PDF keeps its page');
});
