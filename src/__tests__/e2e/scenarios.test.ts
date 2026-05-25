// src/__tests__/e2e/scenarios.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

vi.mock('../../codex/bridge.js', () => ({
  findCodexCli: vi.fn().mockReturnValue('/usr/bin/codex'),
  runCodexChat: vi.fn().mockResolvedValue('Codex says: use middleware pattern'),
  runCodexImplement: vi.fn().mockResolvedValue('Created src/middleware/auth.ts'),
  buildChatPrompt: vi.fn().mockReturnValue('prompt'),
  buildImplementPrompt: vi.fn().mockReturnValue('prompt'),
}));

let projectDir: string;
let tempSessionsDir: string;

beforeEach(async () => {
  vi.resetModules();
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-e2e-project-'));
  tempSessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-e2e-sessions-'));
  vi.stubEnv('CODEX_MCP_SESSIONS_DIR', tempSessionsDir);
  execSync('git init', { cwd: projectDir });
  execSync('git config user.email "test@test.com"', { cwd: projectDir });
  execSync('git config user.name "Test"', { cwd: projectDir });
  await fs.writeFile(path.join(projectDir, 'README.md'), '# project', 'utf8');
  execSync('git add .', { cwd: projectDir });
  execSync('git commit -m "init"', { cwd: projectDir });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(projectDir, { recursive: true, force: true });
  await fs.rm(tempSessionsDir, { recursive: true, force: true });
});

describe('E2E: Happy Path', () => {
  it('create → update_brief → chat → implement → get_diff → merge → delete leaves no residue', async () => {
    const { createSession } = await import('../../tools/create-session.js');
    const { updateBrief } = await import('../../tools/update-brief.js');
    const { chat } = await import('../../tools/chat.js');
    const { implement } = await import('../../tools/implement.js');
    const { getDiff } = await import('../../tools/get-diff.js');
    const { merge } = await import('../../tools/merge.js');
    const { deleteSessionTool } = await import('../../tools/delete-session.js');

    // 1. Create session
    const { session_id, branch, worktree_path } = await createSession({
      task: 'Add auth middleware',
      project_path: projectDir,
    });
    expect(session_id).toBeTruthy();

    // 2. Update brief
    await updateBrief({
      session_id,
      brief: { goal: 'Add JWT auth middleware', constraints: ['Use Express'] },
    });

    // 3. Chat
    const chatResult = await chat({ session_id, message: 'What pattern should I use?' });
    expect(chatResult.detail).toBe('Codex says: use middleware pattern');

    // 4. Implement
    const implResult = await implement({ session_id });
    expect(implResult.detail).toBe('Created src/middleware/auth.ts');

    // 5. Get diff
    const diffResult = await getDiff({ session_id });
    expect(typeof diffResult.diff).toBe('string');

    // 6. Merge
    const mergeResult = await merge({ session_id });
    expect(mergeResult.success).toBe(true);

    // Worktree removed after merge
    await expect(fs.access(worktree_path)).rejects.toThrow();

    // 7. Delete session
    await deleteSessionTool({ session_id });
    const sessionFile = path.join(tempSessionsDir, `${session_id}.json`);
    await expect(fs.access(sessionFile)).rejects.toThrow();

    // Branch cleaned up
    const branches = execSync('git branch', { cwd: projectDir, encoding: 'utf8' });
    expect(branches).not.toContain(branch);
  });
});

describe('E2E: Iteration Loop', () => {
  it('can implement, review, update brief, and implement again', async () => {
    const { createSession } = await import('../../tools/create-session.js');
    const { updateBrief } = await import('../../tools/update-brief.js');
    const { implement } = await import('../../tools/implement.js');
    const { loadSession } = await import('../../session/manager.js');

    const { session_id } = await createSession({
      task: 'Add auth',
      project_path: projectDir,
    });

    // First implement
    await implement({ session_id });
    let session = await loadSession(session_id);
    expect(session.status).toBe('REVIEW');

    // Set status back to DRAFTING to allow second implement
    const { updateSession } = await import('../../session/manager.js');
    await updateSession(session_id, { status: 'DRAFTING' });

    // Update brief with new focus
    await updateBrief({ session_id, brief: { current_focus: 'Add refresh token' } });

    // Second implement
    await implement({ session_id, extra_instructions: 'Also add refresh token endpoint' });
    session = await loadSession(session_id);
    expect(session.status).toBe('REVIEW');
  });
});

describe('E2E: Error Recovery', () => {
  it('create_session on a non-git dir returns NotAGitRepoError without leaving residue', async () => {
    const notGit = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-e2e-notgit-'));
    const { createSession } = await import('../../tools/create-session.js');
    try {
      await expect(
        createSession({ task: 'test', project_path: notGit }),
      ).rejects.toThrow('Not a git repository');
      // No session files created
      const files = await fs.readdir(tempSessionsDir);
      expect(files).toHaveLength(0);
    } finally {
      await fs.rm(notGit, { recursive: true, force: true });
    }
  });

  it('merge conflict returns conflict list without auto-resolving', async () => {
    const { createSession } = await import('../../tools/create-session.js');
    const { implement } = await import('../../tools/implement.js');
    const { merge } = await import('../../tools/merge.js');
    const { runCodexImplement } = await import('../../codex/bridge.js');

    const { session_id, worktree_path } = await createSession({
      task: 'conflicting task',
      project_path: projectDir,
    });

    // Simulate a conflict: write the same file in both branches
    await fs.writeFile(path.join(projectDir, 'conflict.txt'), 'main branch content', 'utf8');
    execSync('git add conflict.txt', { cwd: projectDir });
    execSync('git commit -m "main: add conflict.txt"', { cwd: projectDir });

    // Write conflicting content in worktree
    await fs.writeFile(path.join(worktree_path, 'conflict.txt'), 'task branch content', 'utf8');
    execSync('git add conflict.txt', { cwd: worktree_path });
    execSync('git commit -m "task: add conflicting conflict.txt"', { cwd: worktree_path });

    vi.mocked(runCodexImplement).mockResolvedValueOnce('done');
    await implement({ session_id });

    const result = await merge({ session_id });
    expect(result.success).toBe(false);
    expect(result.conflicts).toContain('conflict.txt');
    // Worktree still exists (not cleaned up on conflict)
    await expect(fs.access(worktree_path)).resolves.toBeUndefined();
  });
});
