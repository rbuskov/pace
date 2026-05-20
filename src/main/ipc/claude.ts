import type { IpcResponse } from '@shared/types';
import type { IpcMain } from 'electron';
import * as claudeResolver from '../claude-resolver.js';

export function register(ipcMain: IpcMain): void {
  ipcMain.handle('claude:status', async () => {
    return claudeResolver.getStatus() satisfies IpcResponse<'claude:status'>;
  });
}
