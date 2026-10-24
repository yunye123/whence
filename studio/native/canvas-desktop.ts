import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, clipboard, dialog, net, session, shell } from 'electron';
import type { ProjectStore } from '../../electron/store';
import type { BoardNode } from '../src/model';
import { BoardStorage } from './board-storage';
import { resolvePublicPageVideo } from './browser-resolver';
import { readClipboardFiles } from './clipboard-files';
import { fileExportError, validateFileExportInput, writeSelectedExport } from './file-export';
import { folderMediaResponse } from './folder-media';
import { renderHtmlToPdf } from './pdf-render';
import { VideoImportService } from './video-import-service';
import { XImportService } from './x-import';
import { translateEnglish, translationSettingsFromEnv } from '../src/english-translation';
import { extractWebArticle } from '../src/web-article';
import { fetchWebPage } from './web-page';

/**
 * Lifecycle and IPC for the canvas desktop services: video library, X import,
 * canvas directories, verified export, PDF, and English-to-Chinese translation.
 * electron/main.ts calls open, register, and close. Channel names stay studio:*
 * and field-video-import:task. Translation itself lives in english-translation.ts.
 */
const TASK_CHANNEL = 'field-video-import:task';
const MATERIAL_MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/x-m4v', '.ogv': 'video/ogg',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
};
type IpcHandle = (name: string, handler: (...args: any[]) => unknown) => void;

let videoImports: VideoImportService | undefined;
let boardStorage: BoardStorage | undefined;
let xImports: XImportService | undefined;
let legacyProject: () => ProjectStore | null = () => null;
let currentWindow: () => BrowserWindow | undefined = () => undefined;

export interface CanvasDesktopOptions {
  userData: string;
  legacyProject(): ProjectStore | null;
  /** Assigned by main after open returns; task events wait until it exists. */
  window(): BrowserWindow | undefined;
}

function services(): { video: VideoImportService; boards: BoardStorage; x: XImportService } {
  if (!videoImports || !boardStorage || !xImports) throw new Error('画布桌面服务尚未打开。');
  return { video: videoImports, boards: boardStorage, x: xImports };
}

function desktopWindow(): BrowserWindow {
  const current = currentWindow();
  if (!current) throw new Error('窗口尚未打开。');
  return current;
}

async function materialFromProject(node: BoardNode): Promise<{ path: string; name: string; mime: string } | undefined> {
  const managed = videoImports?.projectForMedia(String(node.data.nativeProjectId));
  const legacy = legacyProject();
  const target = managed ?? (legacy?.state.id === node.data.nativeProjectId ? legacy : undefined);
  const asset = target?.state.assets.find(item => item.id === node.data.nativeAssetId);
  if (!target || !asset) return undefined;
  const root = await fs.realpath(target.state.directory);
  const file = await fs.realpath(path.join(root, asset.proxy || asset.path));
  if (!file.toLowerCase().startsWith((root + path.sep).toLowerCase())) throw new Error('素材不在原项目中。');
  const extension = path.extname(file).toLowerCase();
  return { path: file, name: asset.name, mime: MATERIAL_MIME[extension] || (asset.kind === 'video' ? 'video/mp4' : 'image/png') };
}

export async function open(options: CanvasDesktopOptions): Promise<void> {
  legacyProject = options.legacyProject;
  currentWindow = options.window;
  xImports = new XImportService();
  try {
    videoImports = await VideoImportService.open({
      directory: path.join(options.userData, 'video-library'),
      resolvePublicVideo: resolvePublicPageVideo,
      onTask(task) {
        const desktop = currentWindow();
        if (desktop && !desktop.isDestroyed()) desktop.webContents.send(TASK_CHANNEL, task);
      },
    });
    const storage = new BoardStorage(path.join(options.userData, 'canvas-directories.json'), materialFromProject);
    await storage.initialize();
    boardStorage = storage;
  } catch (error) {
    await close().catch(() => {});
    videoImports = undefined;
    boardStorage = undefined;
    xImports = undefined;
    throw error;
  }
}

