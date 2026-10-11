import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacyRoot = path.dirname(studioRoot);
const originalMain = path.join(legacyRoot, 'electron/main.ts');
const originalPreload = path.join(legacyRoot, 'electron/preload.ts');
const hash = value => createHash('sha256').update(value).digest('hex');

/** Build a separate desktop shell without editing any legacy source or distribution. */
export async function buildNative() {
  const [main, preload] = await Promise.all([fs.readFile(originalMain, 'utf8'), fs.readFile(originalPreload, 'utf8')]);
  let transformed = main;
  const changes = [];
  function replaceOnce(name, from, to) {
    const matches = transformed.split(from).length - 1;
    if (matches !== 1) throw new Error(`旧桌面源码已变化：“${name}”需要匹配 1 次，实际 ${matches} 次。为避免错误修改，已停止构建。`);
    transformed = transformed.replace(from, to); changes.push(name);
  }
  replaceOnce('Enable CORS for the media scheme',
    'standard: true, secure: true, supportFetchAPI: true, stream: true',
    'standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true');
  replaceOnce('Register scoped local canvas media',
    "protocol.registerSchemesAsPrivileged([{ scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);",
    "protocol.registerSchemesAsPrivileged(['media', 'field-media'].map(scheme => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } })));" );
  // CORE-06: FIELD's own copy of the ASR worker (punctuation for Chinese speech). The legacy app keeps
  // ../workers/transcribe.py unchanged.
  replaceOnce('Use FIELD\'s own local ASR worker',
    "process.env.CANVAS_WORKER_DIR = path.join(app.getAppPath(), 'workers');",
    `process.env.CANVAS_WORKER_DIR = ${JSON.stringify(path.join(studioRoot, 'native', 'workers'))};`);
  // CORE-29: the window colour before the page paints follows the saved appearance (or the system), not a fixed dark.
  replaceOnce('Open the window in the saved appearance colour',
    "backgroundColor: '#181c20',",
    "backgroundColor: windowGround(savedAppearance(app.getPath('userData')), fieldNativeTheme.shouldUseDarkColors),");
  replaceOnce('Keep the window colour in step with the page theme',
    'window.setMenuBarVisibility(false);',
    "window.setMenuBarVisibility(false);\n    followAppearance(window, { ipcMain, nativeTheme: fieldNativeTheme, directory: app.getPath('userData') });");
  replaceOnce('Use the FIELD frontend as the offline fallback',
    "await window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));",
    `await window.loadFile(path.join(${JSON.stringify(studioRoot)}, 'dist', 'index.html'));`);
  // 2026-10-07: renamed from 原野 to 来处. The window and its taskbar button carry the app icon (desktop-assets/field.ico,
  // file name kept so the desktop shortcut that points at it still works); without it Windows shows electron.exe's own icon.
  replaceOnce('Name the new desktop window', "title: '云野参考画布'",
    `title: '来处', icon: ${JSON.stringify(path.join(studioRoot, 'desktop-assets', 'field.ico'))}`);
  // FD-03: a hidden test window (CANVAS_HEADLESS) otherwise runs requestAnimationFrame about twice a second, so the
  // regression scripts capture panels half-way through their transitions. The visible app keeps the default.
  replaceOnce('Paint hidden test windows at full rate',
    'contextIsolation: true, nodeIntegration: false, sandbox: true } });',
    'contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !process.env.CANVAS_HEADLESS } });');
  replaceOnce('Load the independent video import service',
    "import { app, BrowserWindow, dialog, ipcMain, protocol, shell, clipboard } from 'electron';",
    `import { app, BrowserWindow, dialog, ipcMain, protocol, shell, clipboard } from 'electron';\nimport { VideoImportService } from ${JSON.stringify(path.join(studioRoot, 'native/video-import-service.ts'))};\nimport { resolvePublicPageVideo } from ${JSON.stringify(path.join(studioRoot, 'native/browser-resolver.ts'))};\nimport { BoardStorage } from ${JSON.stringify(path.join(studioRoot, 'native/board-storage.ts'))};\nimport { folderMediaResponse } from ${JSON.stringify(path.join(studioRoot, 'native/folder-media.ts'))};\nimport { nativeTheme as fieldNativeTheme } from 'electron';\nimport { followAppearance, savedAppearance, windowGround } from ${JSON.stringify(path.join(studioRoot, 'native/window-appearance.ts'))};`);
  replaceOnce('Load the restricted verified file exporter',
    'let closing = false;',
    `import { validateFileExportInput, writeSelectedExport, fileExportError } from ${JSON.stringify(path.join(studioRoot, 'native/file-export.ts'))};\nimport { renderHtmlToPdf } from ${JSON.stringify(path.join(studioRoot, 'native/pdf-render.ts'))};\nimport { net as fieldNet, session as fieldSession } from 'electron';\nlet closing = false;`);
  replaceOnce('Keep a separate, stable video material library',
    'let closing = false;', `import { XImportService } from ${JSON.stringify(path.join(studioRoot, 'native/x-import.ts'))};\nlet closing = false;\nlet videoImports: VideoImportService | undefined;\nlet boardStorage: BoardStorage;\nlet xImports: XImportService;`);
  replaceOnce('Open the app-managed library without a folder picker',
    "    protocol.handle('media', mediaResponse);",
    `    xImports = new XImportService();
    videoImports = await VideoImportService.open({ directory: path.join(app.getPath('userData'), 'video-library'), resolvePublicVideo: resolvePublicPageVideo, onTask: task => {
      if (window && !window.isDestroyed()) window.webContents.send('field-video-import:task', task);
    } });
    boardStorage = new BoardStorage(path.join(app.getPath('userData'), 'canvas-directories.json'), async node => {
      const target = videoImports?.projectForMedia(String(node.data.nativeProjectId)) ?? (store?.state.id === node.data.nativeProjectId ? store : undefined);
      const asset = target?.state.assets.find(item => item.id === node.data.nativeAssetId); if (!target || !asset) return undefined;
      const root = await fs.realpath(target.state.directory); const file = await fs.realpath(path.join(root, asset.proxy || asset.path));
      if (!file.toLowerCase().startsWith((root + path.sep).toLowerCase())) throw new Error('素材不在原项目中。');
      const mimes = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/x-m4v', '.ogv': 'video/ogg', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };
      return { path: file, name: asset.name, mime: mimes[path.extname(file).toLowerCase()] || (asset.kind === 'video' ? 'video/mp4' : 'image/png') };
    });
    await boardStorage.initialize();
    protocol.handle('field-media', request => folderMediaResponse(boardStorage, request));
    protocol.handle('media', mediaResponse);`);
  replaceOnce('Route managed media independently of the legacy current project',
    'const url = new URL(request.url); const target = current();',
    'const url = new URL(request.url); const target = videoImports?.projectForMedia(url.hostname) ?? current();');
  replaceOnce('Expose scoped import queue IPC through the existing sender checks',
    "  handle('state', () => store?.state ?? null);",
    `  handle('state', () => store?.state ?? null);
  handle('video-import-submit', input => videoImports!.submit(input));
  handle('video-import-local', input => videoImports!.submitLocal(input));
  handle('video-import-list', () => videoImports!.list());
  handle('video-import-cancel', (id, expectedAttempt) => videoImports!.cancel(id, expectedAttempt));
  handle('video-import-retry', id => videoImports!.retry(id));
  handle('video-import-library-state', () => videoImports!.libraryState);
  handle('x-import-resolve', input => xImports.resolve(input));
  handle('x-import-cancel', requestId => xImports.cancel(requestId));
  handle('field-paste-files', async () => { const { readClipboardFiles } = await import(${JSON.stringify(path.join(studioRoot, 'native/clipboard-files.ts'))}); return readClipboardFiles(clipboard); });
  handle('board-storage-choose', async () => { const selected = await selectDirectory('选择画布保存位置'); return selected ? boardStorage.choose(selected) : null; });
  handle('board-storage-create', (id, board, media) => boardStorage.create(id, board, media));
  handle('board-storage-save', (id, board, media) => boardStorage.save(id, board, media));
  handle('board-storage-open', async existing => { const selected = await selectDirectory('打开包含 canvas.field.json 的画布文件夹'); return selected ? boardStorage.open(selected, existing) : null; });
  handle('board-storage-recover', async recoveryId => { const selected = await selectDirectory('选择恢复副本的保存位置'); if (!selected) return null; const choice = await boardStorage.choose(selected); return boardStorage.recoverPrevious(recoveryId, choice.id); });
  handle('board-storage-export-directory', async (board, media) => { const selected = await selectDirectory('选择完整画布副本的保存位置'); if (!selected) return { status: 'cancelled' }; const choice = await boardStorage.choose(selected); return boardStorage.exportDirectory(board, media, choice.id); });
  handle('field-export', async input => {
    try {
      const checked = validateFileExportInput(input);
      const extension = checked.format === 'field-json' ? 'json' : checked.format === 'markdown' ? 'md' : checked.format;
      const selected = await dialog.showSaveDialog(window!, { title: '导出作品', defaultPath: checked.suggestedName, filters: [{ name: checked.format === 'field-json' ? '来处便携画布文件' : extension.toUpperCase(), extensions: [extension] }] });
      if (selected.canceled || !selected.filePath) return { status: 'cancelled' };
      return await writeSelectedExport(selected.filePath, checked);
    } catch (error) { throw fileExportError(error); }
  });
  // Script PDF (round 4): a hidden, script-less window in a private session prints the page (native/pdf-render.ts);
  // the bytes come back to the page, which saves them through field-export.
  handle('field-pdf', (html, options) => renderHtmlToPdf({ BrowserWindow, fromPartition: (partition, settings) => fieldSession.fromPartition(partition, settings), fetch: (request, init) => fieldNet.fetch(request, init) }, html, options, window!.webContents.getURL()));
  handle('board-storage-read', (id, mediaId) => boardStorage.readMedia(id, mediaId));
  handle('board-storage-reveal', async id => { const directory = await boardStorage.directory(id); const error = await shell.openPath(directory); if (error) throw new Error(error); });`);
  replaceOnce('Prevent the legacy editor from opening the live managed library twice',
    'return useStore(ProjectStore.open(selected));',
    "if (videoImports?.ownsDirectory(selected)) throw new Error('这是来处自动管理的素材库，请在画布里访问其中的视频。'); return useStore(ProjectStore.open(selected));");
  replaceOnce('Include managed imports in the native close confirmation',
    'if (queueRunning || queue.length) { const result = await dialog.showMessageBox',
    'if (queueRunning || queue.length || videoImports?.hasActiveTasks) { const result = await dialog.showMessageBox');
  // 2026-10-07: the close-time message boxes carry the product name as their title; without one Windows shows the
  // process name (app.getName() is still "Electron", kept so the default data directory never follows a rename).
  replaceOnce('Title the busy-export message box', "dialog.showMessageBox(window, { type: 'info', message: '正在切换或打包项目",
    "dialog.showMessageBox(window, { title: '来处', type: 'info', message: '正在切换或打包项目");
  replaceOnce('Title the background-task message box', "dialog.showMessageBox(window, { type: 'question', buttons: ['继续等待', '保存并退出']",
    "dialog.showMessageBox(window, { title: '来处', type: 'question', buttons: ['继续等待', '保存并退出']");
  replaceOnce('Title the save-failed message box', "dialog.showMessageBox(window, { type: 'error', message: '尚未保存成功",
    "dialog.showMessageBox(window, { title: '来处', type: 'error', message: '尚未保存成功");
  replaceOnce('Explain how paused video imports resume in the new UI',
    '还有后台任务，退出后可从任务列表重试。',
    '还有后台任务。退出会暂停后台处理；重新打开后可在视频卡片上继续。');
  replaceOnce('Persist and stop import work before closing the desktop',
    'queue.length = 0; closing = true; window.destroy();',
    'queue.length = 0; xImports?.close(); await videoImports?.close(); closing = true; window.destroy();');
  replaceOnce('Close the managed library when test or OS window destruction skips close',
    "app.on('window-all-closed', () => app.quit());",
    "app.on('window-all-closed', () => { xImports?.close(); void (videoImports?.close() ?? Promise.resolve()).finally(() => app.quit()); });");
  replaceOnce('Reject cross-origin native media access',
    'async function mediaResponse(request: Request): Promise<Response> {\n  try {',
    `async function mediaResponse(request: Request): Promise<Response> {
  try {
    // Only this launcher's loopback frontend can read native media into IndexedDB.
    // Native <video>/<img> requests may omit Origin and continue to work normally.
    let allowedOrigin = '';
    try {
      const configured = new URL(process.env.CANVAS_DEV_URL || '');
      if (configured.protocol === 'http:' && configured.hostname === '127.0.0.1' && configured.port && !configured.username && !configured.password) allowedOrigin = configured.origin;
    } catch { /* The packaged file:// fallback has no cross-origin read grant. */ }
    const origin = request.headers.get('Origin');
    if (origin && origin !== allowedOrigin) return new Response('Forbidden origin', { status: 403 });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return new Response('Method not allowed', { status: 405 });`);
  replaceOnce('Add an exact-origin CORS grant to media responses',
    "    let start = 0; let end = stat.size - 1; let status = 200;",
    `    if (allowedOrigin && origin === allowedOrigin) {
      headers.set('Access-Control-Allow-Origin', allowedOrigin);
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Range');
      headers.set('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    let start = 0; let end = stat.size - 1; let status = 200;`);
  const out = path.join(studioRoot, 'dist-native');
  await fs.mkdir(out, { recursive: true });
  const common = { absWorkingDir: legacyRoot, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] };
  await build({ ...common, entryPoints: [originalMain], outfile: path.join(out, 'main.cjs'), sourcemap: true,
    plugins: [{ name: 'field-isolated-native-adapter', setup(builder) {
      builder.onLoad({ filter: /[\\/]electron[\\/]main\.ts$/ }, async ({ path: entry }) => {
        if (path.resolve(entry) !== originalMain) return undefined;
        return { contents: transformed, loader: 'ts', resolveDir: path.dirname(originalMain) };
      });
    } }],
  });
  const transformedPreload = `${preload}\nimport { exposeVideoImports, reportAppearance } from ${JSON.stringify(path.join(studioRoot, 'native/preload-bridge.ts'))};\nexposeVideoImports();\nreportAppearance();\n`;
  await build({ ...common, entryPoints: [originalPreload], outfile: path.join(out, 'preload.cjs'),
    plugins: [{ name: 'field-video-import-preload', setup(builder) {
      builder.onLoad({ filter: /[\\/]electron[\\/]preload\.ts$/ }, async ({ path: entry }) => {
        if (path.resolve(entry) !== originalPreload) return undefined;
        return { contents: transformedPreload, loader: 'ts', resolveDir: path.dirname(originalPreload) };
      });
    } }],
  });
  const current = await Promise.all([fs.readFile(originalMain, 'utf8'), fs.readFile(originalPreload, 'utf8')]);
  if (current[0] !== main || current[1] !== preload) throw new Error('构建期间旧桌面源码发生了并发变化，请重新构建后再启动。');
  const worker = await fs.readFile(path.join(studioRoot, 'native', 'workers', 'transcribe.py'), 'utf8').catch(() => {
    throw new Error('缺少来处自己的转写程序 native/workers/transcribe.py，已停止构建。');
  });
  await fs.writeFile(path.join(out, 'build-info.json'), JSON.stringify({
    builtAt: new Date().toISOString(), legacyRoot, changes,
    sources: { 'electron/main.ts': hash(main), 'electron/preload.ts': hash(preload) },
    worker: { 'native/workers/transcribe.py': hash(worker) },
    originalsUnchanged: true,
  }, null, 2));
  return path.join(out, 'main.cjs');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildNative().then(entry => console.log(`来处独立桌面已构建：${entry}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
