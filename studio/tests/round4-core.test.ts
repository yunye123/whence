import assert from 'node:assert/strict';
import test from 'node:test';
import { GALLERY_MIN_ZOOM, framedStart } from '../src/canvas/reveal';
import { arrangeFrame, moveIntoFrame, TRAY_PADDING } from '../src/app/frame-layout';
import { rememberImageRatio } from '../src/card-placement';
import { clearToasts, getToasts, showToast, TOAST_TAKEOVER_MS } from '../src/shell/Toasts';
import type { Board, BoardNode } from '../src/model';

// Round 4 fix-core: a gallery's first screen, a tray that closes its rows, a grid without ragged rows, one toast per step.

const trayBand = (zoom: number) => 30 / (zoom < .85 ? Math.floor(zoom * 20 + 1e-6) / 20 : 1);
const tray = { x: 0, y: 36, width: 1048, height: 769 };   // “清晨的街”: three rows of pictures, label above

test('CORE-22: a gallery opens on its whole first tray, above the toolbar, down to 60% for pictures only', () => {
  // 1440×900 with the sidebar: canvas 1200×852, toolbar row 64 + gap 24 at the bottom.
  const wide = framedStart(tray, { width: 1200, height: 852 }, { top: 24, right: 24, bottom: 88, left: 24 }, { minZoom: GALLERY_MIN_ZOOM, give: TRAY_PADDING, headroom: 12, band: trayBand });
  assert.deepEqual(wide, { zoom: .95, top: 36 - 30 }, 'whole at 95% (100% put the last row under the toolbar)');
  // 1366×768: 78%, in the simple tier the label keeps its screen size (band 30 / 0.75).
  const laptop = framedStart(tray, { width: 1126, height: 720 }, { top: 24, right: 24, bottom: 88, left: 24 }, { minZoom: GALLERY_MIN_ZOOM, give: TRAY_PADDING, headroom: 12, band: trayBand });
  assert.equal(laptop?.zoom, .78);
  assert.ok((tray.height + trayBand(.78)) * .78 <= 720 - 24 - 88 + 24, 'tray and label inside the safe area and its comfort gap');
  // 1093×614 (1366×768 at 125%): only 60% is left; the tray's bottom padding and half the top gap make it fit.
  const scaled = framedStart(tray, { width: 1093, height: 566 }, { top: 24, right: 24, bottom: 88, left: 24 }, { minZoom: GALLERY_MIN_ZOOM, give: TRAY_PADDING, headroom: 12, band: trayBand })!;
  assert.equal(scaled.zoom, .6);
  const over = (tray.height + trayBand(.6) - TRAY_PADDING) * .6 - (566 - 24 - 88) - 24;
  assert.ok(over > 0 && over <= 12, 'the label uses part of the top gap, no more');
  assert.ok(Math.abs(scaled.top - (tray.y - trayBand(.6) + over / .6)) < 1e-9);
  // Text trays keep the 85% floor; a tray that cannot be whole even at the floor returns null (the old rule applies).
  assert.equal(framedStart(tray, { width: 1093, height: 566 }, { top: 24, right: 24, bottom: 88, left: 24 }, { give: TRAY_PADDING, headroom: 12, band: trayBand }), null);
  assert.deepEqual(framedStart(tray, { width: 1680, height: 1032 }, { top: 24, right: 24, bottom: 88, left: 24 }, { band: trayBand }), { zoom: 1, top: 6 }, '1920×1080 stays at 100%');
});

