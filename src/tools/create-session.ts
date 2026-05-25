// src/tools/create-session.ts
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { saveSession } from '../session/manager.js';
import { createWorktree } from '../worktree/manager.js';
import { EMPTY_BRIEF } from '../session/types.js';
import type { Session } from '../session/types.js';

export interface CreateSessionInput {
  task: string;
  project_path: string;
}

export interface CreateSessionOutput {
  session_id: string;
  worktree_path: string;
  branch: string;
}

export async function createSession(
  input: CreateSessionInput,
): Promise<CreateSessionOutput> {
  const id = uuidv4();
  const shortId = id.slice(0, 8);
  const branch = `task/${shortId}`;
  const worktreePath = path.join(input.project_path, '.worktrees', `task-${shortId}`);
  const now = new Date().toISOString();

  createWorktree(input.project_path, worktreePath, branch);

  const session: Session = {
    id,
    status: 'DRAFTING',
    task: input.task,
    projectPath: input.project_path,
    worktreePath,
    branch,
    brief: { ...EMPTY_BRIEF },
    history: [],
    createdAt: now,
    updatedAt: now,
  };

  await saveSession(session);
  return { session_id: id, worktree_path: worktreePath, branch };
}
