import type { IpcRequest, IpcResponse, RepoInfo } from '@shared/types';
import type { IpcMain } from 'electron';
import * as persistence from '../persistence.js';
import { validateAndDescribeRepo } from '../repo-manager.js';

// Cached RepoInfo for the currently selected repo. Re-derived from the path
// on demand if we don't have it (e.g. fresh launch).
let currentRepo: RepoInfo | null = null;

export function register(ipcMain: IpcMain): void {
  ipcMain.handle('repo:select', async (_evt, payload: IpcRequest<'repo:select'>) => {
    const info = await validateAndDescribeRepo(payload.path);
    currentRepo = info;
    persistence.setRepoPath(info.path);
    return info satisfies IpcResponse<'repo:select'>;
  });

  ipcMain.handle('repo:current', async () => {
    if (currentRepo) return currentRepo satisfies IpcResponse<'repo:current'>;
    const stored = persistence.getRepoPath();
    if (!stored) return null;
    try {
      currentRepo = await validateAndDescribeRepo(stored);
      return currentRepo;
    } catch {
      // Stored repo is gone or invalid — clear it so the user gets the empty state.
      persistence.setRepoPath(null);
      return null;
    }
  });
}
