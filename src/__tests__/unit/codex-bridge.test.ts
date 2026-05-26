// src/__tests__/unit/codex-bridge.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexNotFoundError, CodexTimeoutError, CodexExecutionError, EMPTY_BRIEF } from '../../session/types.js';
import type { Brief } from '../../session/types.js';

// Mock child_process before importing bridge
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawnSync: vi.fn(), spawn: vi.fn() };
});

const MOCK_BRIEF: Brief = {
  goal: 'Add authentication',
  constraints: ['Use existing Express setup'],
  decisions: ['Use RS256'],
  relevant_files: ['src/middleware/auth.ts'],
  current_focus: 'Token validation',
};

describe('Codex Bridge — findCodexCli', () => {
  it('returns the codex path when found', async () => {
    const { spawnSync } = await import('child_process');
    vi.mocked(spawnSync).mockReturnValue({
      status: 0, stdout: '/usr/bin/codex\n', stderr: '', pid: 1,
      output: [], signal: null, error: undefined,
    } as any);
    const { findCodexCli } = await import('../../codex/bridge.js');
    expect(findCodexCli()).toBe('/usr/bin/codex');
  });

  it('throws CodexNotFoundError when codex is not in PATH', async () => {
    const { spawnSync } = await import('child_process');
    vi.mocked(spawnSync).mockReturnValue({
      status: 1, stdout: '', stderr: 'not found', pid: 1,
      output: [], signal: null, error: undefined,
    } as any);
    const { findCodexCli } = await import('../../codex/bridge.js');
    expect(() => findCodexCli()).toThrow(CodexNotFoundError);
  });
});

describe('Codex Bridge — runCodexChat', () => {
  beforeEach(() => vi.resetModules());

  it('resolves with stdout on success', async () => {
    vi.doMock('child_process', () => {
      const EventEmitter = require('events');
      return {
        spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: '/usr/bin/codex\n', stderr: '' }),
        spawn: vi.fn().mockImplementation(() => {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.kill = vi.fn();
          setTimeout(() => {
            child.stdout.emit('data', Buffer.from('Codex response text'));
            child.emit('close', 0);
          }, 10);
          return child;
        }),
      };
    });
    const { runCodexChat } = await import('../../codex/bridge.js');
    const result = await runCodexChat('/tmp/worktree', MOCK_BRIEF, 'What approach?');
    expect(result).toBe('Codex response text');
  });

  it('rejects with CodexTimeoutError when process exceeds timeout', async () => {
    vi.doMock('child_process', () => {
      const EventEmitter = require('events');
      return {
        spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: '/usr/bin/codex\n', stderr: '' }),
        spawn: vi.fn().mockImplementation(() => {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.kill = vi.fn();
          // Never emit 'close'
          return child;
        }),
      };
    });
    const { runCodexChat } = await import('../../codex/bridge.js');
    // Import types from the same fresh module registry so instanceof works across resetModules()
    const { CodexTimeoutError: FreshCodexTimeoutError } = await import('../../session/types.js');
    await expect(
      runCodexChat('/tmp/worktree', MOCK_BRIEF, 'question', 50),
    ).rejects.toThrow(FreshCodexTimeoutError);
  });

  it('rejects with CodexExecutionError on non-zero exit', async () => {
    vi.doMock('child_process', () => {
      const EventEmitter = require('events');
      return {
        spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: '/usr/bin/codex\n', stderr: '' }),
        spawn: vi.fn().mockImplementation(() => {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.kill = vi.fn();
          setTimeout(() => {
            child.stderr.emit('data', Buffer.from('fatal error'));
            child.emit('close', 1);
          }, 10);
          return child;
        }),
      };
    });
    const { runCodexChat } = await import('../../codex/bridge.js');
    // Import types from the same fresh module registry so instanceof works across resetModules()
    const { CodexExecutionError: FreshCodexExecutionError } = await import('../../session/types.js');
    await expect(
      runCodexChat('/tmp/worktree', MOCK_BRIEF, 'question'),
    ).rejects.toThrow(FreshCodexExecutionError);
  });
});

describe('Codex Bridge — prompt construction', () => {
  it('chat prompt contains goal, constraints, and message', async () => {
    const { buildChatPrompt } = await import('../../codex/bridge.js');
    const prompt = buildChatPrompt(MOCK_BRIEF, 'My question here');
    expect(prompt).toContain('Add authentication');
    expect(prompt).toContain('Use existing Express setup');
    expect(prompt).toContain('My question here');
    expect(prompt).not.toContain('Implement');
  });

  it('implement prompt contains goal and does not restrict file modification', async () => {
    const { buildImplementPrompt } = await import('../../codex/bridge.js');
    const prompt = buildImplementPrompt(MOCK_BRIEF, 'Extra: use bcrypt');
    expect(prompt).toContain('Add authentication');
    expect(prompt).toContain('Extra: use bcrypt');
    expect(prompt).not.toContain('do not modify');
  });
});

describe('Codex Bridge — runCodexImplement passes --add-dir for worktree git access', () => {
  beforeEach(() => vi.resetModules());

  it('includes --add-dir <git-common-dir> in spawn args so Codex can commit inside worktree', async () => {
    vi.doMock('child_process', () => {
      const EventEmitter = require('events');
      // Discriminate spawnSync calls by command/args
      const spawnSyncMock = vi.fn().mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'which' || cmd === 'where') {
          // findCodexCli
          return { status: 0, stdout: '/usr/bin/codex\n', stderr: '', pid: 1, output: [], signal: null };
        }
        if (cmd === 'git' && Array.isArray(args) && args.includes('--git-common-dir')) {
          // getGitCommonDir
          return { status: 0, stdout: '/fake/project/.git\n', stderr: '', pid: 1, output: [], signal: null };
        }
        return { status: 1, stdout: '', stderr: '', pid: 1, output: [], signal: null };
      });
      const spawnMock = vi.fn().mockImplementation(() => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = vi.fn();
        setTimeout(() => {
          child.stdout.emit('data', Buffer.from('done'));
          child.emit('close', 0);
        }, 10);
        return child;
      });
      return { spawnSync: spawnSyncMock, spawn: spawnMock };
    });

    const { runCodexImplement } = await import('../../codex/bridge.js');
    const { EMPTY_BRIEF } = await import('../../session/types.js');
    await runCodexImplement('/fake/worktree', { ...EMPTY_BRIEF, goal: 'Add auth' });

    const { spawn } = await import('child_process');
    const spawnCalls = vi.mocked(spawn).mock.calls;
    expect(spawnCalls.length).toBeGreaterThan(0);
    const spawnArgs = spawnCalls[0]![1] as string[];
    expect(spawnArgs).toContain('--add-dir');
    const addDirIdx = spawnArgs.indexOf('--add-dir');
    expect(spawnArgs[addDirIdx + 1]).toBe('/fake/project/.git');
  });
});
