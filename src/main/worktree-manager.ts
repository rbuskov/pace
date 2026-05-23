import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';

export type WorktreeFailureKind =
  | 'base-branch-missing'
  | 'branch-exists'
  | 'worktree-path-exists'
  | 'git-failure';

export class WorktreeError extends Error {
  readonly kind: WorktreeFailureKind;
  constructor(kind: WorktreeFailureKind, message: string) {
    super(message);
    this.name = 'WorktreeError';
    this.kind = kind;
  }
}

export interface CreateWorktreeOptions {
  repoPath: string;
  name: string;
  baseBranch: string;
}

export interface CreatedWorktree {
  worktreePath: string;
  branch: string;
}

const WORKTREES_DIR = '.worktrees';

export function worktreePathFor(repoPath: string, name: string): string {
  return join(repoPath, WORKTREES_DIR, name);
}

export async function createWorktree(opts: CreateWorktreeOptions): Promise<CreatedWorktree> {
  const { repoPath, name, baseBranch } = opts;
  const worktreePath = worktreePathFor(repoPath, name);
  const git = simpleGit(repoPath);

  // Pre-flight: base branch must resolve to a ref.
  try {
    await git.raw(['rev-parse', '--verify', baseBranch]);
  } catch (err) {
    throw new WorktreeError(
      'base-branch-missing',
      `Base branch "${baseBranch}" not found: ${(err as Error).message}`,
    );
  }

  // Pre-flight: the worktree directory must not already exist.
  if (existsSync(worktreePath)) {
    throw new WorktreeError(
      'worktree-path-exists',
      `Worktree path already exists: ${worktreePath}`,
    );
  }

  // Branch-existence is delegated to `git worktree add` itself, which fails
  // cleanly with "fatal: a branch named '<name>' already exists".
  try {
    await git.raw(['worktree', 'add', worktreePath, '-b', name, baseBranch]);
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/a branch named .* already exists/i.test(msg) || /branch .* already exists/i.test(msg)) {
      throw new WorktreeError('branch-exists', `Branch "${name}" already exists.`);
    }
    if (/already exists/i.test(msg)) {
      throw new WorktreeError('worktree-path-exists', msg);
    }
    if (/not a valid object name|unknown revision/i.test(msg)) {
      throw new WorktreeError('base-branch-missing', msg);
    }
    throw new WorktreeError('git-failure', msg);
  }

  return { worktreePath, branch: name };
}

export async function removeWorktree(repoPath: string, name: string): Promise<void> {
  const worktreePath = worktreePathFor(repoPath, name);
  const git = simpleGit(repoPath);
  try {
    await git.raw(['worktree', 'remove', '--force', worktreePath]);
  } catch {
    // Best-effort: the worktree may have been partially created or already removed.
  }
  try {
    await git.raw(['branch', '-D', name]);
  } catch {
    // Best-effort: branch may not exist.
  }
}
