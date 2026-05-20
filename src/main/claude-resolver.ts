import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ClaudeStatus } from '@shared/types';
import type { BrowserWindow } from 'electron';

const execFileAsync = promisify(execFile);

let cached: ClaudeStatus = { ready: false, error: 'Not yet checked' };
let mainWindowRef: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

export function getStatus(): ClaudeStatus {
  return cached;
}

export async function refresh(binaryPathOverride?: string): Promise<ClaudeStatus> {
  const binary = binaryPathOverride?.trim() ? binaryPathOverride : 'claude';
  try {
    const { stdout } = await execFileAsync(binary, ['--version'], { timeout: 10_000 });
    const version = stdout.trim() || 'unknown';
    cached = { ready: true, version };
  } catch (err) {
    cached = {
      ready: false,
      error: (err as Error).message || 'Failed to run claude --version',
    };
  }
  broadcast();
  return cached;
}

function broadcast(): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('claude:status-changed', cached);
  }
}