/** The managed video library owns this media hostname, when it does. */
export function projectForMedia(projectId: string): ProjectStore | undefined {
  return videoImports?.projectForMedia(projectId);
}

export function fieldMedia(request: Request): Promise<Response> {
  if (!boardStorage) throw new Error('画布目录尚未打开。');
  return folderMediaResponse(boardStorage, request);
}

export function hasActiveImports(): boolean {
  return videoImports?.hasActiveTasks ?? false;
}

export function rejectManagedLibrary(directory: string): void {
  if (videoImports?.ownsDirectory(directory)) throw new Error('这是来处自动管理的素材库，请在画布里访问其中的视频。');
}

export function register(handle: IpcHandle, selectDirectory: (title: string) => Promise<string | undefined>): void {
  const { video, boards, x } = services();
  handle('translate-english', input => translateEnglish(input, translationSettingsFromEnv(process.env)));
  handle('fetch-web-page', async (input: unknown) => {
    if (typeof input !== 'string' || !input.trim()) return null;
    const page = await fetchWebPage(input);
    return page ? extractWebArticle(page.html, page.url) : null;
  });
  handle('video-import-submit', input => video.submit(input));
  handle('video-import-local', input => video.submitLocal(input));
  handle('video-import-list', () => video.list());
  handle('video-import-cancel', (id, expectedAttempt) => video.cancel(id, expectedAttempt));
  handle('video-import-retry', id => video.retry(id));
  handle('video-import-library-state', () => video.libraryState);
  handle('x-import-resolve', input => x.resolve(input));
  handle('x-import-cancel', requestId => x.cancel(requestId));
  handle('field-paste-files', () => readClipboardFiles(clipboard as Parameters<typeof readClipboardFiles>[0]));
  handle('board-storage-choose', async () => {
    const selected = await selectDirectory('选择画布保存位置');
    return selected ? boards.choose(selected) : null;
  });
  handle('board-storage-create', (id, board, media) => boards.create(id, board, media));
  handle('board-storage-save', (id, board, media) => boards.save(id, board, media));
  handle('board-storage-open', async existing => {
    const selected = await selectDirectory('打开包含 canvas.field.json 的画布文件夹');
    return selected ? boards.open(selected, existing) : null;
  });
  handle('board-storage-recover', async recoveryId => {
    const selected = await selectDirectory('选择恢复副本的保存位置');
    if (!selected) return null;
    const choice = await boards.choose(selected);
    return boards.recoverPrevious(recoveryId, choice.id);
  });
  handle('board-storage-export-directory', async (board, media) => {
    const selected = await selectDirectory('选择完整画布副本的保存位置');
    if (!selected) return { status: 'cancelled' };
    const choice = await boards.choose(selected);
    return boards.exportDirectory(board, media, choice.id);
  });
  handle('field-export', async input => {
    try {
      const checked = validateFileExportInput(input);
      const extension = checked.format === 'field-json' ? 'json' : checked.format === 'markdown' ? 'md' : checked.format;
      const selected = await dialog.showSaveDialog(desktopWindow(), {
        title: '导出作品',
        defaultPath: checked.suggestedName,
        filters: [{ name: checked.format === 'field-json' ? '来处便携画布文件' : extension.toUpperCase(), extensions: [extension] }],
      });
      if (selected.canceled || !selected.filePath) return { status: 'cancelled' };
      return await writeSelectedExport(selected.filePath, checked);
    } catch (error) { throw fileExportError(error); }
  });
  handle('field-pdf', (html, options) => renderHtmlToPdf({
    BrowserWindow,
    fromPartition: (partition, settings) => session.fromPartition(partition, settings),
    fetch: (request, init) => net.fetch(request, init),
  }, html, options, desktopWindow().webContents.getURL()));
  handle('board-storage-read', (id, mediaId) => boards.readMedia(id, mediaId));
  handle('board-storage-reveal', async id => {
    const directory = await boards.directory(id);
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });
}

export function close(): Promise<void> {
  xImports?.close();
  return videoImports?.close() ?? Promise.resolve();
}
