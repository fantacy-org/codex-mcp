// src/__tests__/integration/tools.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

// Mock Codex Bridge — no real Codex CLI needed
vi.mock('../../codex/bridge.js', () => ({
  findCodexCli: vi.fn().mockReturnValue('/usr/bin/codex'),
  runCodexChat: vi.fn().mockResolvedValue('Codex chat response'),
  runCodexImplement: vi.fn().mockResolvedValue('Implementation complete'),
  buildChatPrompt: vi.fn().mockReturnValue('prompt'),
  buildImplementPrompt: vi.fn().mockReturnValue('prompt'),
}));

let projectDir: string;
let tempSessionsDir: string;

beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-int-project-'));
  tempSessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-int-sessions-'));
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

describe('codex_create_session', () => {
  it('creates a session file and worktree', async () => {
    const { createSession } = await import('../../tools/create-session.js');
    const result = await createSession({ task: 'Add auth', project_path: projectDir });
    expect(result.session_id).toBeTruthy();
    expect(result.branch).toMatch(/^task\//);
    const sessionFile = path.join(tempSessionsDir, `${result.session_id}.json`);
    await expect(fs.access(sessionFile)).resolves.toBeUndefined();
    await expect(fs.access(result.worktree_path)).resolves.toBeUndefined();
  });
});

describe('codex_update_brief', () => {
  it('updates brief fields in the session file', async () => {
    const { createSession } = await import('../../tools/create-session.js');
    const { updateBrief } = await import('../../tools/update-brief.js');
    const { loadSession } = await import('../../session/manager.js');
    const { session_id } = await createSession({ task: 'Add auth', project_path: projectDir });
    await updateBrief({ session_id, brief: { goal: 'Updated goal', constraints: ['No deps'] } });
    const session = await loadSession(session_id);
    expect(session.brief.goal).toBe('Updated goal');
    expect(session.brief.constraints).toEqual(['No deps']);
  });
});

describe('codex_chat', () => {
  it('returns summary and detail; appends to history', async () => {
    const { createSession } = await import('../../tools/create-session.js');
    const { chat } = await import('../../tools/chat.js');
    const { loadSession } = await import('../../session/manager.js');
    const { session_id } = await createSession({ task: 'Add auth', project_path: projectDir });
    const result = await chat({ session_id, message: 'What approach?' });
    expect(result.summary).toBeTruthy();
    expect(result.detail).toBe('Codex chat response');
    const session = await loadSession(session_id);
    expect(session.history).toHaveLength(2); // claude + codex entry
  });
});

describe('codex_get_history', () => {
  it('returns history entries', async () => {
    const { createSession } = await import('../../tools/create-session.js');
    const { chat } = await import('../../tools/chat.js');
    const { getHistory } = await import('../../tools/get-history.js');
    const { session_id } = await createSession({ task: 'Add auth', project_path: projectDir });
    await chat({ session_id, message: 'Question 1' });
    const result = await getHistory({ session_id });
    expect(result.history).toHaveLength(2);
    expect(result.history[0]?.role).toBe('claude');
    expect(result.history[1]?.role).toBe('codex');
  });
});

describe('codex_implement', () => {
  it('transitions status from DRAFTING to REVIEW', async () => {
    const { createSession } = await import('../../tools/create-session.js');
    const { implement } = await import('../../tools/implement.js');
    const { loadSession } = await import('../../session/manager.js');
    const { session_id } = await createSession({ task: 'Add auth', project_path: projectDir });
    await implement({ session_id });
    const session = await loadSession(session_id);
    expect(session.status).toBe('REVIEW');
  });

  it('returns summary, detail, and diff_stat', async () => {
    const { createSession } = await import('../../tools/create-session.js');
    const { implement } = await import('../../tools/implement.js');
    const { session_id } = await createSession({ task: 'Add auth', project_path: projectDir });
    const result = await implement({ session_id });
    expect(result.summary).toBeTruthy();
    expect(result.detail).toBe('Implementation complete');
    expect(typeof result.diff_stat).toBe('string');
  });

  it('auto-commit uses brief.goal as commit message when Codex leaves files uncommitted', async () => {
    const bridgeMod = await import('../../codex/bridge.js');
    const { writeFileSync } = await import('fs');
    const { join } = await import('path');
    // Override once: simulate Codex writing a file but not committing
    vi.mocked(bridgeMod.runCodexImplement).mockImplementationOnce(async (worktreePath) => {
      writeFileSync(join(worktreePath, 'auth.ts'), 'export const auth = true;\n');
      return 'Implementation done, sandbox prevented git commit';
    });

    const { createSession } = await import('../../tools/create-session.js');
    const { implement } = await import('../../tools/implement.js');
    const { session_id, worktree_path } = await createSession({
      task: 'Add authentication feature',
      project_path: projectDir,
    });
    await implement({ session_id });

    // The auto-commit message should be derived from brief.goal (= task)
    const subject = execSync('git log --format=%s -1', {
      cwd: worktree_path,
      encoding: 'utf8',
    }).trim();
    expect(subject).toContain('Add authentication feature');
  });
});

describe('codex_get_diff', () => {
  it('returns a diff string', async () => {
    const { createSession } = await import('../../tools/create-session.js');
    const { getDiff } = await import('../../tools/get-diff.js');
    const { session_id } = await createSession({ task: 'Add auth', project_path: projectDir });
    const result = await getDiff({ session_id });
    expect(typeof result.diff).toBe('string');
  });
});

describe('codex_merge', () => {
  it('merges branch and transitions status to MERGED', async () => {
    const { createSession } = await import('../../tools/create-session.js');
    const { implement } = await import('../../tools/implement.js');
    const { merge } = await import('../../tools/merge.js');
    const { loadSession } = await import('../../session/manager.js');
    const { session_id } = await createSession({ task: 'Add auth', project_path: projectDir });
    await implement({ session_id });
    const result = await merge({ session_id });
    expect(result.success).toBe(true);
    expect(result.merged_into).toBeTruthy();
    const session = await loadSession(session_id);
    expect(session.status).toBe('MERGED');
  });
});

describe('codex_delete_session', () => {
  it('removes the session file', async () => {
    const { createSession } = await import('../../tools/create-session.js');
    const { deleteSessionTool } = await import('../../tools/delete-session.js');
    const { session_id } = await createSession({ task: 'Add auth', project_path: projectDir });
    await deleteSessionTool({ session_id });
    const sessionFile = path.join(tempSessionsDir, `${session_id}.json`);
    await expect(fs.access(sessionFile)).rejects.toThrow();
  });
});