function picture(id: string, x: number, y: number, width: number, height: number, natural: [number, number]): BoardNode {
  rememberImageRatio(`${id}.jpg`, natural[0], natural[1]);
  return { id, type: 'card', position: { x, y }, data: { kind: 'image', title: id, body: '', poster: `${id}.jpg` }, style: { width, height } };
}
function board(nodes: BoardNode[]): Board {
  return { id: 'b', title: '测试', description: '', category: 'design', createdAt: '', updatedAt: '', nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
}
/** The creative example's first tray: rows of 240 / 238 / 235 across an inner width of 1016. */
function streetTray(): BoardNode[] {
  const rows: [number, number][][] = [[[21, 9], [1, 1], [4, 5]], [[4, 3], [3, 2], [4, 3]], [[16, 9], [2, 3], [16, 9]]];
  const nodes: BoardNode[] = [{ id: 'f', type: 'card', position: { x: 0, y: 36 }, data: { kind: 'frame', title: '清晨的街', body: '' }, style: { width: 1048, height: 769 } }];
  let top = 52;
  rows.forEach((row, r) => {
    const height = (1016 - 24) / row.reduce((sum, [w, h]) => sum + w / h, 0);
    let left = 16;
    row.forEach(([w, h], index) => {
      const width = index === row.length - 1 ? 16 + 1016 - left : Math.round(height * w / h);
      nodes.push(picture(`s${r}${index}`, left, Math.round(top), width, Math.round(height), [w * 300, h * 300]));
      left += width + 12;
    });
    top += height + 12;
  });
  return nodes;
}
function rowsOf(next: Board, ids: string[]) {
  const placed = next.nodes.filter(node => ids.includes(node.id));
  return [...new Set(placed.map(node => node.position.y))].sort((a, b) => a - b).map(y => {
    const row = placed.filter(node => node.position.y === y);
    return { y, height: row[0].style!.height!, right: Math.max(...row.map(node => node.position.x + node.style!.width!)), ids: row.map(node => node.id) };
  });
}

test('round 4: a 1:3 picture joining the example tray closes every row (no third of the last row left empty)', () => {
  const nodes = [...streetTray(), picture('narrow', 1400, 0, 80, 240, [300, 900])];
  const next = moveIntoFrame(board(nodes), 'narrow', 'f');
  const ids = nodes.filter(node => node.id !== 'f').map(node => node.id);
  const rows = rowsOf(next, ids);
  for (const row of rows) assert.equal(row.right, 1032, `row at ${row.y} reaches the tray's right padding`);
  const narrow = next.nodes.find(node => node.id === 'narrow')!;
  assert.ok(narrow.style!.width! >= 80 && Math.abs(narrow.style!.width! / narrow.style!.height! - 1 / 3) < .03, 'keeps its ratio and its minimum width');
  const heights = rows.map(row => row.height);
  assert.ok(Math.max(...heights) / Math.min(...heights) < 1.45, `rows stay near one height (${heights.join('/')})`);
  const frame = next.nodes.find(node => node.id === 'f')!;
  assert.equal(frame.style!.height, Math.max(...rows.map(row => row.y + row.height)) - 36 + TRAY_PADDING, 'the tray wraps the rows exactly');
  for (const node of next.nodes) assert.ok([node.position.x, node.position.y, node.style!.width, node.style!.height].every(Number.isInteger));
});

test('round 4: a landscape picture joining the tray goes into the last row; the rows above do not move', () => {
  const nodes = [...streetTray(), picture('wide', 1400, 0, 320, 180, [1600, 900])];
  const before = board(nodes);
  const next = moveIntoFrame(before, 'wide', 'f');
  for (const id of ['s00', 's01', 's02', 's10', 's11', 's12']) assert.deepEqual(next.nodes.find(node => node.id === id), before.nodes.find(node => node.id === id), `${id} stays`);
  const rows = rowsOf(next, nodes.filter(node => node.id !== 'f').map(node => node.id));
  assert.equal(rows.length, 3);
  assert.ok(rows[2].ids.includes('wide') && rows[2].right === 1032, 'the last row takes it and is justified');
});

test('round 4: the grid picks the column count that leaves no ragged rows (twelve pictures, four of them wide)', () => {
  const ratios: [number, number][] = [[16, 9], [9, 16], [1, 1], [32, 9], [1, 3], [3, 2], [2, 3], [4, 1], [1, 1], [4, 3], [239, 100], [3, 1]];
  const frame: BoardNode = { id: 'f', type: 'card', position: { x: 0, y: 0 }, data: { kind: 'frame', title: '新分组', body: '' }, style: { width: 1147, height: 900 } };
  const pictures = ratios.map((natural, index) => picture(`g${index}`, 16 + (index % 4) * 250, 16 + Math.floor(index / 4) * 200, 200, 150, [natural[0] * 100, natural[1] * 100]));
  const next = arrangeFrame(board([frame, ...pictures]), 'f', 'grid');
  const placed = next.nodes.filter(node => node.id.startsWith('g'));
  const singles = placed.filter((_, index) => ratios[index][0] / ratios[index][1] < 2);
  const cell = Math.max(...singles.map(node => node.style!.width!));
  // Cells per row: every row is full (8 singles + 4 wide pictures × 2 = 16 cells = 4 rows of 4).
  const rows = new Map<number, number>();
  for (const node of placed) {
    const centre = Math.round(node.position.y + node.style!.height! / 2);
    const key = [...rows.keys()].find(y => Math.abs(y - centre) < 3) ?? centre;
    const wide = node.style!.width! > cell * 1.5;
    rows.set(key, (rows.get(key) ?? 0) + (wide ? 2 : 1));
  }
  assert.deepEqual([...rows.values()], [4, 4, 4, 4], `cells used per row: ${[...rows.values()].join('/')}`);
  const tray = next.nodes.find(node => node.id === 'f')!;
  for (const node of placed) assert.ok(node.position.x + node.style!.width! <= tray.position.x + tray.style!.width! - TRAY_PADDING, `${node.id} inside`);
});

test('round 4: a new step takes over from an ordinary toast that has been up a second; errors stay; toasts raised together stack', () => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    clearToasts();
    showToast('已摘到画布，系在', { tag: '第 2 段', undo: () => {} });
    showToast('一起出现的另一条');
    assert.equal(getToasts().filter(item => !item.leaving).length, 2, 'raised together: both stay');
    now += TOAST_TAKEOVER_MS;
    showToast('已插入原文，出处系在引文后的序号上');
    assert.deepEqual(getToasts().filter(item => !item.leaving).map(item => item.message), ['已插入原文，出处系在引文后的序号上'], 'the older steps fade out');
    now += TOAST_TAKEOVER_MS;
    showToast('导入失败：链接打不开', { tone: 'error' });
    assert.equal(getToasts().filter(item => !item.leaving).length, 2, 'an error does not push the last step out');
    now += TOAST_TAKEOVER_MS;
    showToast('已保存版本');
    assert.deepEqual(getToasts().filter(item => !item.leaving).map(item => item.message), ['导入失败：链接打不开', '已保存版本'], 'an error never leaves by takeover');
  } finally {
    Date.now = realNow;
    clearToasts();
  }
});

