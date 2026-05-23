import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type WorktreeError,
  createWorktree,
  removeWorktree,
  worktreePathFor,
} from '../src/main/worktree-manager.js';

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pace-wt-test-'));
  execSync(`git init -q -b main ${dir}`);
  const env = { ...process.env, REPO: dir };
  execSync('git -C "$REPO" config user.email "t@t.t"', { env });
  execSync('git -C "$REPO" config user.name "t"', { env });
  execSync('git -C "$REPO" commit -q --allow-empty -m init', { env });
  return dir;
}

describe('worktree-manager', () => {
  let repoDir: string | null = null;

  afterEach(() => {
    if (repoDir) {
      rmSync(repoDir, { recursive: true, force: true });
      repoDir = null;
    }
  });

  it('creates a worktree on a new branch', async () => {
    repoDir = makeRepo();
    const result = await createWorktree({
      repoPath: repoDir,
      name: 'feature-a',
      baseBranch: 'main',
    });
    expect(result.worktreePath).toBe(worktreePathFor(repoDir, 'feature-a'));
    expect(existsSync(result.worktreePath)).toBe(true);
    expect(existsSync(join(result.worktreePath, '.git'))).toBe(true);
  });

  it('rejects an unknown base branch', async () => {
    repoDir = makeRepo();
    await expect(
      createWorktree({ repoPath: repoDir, name: 'x', baseBranch: 'origin/does-not-exist' }),
    ).rejects.toMatchObject({ kind: 'base-branch-missing' } as Partial<WorktreeError>);
  });

  it('rejects a duplicate worktree path', async () => {
    repoDir = makeRepo();
    await createWorktree({ repoPath: repoDir, name: 'dup', baseBranch: 'main' });
    // Second create hits the path check first; the message identifies the conflict.
    await expect(
      createWorktree({ repoPath: repoDir, name: 'dup', baseBranch: 'main' }),
    ).rejects.toMatchObject({ kind: 'worktree-path-exists' } as Partial<WorktreeError>);
  });

  it('rejects a name that already exists as a branch (no worktree)', async () => {
    repoDir = makeRepo();
    execSync('git -C "$REPO" branch lonely', { env: { ...process.env, REPO: repoDir } });
    await expect(
      createWorktree({ repoPath: repoDir, name: 'lonely', baseBranch: 'main' }),
    ).rejects.toMatchObject({ kind: 'branch-exists' } as Partial<WorktreeError>);
  });

  it('removeWorktree cleans up the worktree and branch', async () => {
    repoDir = makeRepo();
    const result = await createWorktree({ repoPath: repoDir, name: 'cleanup', baseBranch: 'main' });
    await removeWorktree(repoDir, 'cleanup');
    expect(existsSync(result.worktreePath)).toBe(false);
    // A fresh create with the same name now succeeds — proving the branch is gone too.
    await createWorktree({ repoPath: repoDir, name: 'cleanup', baseBranch: 'main' });
  });
});
