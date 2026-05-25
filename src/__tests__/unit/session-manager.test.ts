// src/__tests__/unit/session-manager.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Session } from '../../session/types.js';
import { SessionNotFoundError, SessionCorruptedError, EMPTY_BRIEF } from '../../session/types.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-mcp-test-'));
  vi.stubEnv('CODEX_MCP_SESSIONS_DIR', tempDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tempDir, { recursive: true, force: true });
});

// Import after env stub — dynamic import ensures fresh module evaluation per suite
async function getManager() {
  return await import('../../session/manager.js');
}

function makeSession(id = 'test-id-1'): Session {
  const now = new Date().toISOString();
  return {
    id,
    status: 'DRAFTING',
    task: 'Test task',
    projectPath: '/tmp/project',
    worktreePath: '/tmp/project/.worktrees/task-test',
    branch: 'task/test-id-1',
    brief: { ...EMPTY_BRIEF, goal: 'Test goal' },
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe('Session Manager', () => {
  it('saves a session and the file exists', async () => {
    const { saveSession } = await getManager();
    const session = makeSession();
    await saveSession(session);
    const filePath = path.join(tempDir, `${session.id}.json`);
    await expect(fs.access(filePath)).resolves.toBeUndefined();
  });

  it('loads a saved session and returns correct data', async () => {
    const { saveSession, loadSession } = await getManager();
    const session = makeSession();
    await saveSession(session);
    const loaded = await loadSession(session.id);
    expect(loaded.id).toBe(session.id);
    expect(loaded.task).toBe(session.task);
    expect(loaded.brief.goal).toBe('Test goal');
  });

  it('loadSession throws SessionNotFoundError for unknown id', async () => {
    const { loadSession } = await getManager();
    await expect(loadSession('nonexistent-id')).rejects.toThrow(SessionNotFoundError);
  });

  it('loadSession throws SessionCorruptedError for invalid JSON', async () => {
    const { loadSession } = await getManager();
    const filePath = path.join(tempDir, 'bad-id.json');
    await fs.writeFile(filePath, '{ invalid json }', 'utf8');
    await expect(loadSession('bad-id')).rejects.toThrow(SessionCorruptedError);
  });

  it('updateSession merges partial fields without losing others', async () => {
    const { saveSession, updateSession, loadSession } = await getManager();
    const session = makeSession();
    await saveSession(session);
    await updateSession(session.id, { status: 'REVIEW' });
    const updated = await loadSession(session.id);
    expect(updated.status).toBe('REVIEW');
    expect(updated.task).toBe(session.task); // not lost
  });

  it('deleteSession removes the file', async () => {
    const { saveSession, deleteSession } = await getManager();
    const session = makeSession();
    await saveSession(session);
    await deleteSession(session.id);
    const filePath = path.join(tempDir, `${session.id}.json`);
    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('deleteSession is idempotent (no throw if file missing)', async () => {
    const { deleteSession } = await getManager();
    await expect(deleteSession('does-not-exist')).resolves.toBeUndefined();
  });
});
