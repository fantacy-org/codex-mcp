// src/tools/delete-session.ts
import { loadSession, deleteSession } from '../session/manager.js';
import { removeWorktree } from '../worktree/manager.js';

export interface DeleteSessionInput {
  session_id: string;
  force?: boolean;
}

export interface DeleteSessionOutput {
  success: boolean;
  message: string;
}

export async function deleteSessionTool(
  input: DeleteSessionInput,
): Promise<DeleteSessionOutput> {
  const session = await loadSession(input.session_id);
  removeWorktree(session.projectPath, session.worktreePath, session.branch, input.force ?? false);
  await deleteSession(input.session_id);
  return { success: true, message: `Session ${input.session_id} deleted.` };
}