test('desktop PDF bridge: only A4 HTML, served beside the app; the print page loads data: URLs and the app’s own files only', async () => {
  const { validatePdfRequest, pdfRequestAllowed, printDocumentUrl, PDF_HTML_LIMIT } = await import('../native/pdf-render');
  assert.deepEqual(validatePdfRequest('<p>脚本</p>', { pageSize: 'A4', landscape: false }).options, { pageSize: 'A4', landscape: false });
  assert.deepEqual(validatePdfRequest('<p>脚本</p>', undefined).options, { pageSize: 'A4', landscape: true }, 'landscape unless asked otherwise');
  assert.throws(() => validatePdfRequest('<p>x</p>', { pageSize: 'Letter' }), /A4/);
  assert.throws(() => validatePdfRequest('  ', {}), /打印内容/);
  assert.throws(() => validatePdfRequest(42, {}), /打印内容/);
  assert.throws(() => validatePdfRequest('x'.repeat(PDF_HTML_LIMIT + 1), {}), /64 MB/);
  const dev = 'http://127.0.0.1:5190/';
  assert.equal(printDocumentUrl(dev, 'abc'), 'http://127.0.0.1:5190/__field-print/abc.html');
  assert.ok(pdfRequestAllowed('http://127.0.0.1:5190/src/assets/fonts/serif.woff2', dev));
  assert.ok(pdfRequestAllowed('data:image/png;base64,AAAA', dev));
  for (const url of ['https://example.com/a.png', 'http://127.0.0.1:5178/font.woff2', 'http://localhost:5190/font.woff2', 'file:///C:/Windows/win.ini', 'media://asset/1', 'not a url']) assert.equal(pdfRequestAllowed(url, dev), false, url);
  const offline = 'file:///D:/app/dist/index.html';
  assert.equal(printDocumentUrl(offline, 'abc'), 'file:///D:/app/dist/__field-print-abc.html');
  assert.ok(pdfRequestAllowed('file:///D:/app/dist/assets/serif.woff2', offline));
  assert.equal(pdfRequestAllowed('file:///D:/app/secret.txt', offline), false);
  assert.equal(pdfRequestAllowed('file:///D:/app/dist/../secret.txt', offline), false);
  assert.equal(printDocumentUrl('https://example.com/', 'abc'), null, 'no other origin can host a print page');
});
