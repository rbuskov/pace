import { randomUUID } from 'node:crypto';
import { type IPty, spawn as ptySpawn } from '@homebridge/node-pty-prebuilt-multiarch';
import type { Session } from '@shared/types';
import type { BrowserWindow } from 'electron';
import * as claudeResolver from './claude-resolver.js';
import * as persistence from './persistence.js';
import * as worktreeManager from './worktree-manager.js';

const ROLLING_BUFFER_BYTES = 256 * 1024;
const PROMPT_WRITE_DELAY_MS = 250;
const KILL_FALLBACK_MS = 2000;

interface SessionEntry {
  session: Session;
  pty: IPty | null;
  buffer: string;
}

const sessions = new Map<string, SessionEntry>();
let mainWindowRef: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

export function listSessions(): Session[] {
  return Array.from(sessions.values()).map((e) => ({ ...e.session }));
}

export function getReplayBuffer(id: string): string {
  return sessions.get(id)?.buffer ?? '';
}

export class SessionCreateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionCreateError';
  }
}

export interface CreateSessionOptions {
  repoPath: string;
  name: string;
  baseBranch: string;
  initialPrompt?: string;
  cols: number;
  rows: number;
}

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;

export async function createSession(opts: CreateSessionOptions): Promise<Session> {
  const { repoPath, name, baseBranch, initialPrompt, cols, rows } = opts;

  if (!name || name.length > 64 || !SLUG_RE.test(name)) {
    throw new SessionCreateError(
      'Invalid session name. Use lowercase letters, digits, `.`, `_`, `-` (max 64).',
    );
  }
  if (!baseBranch.trim()) {
    throw new SessionCreateError('Base branch is required.');
  }

  // Reject duplicate names against currently tracked sessions in this run.
  for (const entry of sessions.values()) {
    if (entry.session.name === name) {
      throw new SessionCreateError(`A session named "${name}" already exists.`);
    }
  }

  const claudeStatus = claudeResolver.getStatus();
  if (!claudeStatus.ready) {
    throw new SessionCreateError(
      claudeStatus.error
        ? `Claude Code not ready: ${claudeStatus.error}`
        : 'Claude Code not ready.',
    );
  }

  // 1. Create the worktree first; on PTY-spawn failure we roll this back.
  const created = await worktreeManager.createWorktree({ repoPath, name, baseBranch });

  // 2. Spawn claude in the worktree.
  const binary = persistence.getSettings().claudeBinaryPath?.trim() || 'claude';
  let pty: IPty;
  try {
    pty = ptySpawn(binary, [], {
      name: 'xterm-256color',
      cols: Math.max(20, Math.floor(cols)),
      rows: Math.max(5, Math.floor(rows)),
      cwd: created.worktreePath,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
  } catch (err) {
    // Roll back the worktree if the PTY failed to spawn at all.
    await worktreeManager.removeWorktree(repoPath, name);
    throw new SessionCreateError(
      `Failed to spawn claude: ${(err as Error).message || 'unknown error'}`,
    );
  }

  const id = randomUUID();
  const now = Date.now();
  const session: Session = {
    id,
    name,
    worktreePath: created.worktreePath,
    baseBranch,
    createdAt: now,
    lastActivityAt: now,
    status: 'idle',
    ptyAlive: true,
    initialPrompt,
  };

  const entry: SessionEntry = { session, pty, buffer: '' };
  sessions.set(id, entry);

  pty.onData((chunk) => {
    entry.buffer += chunk;
    if (entry.buffer.length > ROLLING_BUFFER_BYTES) {
      entry.buffer = entry.buffer.slice(entry.buffer.length - ROLLING_BUFFER_BYTES);
    }
    entry.session.lastActivityAt = Date.now();
    broadcast('session:output', { id, chunk });
  });

  pty.onExit(({ exitCode }) => {
    entry.pty = null;
    entry.session.ptyAlive = false;
    broadcast('session:exit', { id, code: exitCode });
    broadcast('session:updated', { session: { ...entry.session } });
  });

  // Write the initial prompt after a short delay so the splash screen settles.
  if (initialPrompt && initialPrompt.length > 0) {
    setTimeout(() => {
      if (!entry.pty) return;
      // The whole prompt is one chunk, including any embedded newlines, then \r.
      entry.pty.write(`${initialPrompt}\r`);
    }, PROMPT_WRITE_DELAY_MS);
  }

  broadcast('session:added', { session: { ...session } });
  return { ...session };
}

export function sendInput(id: string, text: string): void {
  const entry = sessions.get(id);
  if (!entry || !entry.pty) return;
  entry.pty.write(text);
}

export function resize(id: string, cols: number, rows: number): void {
  const entry = sessions.get(id);
  if (!entry || !entry.pty) return;
  const safeCols = Math.max(20, Math.floor(cols));
  const safeRows = Math.max(5, Math.floor(rows));
  try {
    entry.pty.resize(safeCols, safeRows);
  } catch {
    // node-pty throws if the process has already exited; safe to swallow.
  }
}

export async function shutdownAll(): Promise<void> {
  const ptys = Array.from(sessions.values())
    .map((e) => e.pty)
    .filter((p): p is IPty => p !== null);
  if (ptys.length === 0) return;

  for (const p of ptys) {
    try {
      p.kill('SIGTERM');
    } catch {
      // ignore
    }
  }

  await new Promise<void>((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const stillAlive = Array.from(sessions.values()).filter((e) => e.pty !== null);
      if (stillAlive.length === 0 || Date.now() - start >= KILL_FALLBACK_MS) {
        clearInterval(interval);
        // Anything still alive gets SIGKILL.
        for (const e of stillAlive) {
          if (e.pty) {
            try {
              e.pty.kill('SIGKILL');
            } catch {
              // ignore
            }
          }
        }
        resolve();
      }
    }, 100);
  });
}

function broadcast<
  C extends 'session:output' | 'session:exit' | 'session:added' | 'session:updated',
>(channel: C, payload: unknown): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, payload);
  }
}
