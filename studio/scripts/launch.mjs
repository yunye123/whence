import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacyRoot = path.dirname(studioRoot);
const args = process.argv.slice(2);
function argument(name, fallback) {
  const index = args.indexOf(name);
  return args.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? (index >= 0 ? args[index + 1] : fallback);
}
const port = Number(argument('--port', '5178'));
const browserOnly = args.includes('--browser');
const userData = path.resolve(argument('--user-data', path.join(studioRoot, '.native-profile')));
// A packaged MVP serves the already-built frontend and desktop shell. The default
// daily/development entry keeps its existing build and data-directory behavior.
const productionRootArg = argument('--production-root', '');
const productionRoot = productionRootArg ? path.resolve(productionRootArg) : null;
const nativeEntryArg = argument('--native-entry', '');
const url = `http://127.0.0.1:${port}/`;
let server; let desktop; let shutdownPromise;

function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    // Vite, HMR sockets or the native build service can retain Node handles after
    // Electron exits. Never leave an invisible helper occupying the user's port.
    const deadline = setTimeout(() => {
      console.error('桌面已关闭，正在强制结束仍有后台句柄的启动器。');
      process.exit(code);
    }, 3_000);
    if (desktop && desktop.exitCode === null && desktop.signalCode === null) desktop.kill();
    try {
      server?.ws?.close();
      server?.httpServer?.closeIdleConnections?.();
      server?.httpServer?.closeAllConnections?.();
      if (server?.close) await server.close();
      else if (server?.httpServer?.listening) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
    } catch (error) {
      console.error(`前端关闭时遇到问题：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(deadline);
      // Setting exitCode alone is insufficient when a tool service retains handles.
      process.exit(code);
    }
  })();
  return shutdownPromise;
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

async function assertPortAvailable() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', error => reject(new Error(`端口 ${port} 无法使用（${error.code || error.message}）。请先关闭占用该端口的程序，或使用 --port 5188。来处不会连接未知服务。`)));
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(resolve));
  });
}

try {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port 必须是 1024 至 65535 的整数。');
  // FD-01: every runtime package must resolve from this folder before a window opens.
  const { missingPackages, missingPackagesMessage } = await import('./dependency-check.mjs');
  const missing = missingPackages(studioRoot);
  if (missing.length) throw new Error(missingPackagesMessage(studioRoot, missing));
  if (productionRoot) await fs.access(path.join(productionRoot, 'index.html'));
  if (nativeEntryArg) await fs.access(path.resolve(nativeEntryArg));
  await assertPortAvailable();
  const vitePath = path.join(legacyRoot, 'node_modules/vite/dist/node/index.js');
  await fs.access(vitePath).catch(() => { throw new Error('缺少现有 Vite 依赖。请确认项目根目录 node_modules 完整；启动器不会自动安装。'); });
  const { createServer, preview } = await import(pathToFileURL(vitePath).href);
  const token = randomUUID();
  const installHealth = vite => {
    let agentPort = 0;
    vite.middlewares.use('/__field_launcher__/health', (_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({ product: 'field-studio-next', token, pid: process.pid, mode: productionRoot ? 'production' : 'development', frontend: productionRoot ?? studioRoot }));
    });
    vite.middlewares.use('/__field_launcher__/agent-port', (request, response) => {
      if (request.method !== 'POST' || request.headers['x-field-launch-token'] !== token) { response.statusCode = 404; response.end(); return; }
      const chunks = [];
      let size = 0;
      request.on('data', chunk => {
        size += chunk.length;
        if (size > 200) { response.statusCode = 400; response.end(); request.destroy(); return; }
        chunks.push(chunk);
      });
      request.on('end', () => {
        try {
          const next = Number(JSON.parse(Buffer.concat(chunks).toString('utf8')).port);
          if (!Number.isInteger(next) || next < 1024 || next > 65535) throw new Error('port');
          agentPort = next;
          response.statusCode = 204;
          response.end();
        } catch { response.statusCode = 400; response.end(); }
      });
    });
    vite.middlewares.use('/agent/boards', (request, response) => {
      if (request.method !== 'GET' && request.method !== 'PUT') { response.statusCode = 405; response.setHeader('Allow', 'GET, PUT'); response.end('只接受读取和写入。'); return; }
      if (!agentPort) { response.statusCode = 503; response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.end('来处窗口还没准备好。请先打开来处，再读取这个链接。'); return; }
      const headers = { host: `127.0.0.1:${agentPort}` };
      if (request.headers['content-type']) headers['content-type'] = request.headers['content-type'];
      if (request.headers['content-length']) headers['content-length'] = request.headers['content-length'];
      const proxy = http.request({ hostname: '127.0.0.1', port: agentPort, method: request.method, path: request.originalUrl && request.originalUrl.startsWith('/agent/boards') ? request.originalUrl : `/agent/boards${request.url && request.url.startsWith('/') ? request.url : `/${request.url || ''}`}`, headers }, upstream => {
        response.writeHead(upstream.statusCode || 502, upstream.headers);
        upstream.pipe(response);
      });
      proxy.on('error', () => {
        if (response.headersSent) { response.end(); return; }
        response.statusCode = 503;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end('来处窗口还没准备好。请先打开来处，再读取这个链接。');
      });
      request.pipe(proxy);
    });
  };
  if (productionRoot) {
    server = await preview({ root: studioRoot, configFile: false,
      build: { outDir: productionRoot },
      preview: { host: '127.0.0.1', port, strictPort: true, cors: false },
      plugins: [{ name: 'field-launch-health', configurePreviewServer: installHealth }],
    });
  } else {
  server = await createServer({
    root: studioRoot, configFile: path.join(studioRoot, 'vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true, ...(args.includes('--no-watch') ? { watch: null, hmr: false } : {}) },
    plugins: [{ name: 'field-launch-health', configureServer: installHealth }],
  });
  await server.listen();
  }
  const health = await fetch(`${url}__field_launcher__/health`).then(response => response.json());
  if (health.token !== token || health.product !== 'field-studio-next') throw new Error('前端服务身份校验失败，已停止启动。');
  console.log(`来处已启动：${url}`);
  if (browserOnly) {
    console.log('浏览器模式；按 Ctrl+C 关闭。原生转写请使用默认桌面启动。');
  } else {
    const { buildNative } = await import('./build-native.mjs');
    const nativeEntry = nativeEntryArg ? path.resolve(nativeEntryArg) : await buildNative();
    const executable = createRequire(import.meta.url)('electron');
    await fs.access(executable).catch(() => { throw new Error('现有 Electron 运行时缺失，请恢复项目 node_modules/electron。'); });
    await fs.mkdir(userData, { recursive: true });
    const env = { ...process.env, CANVAS_DEV_URL: url, CANVAS_USER_DATA: userData, CANVAS_LAUNCH_TOKEN: token };
    delete env.ELECTRON_RUN_AS_NODE;
    if (args.includes('--headless')) env.CANVAS_HEADLESS = '1'; else delete env.CANVAS_HEADLESS;
    // The helper stays hidden; the requested desktop app must have a visible window.
    desktop = spawn(executable, [nativeEntry], { cwd: legacyRoot, env, shell: false, windowsHide: args.includes('--headless'), stdio: 'inherit' });
    desktop.once('error', error => { console.error(`桌面启动失败：${error.message}`); void shutdown(1); });
    desktop.once('exit', code => { console.log(`来处桌面已关闭${code ? `（退出码 ${code}）` : ''}。`); void shutdown(code ?? 0); });
    console.log(`桌面进程：${desktop.pid}`);
    console.log(`桌面资料独立保存于：${userData}`);
  }
} catch (error) {
  console.error(`来处启动失败：${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
}
