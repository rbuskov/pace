import type { IpcRequest, IpcResponse } from '@shared/types';
import type { IpcMain } from 'electron';
import * as sessionManager from '../session-manager.js';
import { WorktreeError } from '../worktree-manager.js';
import { getCurrentRepoPath } from './repo.js';

export function register(ipcMain: IpcMain): void {
  ipcMain.handle('session:create', async (_evt, payload: IpcRequest<'session:create'>) => {
    const repoPath = getCurrentRepoPath();
    if (!repoPath) {
      throw new Error('No repository selected.');
    }
    try {
      const session = await sessionManager.createSession({
        repoPath,
        name: payload.name,
        baseBranch: payload.baseBranch,
        initialPrompt: payload.initialPrompt,
        cols: payload.cols,
        rows: payload.rows,
      });
      return session satisfies IpcResponse<'session:create'>;
    } catch (err) {
      // Re-throw with a user-readable message; the renderer surfaces it.
      if (err instanceof WorktreeError) {
        throw new Error(err.message);
      }
      throw err;
    }
  });

  ipcMain.handle('session:list', async () => {
    return sessionManager.listSessions() satisfies IpcResponse<'session:list'>;
  });

  ipcMain.handle('session:sendInput', async (_evt, payload: IpcRequest<'session:sendInput'>) => {
    sessionManager.sendInput(payload.id, payload.text);
    return undefined satisfies IpcResponse<'session:sendInput'>;
  });

  ipcMain.handle('session:resize', async (_evt, payload: IpcRequest<'session:resize'>) => {
    sessionManager.resize(payload.id, payload.cols, payload.rows);
    return undefined satisfies IpcResponse<'session:resize'>;
  });

  ipcMain.handle(
    'session:replayBuffer',
    async (_evt, payload: IpcRequest<'session:replayBuffer'>) => {
      return sessionManager.getReplayBuffer(
        payload.id,
      ) satisfies IpcResponse<'session:replayBuffer'>;
    },
  );

  ipcMain.handle('session:close', async (_evt, payload: IpcRequest<'session:close'>) => {
    await sessionManager.closeSession(payload.id);
    return undefined satisfies IpcResponse<'session:close'>;
  });

  ipcMain.handle('session:closeAll', async () => {
    await sessionManager.closeAll();
    return undefined satisfies IpcResponse<'session:closeAll'>;
  });
}
