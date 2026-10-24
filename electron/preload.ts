import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { StudioAPI, ProjectState } from '../shared/types';
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(`studio:${channel}`, ...args);
const api: StudioAPI = {
  getState: () => invoke('state'),
  createProject: (name, directory) => invoke('create', name, directory),
  openProject: directory => invoke('open', directory),
  renameProject: name => invoke('rename', name),
  saveContent: (content, baseRevision) => invoke('save', content, baseRevision),
  importFiles: (paths, sourceId) => invoke('import', paths, sourceId),
  importLink: text => invoke('link', text),
  importClipboard: () => invoke('clipboard'),
  transcribe: (id, cpu) => invoke('transcribe', id, cpu),
  cancelJob: id => invoke('cancel', id),
  retryJob: id => invoke('retry', id),
  screenshot: (id, time) => invoke('screenshot', id, time),
  exportDocument: (kind, id, destination) => invoke('export-document', kind, id, destination),
  exportProject: destination => invoke('export-project', destination),
  restoreProject: (archive, destination) => invoke('restore', archive, destination),
  diagnostics: () => invoke('diagnostics'),
  mediaUrl: (id, relative) => `media://${encodeURIComponent(id)}/${relative.split(/[\\/]/).map(encodeURIComponent).join('/')}`,
  filePath: file => webUtils.getPathForFile(file),
  openExternal: url => invoke('external', url),
  onState: callback => { const listener = (_event: unknown, state: ProjectState) => callback(state); ipcRenderer.on('studio:state', listener); return () => ipcRenderer.removeListener('studio:state', listener); },
  onFlush: callback => {
    const listener = async (_event: unknown, requestId: string) => {
      try { await callback(); ipcRenderer.send('studio:flushed', requestId, null); }
      catch (error) { ipcRenderer.send('studio:flushed', requestId, String(error)); }
    };
    ipcRenderer.on('studio:flush', listener);
    return () => ipcRenderer.removeListener('studio:flush', listener);
  }
};
contextBridge.exposeInMainWorld('studio', api);
import { exposeVideoImports, reportAppearance } from '../studio/native/preload-bridge';
exposeVideoImports();
reportAppearance();
