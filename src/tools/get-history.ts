// src/tools/get-history.ts
import { loadSession } from '../session/manager.js';
import type { HistoryEntry } from '../session/types.js';

export interface GetHistoryInput {
  session_id: string;
}

export interface GetHistoryOutput {
  history: HistoryEntry[];
}

export async function getHistory(input: GetHistoryInput): Promise<GetHistoryOutput> {
  const session = await loadSession(input.session_id);
  return { history: session.history };
}
