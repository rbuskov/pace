import { existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { RepoInfo } from '@shared/types';
import { simpleGit } from 'simple-git';

export class RepoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoValidationError';
  }
}

export async function validateAndDescribeRepo(candidatePath: string): Promise<RepoInfo> {
  if (!candidatePath) {
    throw new RepoValidationError('No path provided.');
  }
  if (!existsSync(candidatePath)) {
    throw new RepoValidationError(`Path does not exist: ${candidatePath}`);
  }
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(candidatePath);
  } catch (err) {
    throw new RepoValidationError(`Could not read path: ${(err as Error).message}`);
  }
  if (!stats.isDirectory()) {
    throw new RepoValidationError('Selected path is not a directory.');
  }
  // `.git` may be a directory (normal clone) or a file (worktree/submodule).
  if (!existsSync(join(candidatePath, '.git'))) {
    throw new RepoValidationError('Selected folder is not a git repository.');
  }

  const git = simpleGit(candidatePath);

  let toplevel: string;
  try {
    toplevel = (await git.revparse(['--show-toplevel'])).trim();
  } catch (err) {
    throw new RepoValidationError(`git rev-parse failed: ${(err as Error).message}`);
  }
  if (!toplevel) {
    throw new RepoValidationError('Could not resolve repository root.');
  }

  const defaultBranch = await detectDefaultBranch(toplevel);

  return {
    path: toplevel,
    name: basename(toplevel),
    defaultBranch,
  };
}

export async function detectDefaultBranch(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  // 1. symbolic-ref of origin/HEAD.
  try {
    const ref = (await git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
    if (ref) {
      return ref.replace(/^origin\//, '');
    }
  } catch {
    // fall through to next strategy
  }
  // 2. main / master if they exist locally.
  try {
    const branches = await git.branchLocal();
    if (branches.all.includes('main')) return 'main';
    if (branches.all.includes('master')) return 'master';
  } catch {
    // fall through
  }
  // 3. HEAD (current branch).
  try {
    const head = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (head && head !== 'HEAD') return head;
  } catch {
    // fall through
  }
  return 'HEAD';
}
