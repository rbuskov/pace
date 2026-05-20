import type { IpcMain } from 'electron';
import type { IpcRequest, IpcResponse } from '@shared/types';
import * as claudeResolver from '../claude-resolver.js';
import * as persistence from '../persistence.js';

export function register(ipcMain: IpcMain): void {
  ipcMain.handle('settings:get', async () => {
    return persistence.getSettings() satisfies IpcResponse<'settings:get'>;
  });

  ipcMain.handle('settings:update', async (_evt, patch: IpcRequest<'settings:update'>) => {
    const before = persistence.getSettings();
    const next = persistence.updateSettings(patch);
    if (
      Object.prototype.hasOwnProperty.call(patch, 'claudeBinaryPath') &&
      (patch.claudeBinaryPath ?? '') !== (before.claudeBinaryPath ?? '')
    ) {
      // Fire-and-forget; status-changed event will inform the renderer.
      void claudeResolver.refresh(next.claudeBinaryPath);
    }
    return next satisfies IpcResponse<'settings:update'>;
  });
}
