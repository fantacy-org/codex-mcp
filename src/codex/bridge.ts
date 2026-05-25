// src/codex/bridge.ts
import { spawn, spawnSync } from 'child_process';
import type { Brief } from '../session/types.js';
import { CodexNotFoundError, CodexTimeoutError, CodexExecutionError } from '../session/types.js';

const DEFAULT_TIMEOUT_MS = parseInt(
  process.env['CODEX_MCP_TIMEOUT_MS'] ?? '300000',
  10,
);

// Args passed to every Codex CLI invocation for non-interactive execution.
// Verify against installed Codex CLI version if behaviour is unexpected.
const CODEX_NONINTERACTIVE_ARGS = ['--approval-mode', 'full-auto'];

export function findCodexCli(): string {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, ['codex'], { encoding: 'utf8', shell: false });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new CodexNotFoundError();
  }
  return result.stdout.trim().split('\n')[0].trim();
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
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const codexPath = findCodexCli();
    const child = spawn(codexPath, [...CODEX_NONINTERACTIVE_ARGS, prompt], {
      cwd,
      shell: false,
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
  return runCodex(worktreePath, buildChatPrompt(brief, message), timeoutMs);
}

export async function runCodexImplement(
  worktreePath: string,
  brief: Brief,
  extraInstructions?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  return runCodex(
    worktreePath,
    buildImplementPrompt(brief, extraInstructions),
    timeoutMs,
  );
}
