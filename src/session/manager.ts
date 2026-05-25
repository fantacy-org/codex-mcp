// src/session/manager.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { Session } from './types.js';
import { SessionNotFoundError, SessionCorruptedError } from './types.js';

export function getSessionsDir(): string {
  return (
    process.env['CODEX_MCP_SESSIONS_DIR'] ??
    path.join(os.homedir(), '.codex-mcp', 'sessions')
  );
}

function sessionFilePath(id: string): string {
  return path.join(getSessionsDir(), `${id}.json`);
}

async function ensureSessionsDir(): Promise<void> {
  await fs.mkdir(getSessionsDir(), { recursive: true });
}

export async function saveSession(session: Session): Promise<void> {
  await ensureSessionsDir();
  await fs.writeFile(
    sessionFilePath(session.id),
    JSON.stringify(session, null, 2),
    'utf8',
  );
}

export async function loadSession(id: string): Promise<Session> {
  const filePath = sessionFilePath(id);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new SessionNotFoundError(id);
    }
    throw err;
  }
  try {
    return JSON.parse(raw) as Session;
  } catch {
    throw new SessionCorruptedError(filePath);
  }
}

export async function updateSession(
  id: string,
  updates: Partial<Session>,
): Promise<Session> {
  const session = await loadSession(id);
  const updated: Session = {
    ...session,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  await saveSession(updated);
  return updated;
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await fs.unlink(sessionFilePath(id));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
