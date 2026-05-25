// src/tools/get-diff.ts
import { loadSession } from '../session/manager.js';
import { getDiff as worktreeGetDiff } from '../worktree/manager.js';

export interface GetDiffInput {
  session_id: string;
  stat_only?: boolean;
}

export interface GetDiffOutput {
  diff: string;
}

export async function getDiff(input: GetDiffInput): Promise<GetDiffOutput> {
  const session = await loadSession(input.session_id);
  const diff = worktreeGetDiff(session.worktreePath, input.stat_only ?? false);
  return { diff };
}
