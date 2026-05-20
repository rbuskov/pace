import { BrowserWindow, type IpcMain, dialog } from 'electron';
import type { IpcResponse } from '@shared/types';

export function register(ipcMain: IpcMain): void {
  ipcMain.handle('dialog:pickFolder', async (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) {
      return null satisfies IpcResponse<'dialog:pickFolder'>;
    }
    return result.filePaths[0] satisfies IpcResponse<'dialog:pickFolder'>;
  });
}
