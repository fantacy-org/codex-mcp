// src/tools/implement.ts
import { spawnSync } from 'child_process';
import { loadSession, updateSession } from '../session/manager.js';
import { runCodexImplement } from '../codex/bridge.js';
import { getDiff as worktreeGetDiff } from '../worktree/manager.js';

/**
 * Auto-commit any files Codex left uncommitted in the worktree.
 * The Codex CLI writes files but does not always commit them; we commit
 * here so that getDiff (HEAD~1..HEAD) has something to show.
 * Returns true if a commit was made, false if the tree was already clean.
 */
function autoCommitWorktree(worktreePath: string): boolean {
  const git = (args: string[]) =>
    spawnSync('git', args, { cwd: worktreePath, encoding: 'utf8', shell: false });

  // Stage everything (new + modified; deleted files too)
  git(['add', '-A']);

  // Check if there is anything to commit
  const status = git(['status', '--porcelain']);
  if (!status.stdout.trim()) return false;

  git([
    '-c', 'user.email=codex-mcp@local',
    '-c', 'user.name=codex-mcp',
    'commit', '-m', 'chore: codex implementation',
  ]);
  return true;
}

export interface ImplementInput {
  session_id: string;
  extra_instructions?: string;
}

export interface ImplementOutput {
  summary: string;
  detail: string;
  diff_stat: string;
}

export async function implement(input: ImplementInput): Promise<ImplementOutput> {
  const session = await loadSession(input.session_id);

  await updateSession(input.session_id, { status: 'IMPLEMENTING' });

  let detail: string;
  try {
    detail = await runCodexImplement(
      session.worktreePath,
      session.brief,
      input.extra_instructions,
    );
  } catch (err) {
    // Revert status to DRAFTING so the session remains usable
    await updateSession(input.session_id, { status: 'DRAFTING' });
    throw err;
  }

  // Commit any files Codex left uncommitted so getDiff has a HEAD to diff against
  autoCommitWorktree(session.worktreePath);

  const diff_stat = worktreeGetDiff(session.worktreePath, true);
  await updateSession(input.session_id, { status: 'REVIEW' });

  const summary =
    detail.split('\n').find((l) => l.trim().length > 0) ?? detail.slice(0, 80);
  return { summary, detail, diff_stat };
}
