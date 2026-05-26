// src/tools/implement.ts
import { spawnSync } from 'child_process';
import { loadSession, updateSession } from '../session/manager.js';
import { runCodexImplement } from '../codex/bridge.js';
import { getDiff as worktreeGetDiff } from '../worktree/manager.js';

/**
 * Auto-commit any files Codex left uncommitted in the worktree.
 * The Codex CLI writes files but may fail to commit (e.g. workspace-write
 * sandbox blocking .git writes in older setups); we commit here as a fallback
 * so that getDiff (HEAD~1..HEAD) has something to show.
 * Returns true if a commit was made, false if the tree was already clean.
 *
 * @param worktreePath - absolute path to the git worktree
 * @param goal - brief.goal used as the commit message subject (≤72 chars)
 */
function autoCommitWorktree(worktreePath: string, goal?: string): boolean {
  const git = (args: string[]) =>
    spawnSync('git', args, { cwd: worktreePath, encoding: 'utf8', shell: false });

  // Stage everything (new + modified; deleted files too)
  git(['add', '-A']);

  // Check if there is anything to commit
  const status = git(['status', '--porcelain']);
  if (!status.stdout.trim()) return false;

  const message = goal ? goal.slice(0, 72) : 'chore: codex implementation';
  git([
    '-c', 'user.email=codex-mcp@local',
    '-c', 'user.name=codex-mcp',
    'commit', '-m', message,
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

  // Commit any files Codex left uncommitted so getDiff has a HEAD to diff against.
  // Prefer brief.goal (refined planning goal); fall back to session.task (original description).
  autoCommitWorktree(session.worktreePath, session.brief.goal || session.task);

  const diff_stat = worktreeGetDiff(session.worktreePath, true);
  await updateSession(input.session_id, { status: 'REVIEW' });

  const summary =
    detail.split('\n').find((l) => l.trim().length > 0) ?? detail.slice(0, 80);
  return { summary, detail, diff_stat };
}
