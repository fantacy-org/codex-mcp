// src/session/types.ts

export type SessionStatus = 'DRAFTING' | 'IMPLEMENTING' | 'REVIEW' | 'MERGED';

export interface Brief {
  goal: string;
  constraints: string[];
  decisions: string[];
  relevant_files: string[];
  current_focus: string;
}

export interface HistoryEntry {
  role: 'claude' | 'codex';
  content: string;
  ts: string; // ISO 8601
}

export interface Session {
  id: string;
  status: SessionStatus;
  task: string;
  projectPath: string;
  worktreePath: string;
  branch: string;
  brief: Brief;
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export const EMPTY_BRIEF: Brief = {
  goal: '',
  constraints: [],
  decisions: [],
  relevant_files: [],
  current_focus: '',
};

// ── Custom errors ──────────────────────────────────────────────────────────────

export class SessionNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Session not found: ${id}`);
    this.name = 'SessionNotFoundError';
  }
}

export class SessionCorruptedError extends Error {
  constructor(public readonly filePath: string) {
    super(`Session file corrupted: ${filePath}`);
    this.name = 'SessionCorruptedError';
  }
}

export class NotAGitRepoError extends Error {
  constructor(public readonly path: string) {
    super(`Not a git repository: ${path}`);
    this.name = 'NotAGitRepoError';
  }
}

export class BranchAlreadyExistsError extends Error {
  constructor(public readonly branch: string) {
    super(`Branch already exists: ${branch}`);
    this.name = 'BranchAlreadyExistsError';
  }
}

export class CodexNotFoundError extends Error {
  constructor() {
    super('Codex CLI not found in PATH. Install it with: npm install -g @openai/codex');
    this.name = 'CodexNotFoundError';
  }
}

export class CodexTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Codex CLI timed out after ${timeoutMs}ms`);
    this.name = 'CodexTimeoutError';
  }
}

export class CodexExecutionError extends Error {
  constructor(
    public readonly stderr: string,
    public readonly exitCode: number,
  ) {
    super(`Codex CLI failed with exit code ${exitCode}: ${stderr}`);
    this.name = 'CodexExecutionError';
  }
}
