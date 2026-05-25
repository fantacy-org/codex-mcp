// src/tools/update-brief.ts
import { loadSession, updateSession } from '../session/manager.js';
import type { Brief } from '../session/types.js';

export interface UpdateBriefInput {
  session_id: string;
  brief: Partial<Brief>;
}

export interface UpdateBriefOutput {
  brief: Brief;
}

export async function updateBrief(input: UpdateBriefInput): Promise<UpdateBriefOutput> {
  const session = await loadSession(input.session_id);
  const mergedBrief: Brief = { ...session.brief, ...input.brief };
  const updated = await updateSession(input.session_id, { brief: mergedBrief });
  return { brief: updated.brief };
}
