import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// 使用指南“关于”里的版本（DLG-23）：package.json 版本、构建日期、短提交号，构建时写进页面。
const today = new Date();
const build = {
  version: (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? '',
  date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
  commit: (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } })(),
};

// CORE-31（第 3 轮）：第三方库按用途分包——React、画布引擎（React Flow 与 d3）跟主包一起加载但单独成文件；
// 写作编辑器（CodeMirror 与 Lezer）只被资料面板引用，随面板分包按需加载。没有一个分包超过 500 kB。
const vendorChunks = [
  { name: 'vendor-react', test: /node_modules[\/](?:react|react-dom|scheduler)[\/]/, priority: 30 },
  { name: 'vendor-flow', test: /node_modules[\/](?:@xyflow|d3-[a-z-]+|classcat|zustand|use-sync-external-store)[\/]/, priority: 20 },
  { name: 'vendor-editor', test: /node_modules[\/](?:@codemirror|@lezer|@marijn|crelt|style-mod|w3c-keyname)[\/]/, priority: 20 },
  // Canvas card rendering is loaded with the canvas, in one bounded file.
  { name: 'canvas-cards', test: /[\\/]src[\\/]cards[\\/]/, priority: 10 },
];

// Preserve scroll-timeline as a separate declaration. The default minifier merges
// it into an animation shorthand that the installed Chromium rejects.
export default defineConfig({ plugins: [react()], base: './', define: { __FIELD_BUILD__: JSON.stringify(build) }, server: { host: '127.0.0.1', port: 5178, strictPort: true, watch: { ignored: ['**/output/**', '**/.native-profile/**', '**/.cache/**'] } }, build: { outDir: 'dist', assetsInlineLimit: (filePath) => /\.(?:woff2?|ttf|otf)$/i.test(filePath) ? false : undefined, cssTarget: 'chrome152', cssMinify: 'esbuild', rolldownOptions: { output: { codeSplitting: { groups: vendorChunks } } } } });
