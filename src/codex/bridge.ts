// src/codex/bridge.ts
import { spawn, spawnSync } from 'child_process';
import type { Brief } from '../session/types.js';
import { CodexNotFoundError, CodexTimeoutError, CodexExecutionError } from '../session/types.js';

const DEFAULT_TIMEOUT_MS = (() => {
  const parsed = parseInt(process.env['CODEX_MCP_TIMEOUT_MS'] ?? '', 10);
  return Number.isNaN(parsed) ? 300000 : parsed;
})();

// Codex CLI v0.100+ uses the `exec` subcommand for non-interactive runs.
// -s workspace-write  — allows the agent to write files in the worktree
// -s read-only        — used for chat (no file changes)
const CODEX_EXEC_WRITE_ARGS  = ['exec', '-s', 'workspace-write'];
const CODEX_EXEC_READONLY_ARGS = ['exec', '-s', 'read-only'];

export function findCodexCli(): string {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, ['codex'], { encoding: 'utf8', shell: false });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new CodexNotFoundError();
  }

  const lines = result.stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);

  if (process.platform === 'win32') {
    // On Windows, prefer .cmd shim (executable by spawn without shell)
    const cmdPath = lines.find((l) => l.toLowerCase().endsWith('.cmd'));
    if (cmdPath) return cmdPath;
    // Fall back to .exe if .cmd not found
    const exePath = lines.find((l) => l.toLowerCase().endsWith('.exe'));
    if (exePath) return exePath;
  }

  return lines[0];
}

export function buildChatPrompt(brief: Brief, message: string): string {
  return `You are a coding assistant. Answer the following question.
Do NOT modify any files in this response.

## Task Brief
Goal: ${brief.goal}
Constraints:
${brief.constraints.map((c) => `- ${c}`).join('\n') || '(none)'}
Decisions made so far:
${brief.decisions.map((d) => `- ${d}`).join('\n') || '(none)'}
Relevant files: ${brief.relevant_files.join(', ') || '(none)'}
Current focus: ${brief.current_focus || '(unset)'}

## Question
${message}`;
}

export function buildImplementPrompt(brief: Brief, extraInstructions?: string): string {
  return `You are a coding assistant. Complete the following task in the current directory.

## Task Brief
Goal: ${brief.goal}
Constraints:
${brief.constraints.map((c) => `- ${c}`).join('\n') || '(none)'}
Decisions made:
${brief.decisions.map((d) => `- ${d}`).join('\n') || '(none)'}
Relevant files: ${brief.relevant_files.join(', ') || '(none)'}
Current focus: ${brief.current_focus || '(unset)'}
${extraInstructions ? `\n## Additional Instructions\n${extraInstructions}` : ''}
Follow all constraints and decisions.`;
}

function runCodex(
  cwd: string,
  args: string[],
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const codexPath = findCodexCli();
    const child = spawn(codexPath, [...args, prompt], {
      cwd,
      shell: process.platform === 'win32', // .cmd files require shell on Windows
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new CodexTimeoutError(timeoutMs));
    }, timeoutMs);

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new CodexExecutionError(stderr, code ?? -1));
      }
    });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function runCodexChat(
  worktreePath: string,
  brief: Brief,
  message: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  return runCodex(worktreePath, CODEX_EXEC_READONLY_ARGS, buildChatPrompt(brief, message), timeoutMs);
}

export async function runCodexImplement(
  worktreePath: string,
  brief: Brief,
  extraInstructions?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  return runCodex(
    worktreePath,
    CODEX_EXEC_WRITE_ARGS,
    buildImplementPrompt(brief, extraInstructions),
    timeoutMs,
  );
}
