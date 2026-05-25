// src/tools/chat.ts
import { loadSession, updateSession } from '../session/manager.js';
import { runCodexChat } from '../codex/bridge.js';
import type { HistoryEntry } from '../session/types.js';

export interface ChatInput {
  session_id: string;
  message: string;
}

export interface ChatOutput {
  summary: string;
  detail: string;
}

export async function chat(input: ChatInput): Promise<ChatOutput> {
  const session = await loadSession(input.session_id);
  const ts = new Date().toISOString();

  const claudeEntry: HistoryEntry = { role: 'claude', content: input.message, ts };
  const detail = await runCodexChat(session.worktreePath, session.brief, input.message);
  const codexEntry: HistoryEntry = { role: 'codex', content: detail, ts: new Date().toISOString() };

  await updateSession(input.session_id, {
    history: [...session.history, claudeEntry, codexEntry],
  });

  const summary = detail.split('\n').find((l) => l.trim().length > 0) ?? detail.slice(0, 80);
  return { summary, detail };
}
