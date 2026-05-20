import type { IpcMain } from 'electron';
import * as claude from './claude.js';
import * as dialog from './dialog.js';
import * as repo from './repo.js';
import * as settings from './settings.js';

export function registerAll(ipcMain: IpcMain): void {
  repo.register(ipcMain);
  settings.register(ipcMain);
  claude.register(ipcMain);
  dialog.register(ipcMain);
}
