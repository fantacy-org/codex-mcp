// src/tools/implement.ts
import { loadSession, updateSession } from '../session/manager.js';
import { runCodexImplement } from '../codex/bridge.js';
import { getDiff as worktreeGetDiff } from '../worktree/manager.js';

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

  const diff_stat = worktreeGetDiff(session.worktreePath, true);
  await updateSession(input.session_id, { status: 'REVIEW' });

  const summary =
    detail.split('\n').find((l) => l.trim().length > 0) ?? detail.slice(0, 80);
  return { summary, detail, diff_stat };
}
