// 启动阶段 ResizeObserver 原始错误回归：不替换观察器、不过滤错误。
//
// 背景：欢迎页曾在 React Flow 报告节点尺寸的回调里才开始观察更浅的元素，冷启动约 0.5 秒处会出现
// “ResizeObserver loop completed with undelivered notifications.”（写作 · 浅色 · 1366×768 路线被它阻断）。
// 这个错误与时机有关：旧构建约三分之一的冷启动会出现，所以要多次冷启动才可信。开发服务（vite dev）启动更慢、时序不同，
// 抓不到它，必须对生产构建运行：
//   1. npx vite build --outDir output/startup-ro/build --emptyOutDir
//   2. npx vite preview --outDir output/startup-ro/build --host 127.0.0.1 --port 5190
//   3. FIELD_TEST_URL=http://127.0.0.1:5190/ node tests/startup-resize-observer.browser.mjs
// 环境变量：FIELD_STARTUP_RUNS（每个主题的冷启动次数，默认 40）、FIELD_TEST_OUT（报告目录）。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.env.FIELD_TEST_URL || 'http://127.0.0.1:5190/';
const runs = Number(process.env.FIELD_STARTUP_RUNS || 40);
const out = process.env.FIELD_TEST_OUT || 'output/startup-resize-observer';
const configs = [['light', 1366, 768, 1], ['dark', 1366, 768, 1.25]];
await fs.mkdir(out, { recursive: true });

const report = { url, runsPerConfig: runs, status: 'running', configs: [] };
const browser = await chromium.launch({ channel: process.env.FIELD_TEST_CHANNEL || 'msedge', headless: true });
try {
  for (const [theme, width, height, dpr] of configs) {
    const item = { theme, width, height, dpr, runs, failedRuns: 0, events: [] };
    report.configs.push(item);
    for (let run = 1; run <= runs; run++) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
      await context.addInitScript(value => {
        localStorage.setItem('field-appearance-v1', value);
        window.__startupEvents = [];
        window.addEventListener('error', event => window.__startupEvents.push({ at: Math.round(performance.now()), message: String(event.message) }));
        window.addEventListener('unhandledrejection', event => window.__startupEvents.push({ at: Math.round(performance.now()), message: 'rejection: ' + String(event.reason) }));
      }, theme);
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      const events = [...await page.evaluate(() => window.__startupEvents), ...pageErrors.map(message => ({ message }))];
      if (events.length) { item.failedRuns++; item.events.push({ run, events }); }
      await context.close();
    }
  }
  report.status = report.configs.every(item => item.failedRuns === 0) ? 'passed' : 'failed';
} finally {
  await browser.close();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ status: report.status, configs: report.configs.map(item => `${item.theme} ${item.width}x${item.height}: ${item.failedRuns}/${item.runs} failed`) }));
assert.equal(report.status, 'passed', 'Every cold start must finish without a raw window error or unhandled rejection');
