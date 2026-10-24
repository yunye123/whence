import { contextBridge, ipcRenderer } from 'electron';
import type { FieldTranslateAPI, FieldVideoImportsAPI, FieldBoardStorageAPI, FieldFileExportAPI, FieldPdfAPI, FieldXImportsAPI, VideoImportTask } from './contracts';

export function exposeVideoImports(): void {
  const request = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args).catch(error => {
    const message = (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
    throw new Error(message);
  });
  const invoke = (method: string, ...args: unknown[]) => request(`studio:video-import-${method}`, ...args);
  const api: FieldVideoImportsAPI = {
    submit: input => invoke('submit', input),
    submitLocal: input => invoke('local', input),
    list: () => invoke('list'),
    cancel: (id, expectedAttempt) => invoke('cancel', id, expectedAttempt),
    retry: id => invoke('retry', id),
    libraryState: () => invoke('library-state'),
    onTask: callback => {
      const listener = (_event: unknown, task: VideoImportTask) => callback(task);
      ipcRenderer.on('field-video-import:task', listener);
      return () => ipcRenderer.removeListener('field-video-import:task', listener);
    },
  };
  contextBridge.exposeInMainWorld('fieldVideoImports', api);
  const folder = (method: string, ...args: unknown[]) => request(`studio:board-storage-${method}`, ...args);
  const storage: FieldBoardStorageAPI = { chooseDirectory: () => folder('choose'), create: (id, board, media) => folder('create', id, board, media), save: (id, board, media) => folder('save', id, board, media), open: existing => folder('open', existing), recoverPrevious: recoveryId => folder('recover', recoveryId), exportDirectory: (board, media) => folder('export-directory', board, media), readMedia: (id, mediaId) => folder('read', id, mediaId), reveal: id => folder('reveal', id) };
  contextBridge.exposeInMainWorld('fieldBoardStorage', storage);
  contextBridge.exposeInMainWorld('fieldLocalFiles', { readClipboard: () => request('studio:field-paste-files') });
  const fileExport: FieldFileExportAPI = { save: input => request('studio:field-export', input) };
  contextBridge.exposeInMainWorld('fieldFileExport', fileExport);
  const pdf: FieldPdfAPI = { render: (html, options) => request('studio:field-pdf', html, options) };
  contextBridge.exposeInMainWorld('fieldPdf', pdf);
  const xImports: FieldXImportsAPI = { resolve: input => request('studio:x-import-resolve', input), cancel: requestId => request('studio:x-import-cancel', requestId) };
  contextBridge.exposeInMainWorld('fieldXImports', xImports);
  const translate: FieldTranslateAPI = { translate: input => request('studio:translate-english', input) as ReturnType<FieldTranslateAPI['translate']> };
  contextBridge.exposeInMainWorld('fieldTranslate', translate);
}

/**
 * CORE-29: every time the page applies a theme (index.html before the first frame, then src/theme.ts), send the saved
 * choice and the theme shown to the main process, which keeps the window colour and the next cold start in step
 * (native/window-appearance.ts). Nothing is exposed to the page.
 */
export function reportAppearance(): void {
  const send = () => {
    let preference: string | null = null;
    try { preference = localStorage.getItem('field-appearance-v1'); } catch { /* Storage blocked: the system colour applies. */ }
    ipcRenderer.send('field-appearance', preference, document.documentElement?.dataset.theme ?? null);
  };
  const start = () => {
    send();
    new MutationObserver(send).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
