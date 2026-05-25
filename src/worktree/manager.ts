// src/worktree/manager.ts
import { spawnSync } from 'child_process';
import { NotAGitRepoError, BranchAlreadyExistsError } from '../session/types.js';

function git(args: string[], cwd: string) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
}

export function isGitRepo(projectPath: string): boolean {
  const result = git(['rev-parse', '--git-dir'], projectPath);
  return result.status === 0;
}

export function createWorktree(
  projectPath: string,
  worktreePath: string,
  branch: string,
): void {
  if (!isGitRepo(projectPath)) {
    throw new NotAGitRepoError(projectPath);
  }

  const branchExists = git(
    ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    projectPath,
  );
  if (branchExists.status === 0) {
    throw new BranchAlreadyExistsError(branch);
  }

  const result = git(['worktree', 'add', worktreePath, '-b', branch], projectPath);
  if (result.status !== 0) {
    throw new Error(`git worktree add failed: ${result.stderr}`);
  }
}

export function removeWorktree(
  projectPath: string,
  worktreePath: string,
  branch: string,
  force = false,
): void {
  const args = ['worktree', 'remove', worktreePath];
  if (force) args.push('--force');
  // Ignore errors — worktree may already be gone
  git(args, projectPath);
  git(['branch', '-D', branch], projectPath);
}

export function getCurrentBranch(projectPath: string): string {
  const result = git(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
  if (result.status !== 0) {
    throw new Error(`Failed to get current branch: ${result.stderr}`);
  }
  return result.stdout.trim();
}

export function getDiff(worktreePath: string, statOnly = false): string {
  const args = ['diff', 'HEAD'];
  if (statOnly) args.push('--stat');
  const result = git(args, worktreePath);
  if (result.status !== 0) {
    throw new Error(`git diff failed: ${result.stderr}`);
  }
  return result.stdout;
}

export function mergeBranch(
  projectPath: string,
  branch: string,
): { success: boolean; conflicts: string[] } {
  const result = git(
    ['merge', branch, '--no-ff', '-m', `Merge task branch ${branch}`],
    projectPath,
  );

  if (result.status === 0) {
    return { success: true, conflicts: [] };
  }

  // Detect conflict
  const isConflict =
    result.stdout.includes('CONFLICT') || result.stderr.includes('CONFLICT');

  if (isConflict) {
    const conflictResult = git(
      ['diff', '--name-only', '--diff-filter=U'],
      projectPath,
    );
    const conflicts = conflictResult.stdout
      .trim()
      .split('\n')
      .filter(Boolean);
    git(['merge', '--abort'], projectPath);
    return { success: false, conflicts };
  }

  throw new Error(`git merge failed: ${result.stderr || result.stdout}`);
}
