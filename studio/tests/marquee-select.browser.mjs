// 鼠标拖动框选回归：框选扫到卡片和连线时，界面不能崩溃（Maximum update depth exceeded）。
//
// 背景：框选把一条已保存的连线选中后，selectedEdgeIds 与 React Flow 的 onSelectionChange 互相改写，
// 每一轮都让 flowEdges 变成新数组，StoreUpdater 反复 setEdges，几十毫秒内进入死循环，整个界面换成“界面出了错”。
// 用法：
//   1. npx vite --host 127.0.0.1 --port 5400 --strictPort        （开发服务即可复现，生产构建同样可测）
//   2. FIELD_TEST_URL=http://127.0.0.1:5400/ node tests/marquee-select.browser.mjs
// 默认进入的示例画布（视频：凌晨四点的早餐摊）带 7 张卡片和多条连线，用真实鼠标从四个方向各框选一次。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.FIELD_TEST_URL || 'http://127.0.0.1:5400/';
const browser = await chromium.launch({ channel: process.env.FIELD_TEST_CHANNEL || 'msedge', headless: true });
const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await context.addInitScript(() => localStorage.setItem('field-welcome-v1', 'seen'));
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length >= 3, null, { timeout: 15000 });
  // 先“查看全部”，让所有卡片缩进视口，四周留出可以起拖的空白。
  await page.getByRole('button', { name: '查看全部' }).click();
  await page.waitForTimeout(1200);

  // 卡片外接框 + 一圈余量，四个角依次作为框选起点。
  const box = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('.react-flow__node')].map(node => node.getBoundingClientRect());
    const pane = document.querySelector('.react-flow__pane').getBoundingClientRect();
    return {
      left: Math.min(...rects.map(r => r.left)) - 20, top: Math.min(...rects.map(r => r.top)) - 20,
      right: Math.max(...rects.map(r => r.right)) + 20, bottom: Math.max(...rects.map(r => r.bottom)) + 20,
      pane: { left: pane.left, top: pane.top, right: pane.right, bottom: pane.bottom },
    };
  });
  assert.ok(box.left > box.pane.left && box.top > box.pane.top && box.right < box.pane.right && box.bottom < box.pane.bottom, `卡片没有全部缩进画布：${JSON.stringify(box)}`);
  const expected = await page.evaluate(() => document.querySelectorAll('.react-flow__node').length);
  const corners = [[box.right, box.bottom, box.left, box.top], [box.left, box.top, box.right, box.bottom], [box.right, box.top, box.left, box.bottom], [box.left, box.bottom, box.right, box.top]];
  for (const [sx, sy, ex, ey] of corners) {
    // 点一下空白处清空选择，再框选。
    await page.mouse.click(box.pane.right - 30, box.pane.bottom - 30);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move((sx + ex) / 2, (sy + ey) / 2, { steps: 8 });
    await page.mouse.move(ex, ey, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => ({
      crashed: document.body.innerText.includes('界面出了错'),
      selectedCards: document.querySelectorAll('.react-flow__node.selected').length,
      selectedEdges: document.querySelectorAll('.react-flow__edge.selected').length,
    }));
    results.push({ from: [sx, sy].map(Math.round), to: [ex, ey].map(Math.round), ...state });
    assert.equal(state.crashed, false, `框选 ${[sx, sy, ex, ey].map(Math.round)} 后界面崩溃：${[...pageErrors, ...consoleErrors].join(' | ').slice(0, 400)}`);
    assert.equal(state.selectedCards, expected, '框住全部卡片后应全部选中');
  }
  assert.equal(pageErrors.filter(message => /Maximum update depth/.test(message)).length, 0);
  assert.equal(consoleErrors.filter(message => /Maximum update depth/.test(message)).length, 0);
  await context.close();
} finally {
  await browser.close();
}
console.log(JSON.stringify({ status: 'passed', results }));
