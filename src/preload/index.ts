import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { EVENTS, INVOKE, type Api, type MetadataStatus, type ProgressView } from '../shared/ipc.js';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: Api = {
  platform: () => ipcRenderer.invoke(INVOKE.platform),
  scan: (paths, filter) => ipcRenderer.invoke(INVOKE.scan, paths, filter),
  buildPlan: (req) => ipcRenderer.invoke(INVOKE.buildPlan, req),
  tokenValues: () => ipcRenderer.invoke(INVOKE.tokenValues),
  execute: (planId) => ipcRenderer.invoke(INVOKE.execute, planId),
  cancel: () => ipcRenderer.invoke(INVOKE.cancel),
  undo: () => ipcRenderer.invoke(INVOKE.undo),
  canUndo: () => ipcRenderer.invoke(INVOKE.canUndo),
  listPresets: () => ipcRenderer.invoke(INVOKE.listPresets),
  savePreset: (name, settings) => ipcRenderer.invoke(INVOKE.savePreset, name, settings),
  deletePreset: (name) => ipcRenderer.invoke(INVOKE.deletePreset, name),
  pickPaths: (kind) => ipcRenderer.invoke(INVOKE.pickPaths, kind),
  pickFolder: () => ipcRenderer.invoke(INVOKE.pickFolder),
  copyText: (text) => ipcRenderer.invoke(INVOKE.copyText, text),
  clear: () => ipcRenderer.invoke(INVOKE.clear),
  saveText: (suggestedName, text) => ipcRenderer.invoke(INVOKE.saveText, suggestedName, text),
  readText: () => ipcRenderer.invoke(INVOKE.readText),
  takeOpenPaths: () => ipcRenderer.invoke(INVOKE.takeOpenPaths),
  fileDetails: (path) => ipcRenderer.invoke(INVOKE.fileDetails, path),
  showInFolder: (path) => ipcRenderer.invoke(INVOKE.showInFolder, path),
  openFile: (path) => ipcRenderer.invoke(INVOKE.openFile, path),
  // Electron removed File.path; this is the supported way to get a dropped file's real path.
  pathForFile: (file) => webUtils.getPathForFile(file),
  onMetadataProgress: (cb) => subscribe<MetadataStatus>(EVENTS.metadataProgress, cb),
  onExecuteProgress: (cb) => subscribe<ProgressView>(EVENTS.executeProgress, cb),
  onOpenPaths: (cb) => subscribe<string[]>(EVENTS.openPaths, cb),
};

contextBridge.exposeInMainWorld('api', api);
