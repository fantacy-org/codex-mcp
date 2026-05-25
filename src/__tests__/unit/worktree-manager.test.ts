// src/__tests__/unit/worktree-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  createWorktree,
  removeWorktree,
  getCurrentBranch,
  getDiff,
} from '../../worktree/manager.js';
import { NotAGitRepoError, BranchAlreadyExistsError } from '../../session/types.js';

let projectDir: string;

beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-mcp-git-'));
  execSync('git init', { cwd: projectDir });
  execSync('git config user.email "test@test.com"', { cwd: projectDir });
  execSync('git config user.name "Test"', { cwd: projectDir });
  // Need an initial commit so worktree can be created
  await fs.writeFile(path.join(projectDir, 'README.md'), '# Test', 'utf8');
  execSync('git add .', { cwd: projectDir });
  execSync('git commit -m "init"', { cwd: projectDir });
});

afterEach(async () => {
  await fs.rm(projectDir, { recursive: true, force: true });
});

describe('Worktree Manager', () => {
  it('createWorktree creates the worktree directory and branch', async () => {
    const worktreePath = path.join(projectDir, '.worktrees', 'task-abc');
    createWorktree(projectDir, worktreePath, 'task/abc');
    await expect(fs.access(worktreePath)).resolves.toBeUndefined();
    const branches = execSync('git branch', { cwd: projectDir, encoding: 'utf8' });
    expect(branches).toContain('task/abc');
  });

  it('createWorktree throws NotAGitRepoError for non-git dir', async () => {
    const notGit = await fs.mkdtemp(path.join(os.tmpdir(), 'not-git-'));
    try {
      expect(() =>
        createWorktree(notGit, path.join(notGit, 'wt'), 'task/x'),
      ).toThrow(NotAGitRepoError);
    } finally {
      await fs.rm(notGit, { recursive: true, force: true });
    }
  });

  it('createWorktree throws BranchAlreadyExistsError for existing branch', () => {
    execSync('git branch task/existing', { cwd: projectDir });
    expect(() =>
      createWorktree(projectDir, path.join(projectDir, '.worktrees', 'wt'), 'task/existing'),
    ).toThrow(BranchAlreadyExistsError);
  });

  it('removeWorktree removes directory and branch', async () => {
    const worktreePath = path.join(projectDir, '.worktrees', 'task-rm');
    createWorktree(projectDir, worktreePath, 'task/rm');
    removeWorktree(projectDir, worktreePath, 'task/rm');
    await expect(fs.access(worktreePath)).rejects.toThrow();
    const branches = execSync('git branch', { cwd: projectDir, encoding: 'utf8' });
    expect(branches).not.toContain('task/rm');
  });

  it('removeWorktree is idempotent when worktree already gone', () => {
    expect(() =>
      removeWorktree(projectDir, path.join(projectDir, '.worktrees', 'ghost'), 'task/ghost'),
    ).not.toThrow();
  });

  it('getCurrentBranch returns the current branch name', () => {
    const branch = getCurrentBranch(projectDir);
    expect(typeof branch).toBe('string');
    expect(branch.length).toBeGreaterThan(0);
  });

  it('getDiff returns a string (empty for clean worktree)', async () => {
    const worktreePath = path.join(projectDir, '.worktrees', 'task-diff');
    createWorktree(projectDir, worktreePath, 'task/diff');
    const diff = getDiff(worktreePath);
    expect(typeof diff).toBe('string');
  });
});
