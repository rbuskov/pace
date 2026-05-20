import type { IpcChannel, IpcEventChannel } from '@shared/types';
import { contextBridge, ipcRenderer } from 'electron';

const home = process.env.HOME || process.env.USERPROFILE || null;

const api = {
  home,
  platform: process.platform,
  invoke: (channel: IpcChannel, payload?: unknown) => ipcRenderer.invoke(channel, payload),
  on: (channel: IpcEventChannel, listener: (payload: unknown) => void) => {
    const wrapped = (_: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('pace', api);

export type PaceApi = typeof api;
