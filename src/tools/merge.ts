// src/tools/merge.ts
import { loadSession, updateSession } from '../session/manager.js';
import { mergeBranch, removeWorktree, getCurrentBranch } from '../worktree/manager.js';

export interface MergeInput {
  session_id: string;
  target_branch?: string;
}

export interface MergeOutput {
  success: boolean;
  merged_into: string;
  conflicts?: string[];
}

export async function merge(input: MergeInput): Promise<MergeOutput> {
  const session = await loadSession(input.session_id);
  const targetBranch =
    input.target_branch ?? getCurrentBranch(session.projectPath);

  const { success, conflicts } = mergeBranch(session.projectPath, session.branch);

  if (!success) {
    return { success: false, merged_into: targetBranch, conflicts };
  }

  removeWorktree(session.projectPath, session.worktreePath, session.branch);
  await updateSession(input.session_id, { status: 'MERGED' });

  return { success: true, merged_into: targetBranch };
}
