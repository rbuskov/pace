import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectDefaultBranch, validateAndDescribeRepo } from '../src/main/repo-manager.js';

function makeRepo(branch: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pace-test-'));
  execSync(`git init -q -b ${branch} ${dir}`);
  execSync('git -C "$REPO" config user.email "t@t.t"', { env: { ...process.env, REPO: dir } });
  execSync('git -C "$REPO" config user.name "t"', { env: { ...process.env, REPO: dir } });
  execSync('git -C "$REPO" commit -q --allow-empty -m init', {
    env: { ...process.env, REPO: dir },
  });
  return dir;
}

describe('repo-manager', () => {
  let repoDir: string | null = null;

  afterEach(() => {
    if (repoDir) {
      rmSync(repoDir, { recursive: true, force: true });
      repoDir = null;
    }
  });

  it('rejects a non-existent path', async () => {
    await expect(validateAndDescribeRepo('/does/not/exist/xyz')).rejects.toThrow(/does not exist/);
  });

  it('rejects a folder that is not a git repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pace-test-notgit-'));
    try {
      await expect(validateAndDescribeRepo(dir)).rejects.toThrow(/not a git repository/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a valid repo and returns canonical info', async () => {
    repoDir = makeRepo('main');
    const info = await validateAndDescribeRepo(repoDir);
    expect(info.path.endsWith(repoDir.split('/').pop()!)).toBe(true);
    expect(info.defaultBranch).toBe('main');
  });

  it('detects master as a fallback when origin/HEAD missing', async () => {
    repoDir = makeRepo('master');
    const branch = await detectDefaultBranch(repoDir);
    expect(branch).toBe('master');
  });

  it('falls back to current branch when neither main nor master exist', async () => {
    repoDir = makeRepo('develop');
    const branch = await detectDefaultBranch(repoDir);
    expect(branch).toBe('develop');
  });
});

describe('repo-manager validation', () => {
  it('throws when no path is provided', async () => {
    await expect(validateAndDescribeRepo('')).rejects.toThrow(/No path/);
  });
});

