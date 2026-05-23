import { randomUUID } from 'node:crypto';
import { type IPty, spawn as ptySpawn } from '@homebridge/node-pty-prebuilt-multiarch';
import type { Session, SessionStatus } from '@shared/types';
import { type BrowserWindow, Notification } from 'electron';
import * as claudeResolver from './claude-resolver.js';
import * as persistence from './persistence.js';
import { StatusEngine } from './status-detector.js';
import * as worktreeManager from './worktree-manager.js';

const ROLLING_BUFFER_BYTES = 256 * 1024;
const PROMPT_WRITE_DELAY_MS = 250;
const KILL_FALLBACK_MS = 2000;

// Cadence for tick-based re-evaluation. Drives idle-after-quiet transitions
// without waiting for a new PTY chunk that may never come.
const STATUS_TICK_MS = 250;

// Fixed-size ring buffer over a Node Buffer with a write cursor. Older bytes
// are overwritten in place; reading reconstructs the in-order tail.
class RollingBuffer {
  private readonly buf: Buffer;
  private cursor = 0;
  private filled = false;

  constructor(size: number) {
    this.buf = Buffer.alloc(size);
  }

  write(chunk: string): void {
    const bytes = Buffer.from(chunk, 'utf8');
    const cap = this.buf.length;
    if (bytes.length === 0) return;
    if (bytes.length >= cap) {
      bytes.subarray(bytes.length - cap).copy(this.buf, 0);
      this.cursor = 0;
      this.filled = true;
      return;
    }
    const space = cap - this.cursor;
    if (bytes.length <= space) {
      bytes.copy(this.buf, this.cursor);
      this.cursor += bytes.length;
      if (this.cursor === cap) {
        this.cursor = 0;
        this.filled = true;
      }
    } else {
      bytes.subarray(0, space).copy(this.buf, this.cursor);
      const rest = bytes.subarray(space);
      rest.copy(this.buf, 0);
      this.cursor = rest.length;
      this.filled = true;
    }
  }

  read(): string {
    if (!this.filled) {
      return this.buf.subarray(0, this.cursor).toString('utf8');
    }
    return Buffer.concat([
      this.buf.subarray(this.cursor),
      this.buf.subarray(0, this.cursor),
    ]).toString('utf8');
  }
}

interface SessionEntry {
  session: Session;
  pty: IPty | null;
  buffer: RollingBuffer;
  statusEngine: StatusEngine;
}

const sessions = new Map<string, SessionEntry>();
let mainWindowRef: BrowserWindow | null = null;
let statusTickHandle: NodeJS.Timeout | null = null;

function startStatusTicker(): void {
  if (statusTickHandle) return;
  statusTickHandle = setInterval(() => {
    if (sessions.size === 0) return;
    const now = Date.now();
    for (const entry of sessions.values()) {
      const r = entry.statusEngine.tick(now);
      if (r.changed) commitStatus(entry, r.status);
    }
  }, STATUS_TICK_MS);
  if (typeof statusTickHandle.unref === 'function') statusTickHandle.unref();
}

function commitStatus(entry: SessionEntry, status: SessionStatus): void {
  const previous = entry.session.status;
  if (previous === status) return;
  entry.session.status = status;
  broadcast('session:status-changed', { id: entry.session.id, status });
  broadcast('session:updated', { session: { ...entry.session } });
  // Optional desktop notification on idle → awaiting-input. Anything else
  // (working → awaiting-input mid-stream) doesn't fire — the user is
  // already engaged with the session.
  if (
    status === 'awaiting-input' &&
    previous === 'idle' &&
    persistence.getSettings().notifyOnAwaitingInput &&
    Notification.isSupported()
  ) {
    try {
      new Notification({
        title: 'Pace',
        body: `${entry.session.name} is awaiting input`,
      }).show();
    } catch {
      // Notification surface failures are non-fatal.
    }
  }
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

export function listSessions(): Session[] {
  return Array.from(sessions.values()).map((e) => ({ ...e.session }));
}

export function getReplayBuffer(id: string): string {
  return sessions.get(id)?.buffer.read() ?? '';
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

  const entry: SessionEntry = {
    session,
    pty,
    buffer: new RollingBuffer(ROLLING_BUFFER_BYTES),
    statusEngine: new StatusEngine(),
  };
  sessions.set(id, entry);
  startStatusTicker();

  pty.onData((chunk) => {
    entry.buffer.write(chunk);
    const now = Date.now();
    entry.session.lastActivityAt = now;
    broadcast('session:output', { id, chunk });
    const r = entry.statusEngine.feed(chunk, now);
    if (r.changed) commitStatus(entry, r.status);
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

export async function closeSession(id: string): Promise<void> {
  const entry = sessions.get(id);
  if (!entry) return;
  await killEntry(entry);
  sessions.delete(id);
  broadcast('session:removed', { id });
  stopTickerIfIdle();
}

export async function closeAll(): Promise<void> {
  await shutdownAll();
  const ids = Array.from(sessions.keys());
  sessions.clear();
  for (const id of ids) {
    broadcast('session:removed', { id });
  }
  stopTickerIfIdle();
}

function stopTickerIfIdle(): void {
  if (sessions.size === 0 && statusTickHandle) {
    clearInterval(statusTickHandle);
    statusTickHandle = null;
  }
}

async function killEntry(entry: SessionEntry): Promise<void> {
  const pty = entry.pty;
  if (!pty) return;
  try {
    pty.kill('SIGTERM');
  } catch {
    // ignore
  }
  await new Promise<void>((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (entry.pty === null || Date.now() - start >= KILL_FALLBACK_MS) {
        clearInterval(interval);
        if (entry.pty) {
          try {
            entry.pty.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
        resolve();
      }
    }, 100);
  });
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
  C extends
    | 'session:output'
    | 'session:exit'
    | 'session:added'
    | 'session:updated'
    | 'session:removed'
    | 'session:status-changed',
>(channel: C, payload: unknown): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, payload);
  }
}
