# codex-mcp Design Spec

**Date:** 2026-05-25  
**Status:** Approved  

---

## Overview

`codex-mcp` is a stdio-based MCP (Model Context Protocol) server written in TypeScript/Node.js.
It acts as a middleware layer between Claude (acting as project manager) and the OpenAI Codex CLI
(acting as implementer). Claude dispatches coding tasks to Codex, can discuss design decisions
with Codex, and reviews the results — all via MCP tool calls.

**Key design constraints:**
- No persistent/daemon process. The server is spawned by Claude Code on demand via stdio transport and exits when done.
- Cross-platform: Windows and Linux.
- Session state is persisted to `~/.codex-mcp/sessions/<id>.json` so it survives across ephemeral invocations.

---

## Architecture

```
Claude Code
    │  stdio
    ▼
┌─────────────────────────────────────┐
│           codex-mcp (MCP Server)    │
│                                     │
│  ┌─────────────┐  ┌───────────────┐ │
│  │Session Mgr  │  │ Worktree Mgr  │ │
│  │~/.codex-mcp │  │(git worktree) │ │
│  │/sessions/   │  └───────────────┘ │
│  └─────────────┘                    │
│  ┌─────────────────────────────────┐│
│  │        Codex Bridge             ││
│  │  (spawn Codex CLI as child proc)││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
         │  child_process.spawn
         ▼
    Codex CLI (runs inside worktree)
```

### Modules

| Module | Responsibility |
|--------|---------------|
| MCP Server | stdio transport entry point; dispatches tool calls |
| Session Manager | Read/write `~/.codex-mcp/sessions/<id>.json` |
| Worktree Manager | Create and remove git worktrees and branches |
| Codex Bridge | Spawn the Codex CLI process, inject context, capture output |

---

## Session State

Each session is stored as a JSON file at `~/.codex-mcp/sessions/<uuid>.json`.

```json
{
  "id": "uuid-v4",
  "status": "DRAFTING",
  "task": "original task description",
  "projectPath": "/home/user/myproject",
  "worktreePath": "/home/user/myproject/.worktrees/task-<id>",
  "branch": "task/<id>",
  "brief": {
    "goal": "short description of what to build",
    "constraints": ["list of technical constraints"],
    "decisions": ["list of design decisions made"],
    "relevant_files": ["paths to relevant existing files"],
    "current_focus": "what we are currently working on"
  },
  "history": [
    { "role": "claude", "content": "...", "ts": "ISO8601" },
    { "role": "codex",  "content": "...", "ts": "ISO8601" }
  ],
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

### Status Machine

```
DRAFTING ──► IMPLEMENTING ──► REVIEW ──► MERGED
    ▲               │
    └───────────────┘
         (iterate)
```

| Status | Allowed operations |
|--------|--------------------|
| `DRAFTING` | `codex_chat`, `codex_update_brief`, `codex_implement` (triggers transition) |
| `IMPLEMENTING` | `codex_get_diff` (auto-transitions to REVIEW on completion) |
| `REVIEW` | `codex_get_diff`, `codex_merge`, or revert to `DRAFTING` for iteration |
| `MERGED` | `codex_delete_session` |

---

## MCP Tools

### Session Lifecycle

#### `codex_create_session`
Creates a new session and its git worktree.

**Input:**
```ts
{
  task: string;         // Human-readable task description
  project_path: string; // Absolute path to the git project root
}
```

**Output:**
```ts
{
  session_id: string;
  worktree_path: string;
  branch: string;
}
```

**Side effects:** Runs `git worktree add .worktrees/task-<id> -b task/<id>`.

---

#### `codex_delete_session`
Cleans up a session. Removes the worktree, deletes the branch, and removes the session file.
Intended to be called by Claude after a task is fully merged or abandoned.

**Input:**
```ts
{
  session_id: string;
  force?: boolean; // Remove worktree even if it has uncommitted changes (default: false)
}
```

**Output:**
```ts
{
  success: boolean;
  message: string;
}
```

---

### Brief Management

#### `codex_update_brief`
Claude calls this to update the task brief after each discussion turn.
The brief is the single source of truth Codex receives — keeping it updated is Claude's responsibility.

**Input:**
```ts
{
  session_id: string;
  brief: {
    goal?: string;
    constraints?: string[];
    decisions?: string[];
    relevant_files?: string[];
    current_focus?: string;
  };
}
```

**Output:**
```ts
{
  brief: Brief; // The updated brief
}
```

---

### Discussion

#### `codex_chat`
Sends a message to Codex. Codex receives the current brief plus the message.
Conversation history is NOT sent — only the brief + current message.
Codex responds with text; it does not modify files in this mode.

**Input:**
```ts
{
  session_id: string;
  message: string;
}
```

**Output:**
```ts
{
  summary: string;  // One-line summary (default view)
  detail: string;   // Full Codex response (expandable)
}
```

**Token model:** Each call costs ~(brief tokens) + (message tokens) + (response tokens). No history accumulation.

---

#### `codex_get_history`
Returns the full turn log for transparency. Does not call Codex.

**Input:**
```ts
{
  session_id: string;
}
```

**Output:**
```ts
{
  history: Array<{ role: "claude" | "codex"; content: string; ts: string }>;
}
```

---

### Implementation

#### `codex_implement`
Instructs Codex to implement based on the current brief. Codex may modify files in the worktree.
Transitions session status from `DRAFTING` to `IMPLEMENTING`, then to `REVIEW` on completion.

**Input:**
```ts
{
  session_id: string;
  extra_instructions?: string; // Optional additions beyond the brief
}
```

**Output:**
```ts
{
  summary: string;
  detail: string;
  diff_stat: string; // Short git diff --stat output
}
```

---

#### `codex_get_diff`
Returns the current git diff of the worktree.

**Input:**
```ts
{
  session_id: string;
  stat_only?: boolean; // If true, return only --stat (default: false)
}
```

**Output:**
```ts
{
  diff: string;
}
```

---

### Integration

#### `codex_merge`
Merges the task branch into the target branch. Removes the worktree after a successful merge.

**Input:**
```ts
{
  session_id: string;
  target_branch?: string; // Default: the branch that was current when session was created
}
```

**Output:**
```ts
{
  success: boolean;
  merged_into: string;
  conflicts?: string[]; // If merge conflicts occur, list them — do not auto-resolve
}
```

---

## Codex Bridge

Codex CLI is invoked via `child_process.spawn` (never `exec`), targeting the project worktree as its working directory.

**Context injection strategy:**
Each call to `codex_chat` or `codex_implement` constructs a prompt that includes:
1. The current task brief (structured, concise)
2. The current message or instructions
3. A system preamble describing Codex's role

Raw conversation history is never sent to Codex. The brief is the only persistent context.

**Timeout:** Configurable via env var `CODEX_MCP_TIMEOUT_MS` (default: 300000ms / 5 minutes).

---

## Error Handling

| Error scenario | Behavior |
|---------------|----------|
| Codex CLI not found | Detected at startup; returns a clear, actionable error message |
| Codex CLI timeout | Session reverts to previous status; error returned with timeout info |
| `git worktree add` fails | Session not created; no files left behind |
| Session file corrupted | Attempt partial recovery; if not possible, prompt user to run `codex_delete_session --force` |
| Merge conflict | Conflicts listed in response; not auto-resolved; Claude decides next step |

---

## Cross-Platform Compatibility

| Concern | Approach |
|---------|---------|
| Path separators | Use Node.js `path` module throughout; never hardcode `/` or `\` |
| Session directory | `os.homedir()` + `.codex-mcp/sessions/` |
| Codex CLI detection | `which codex` (Linux/macOS) / `where codex` (Windows), via `cross-spawn` or equivalent |
| Line endings | Enforce `LF` in the worktree via `.gitattributes`; normalise in output parsing |
| Child process | `child_process.spawn` with `shell: false`; avoid shell-specific behaviour |

---

## Project Structure

```
codex-mcp/
├── src/
│   ├── index.ts              # MCP server entry point (stdio transport)
│   ├── tools/                # One file per MCP tool
│   │   ├── create-session.ts
│   │   ├── delete-session.ts
│   │   ├── update-brief.ts
│   │   ├── chat.ts
│   │   ├── get-history.ts
│   │   ├── implement.ts
│   │   ├── get-diff.ts
│   │   └── merge.ts
│   ├── session/
│   │   ├── manager.ts        # Read/write session JSON files
│   │   └── types.ts          # Session, Brief, Status types
│   ├── worktree/
│   │   └── manager.ts        # git worktree create/remove
│   └── codex/
│       └── bridge.ts         # Spawn Codex CLI, inject context, parse output
├── src/
│   └── __tests__/
│       ├── unit/
│       │   ├── session-manager.test.ts
│       │   ├── worktree-manager.test.ts
│       │   └── codex-bridge.test.ts
│       ├── integration/
│       │   ├── create-session.test.ts
│       │   ├── chat.test.ts
│       │   ├── implement.test.ts
│       │   ├── merge.test.ts
│       │   └── delete-session.test.ts
│       └── e2e/
│           ├── happy-path.test.ts
│           ├── iteration-loop.test.ts
│           └── error-recovery.test.ts
├── docs/
│   └── superpowers/specs/
│       └── 2026-05-25-codex-mcp-design.md
├── package.json
├── tsconfig.json
└── README.md
```

---

## Testing

Tests are split into three layers: unit, integration, and end-to-end scenarios.
Codex CLI is always mocked in automated tests — real Codex invocations are reserved for manual verification.

### Unit Tests

#### Session Manager
| Test | Expected |
|------|----------|
| `createSession` writes a valid JSON file to `~/.codex-mcp/sessions/` | File exists with correct schema |
| `loadSession` returns the correct session object | Matches written data |
| `updateSession` persists partial updates without losing other fields | Merged correctly |
| `deleteSession` removes the file | File no longer exists |
| `loadSession` on non-existent ID | Throws `SessionNotFoundError` |
| `loadSession` on a corrupted JSON file | Throws `SessionCorruptedError` with file path |

#### Worktree Manager
| Test | Expected |
|------|----------|
| `createWorktree` in a valid git repo | Worktree directory exists; branch created |
| `removeWorktree` on existing worktree | Directory removed; branch deleted |
| `createWorktree` in a non-git directory | Throws `NotAGitRepoError` |
| `removeWorktree` on non-existent worktree | Returns gracefully without error |
| `createWorktree` when branch name already exists | Throws `BranchAlreadyExistsError` |

#### Codex Bridge
| Test | Expected |
|------|----------|
| Codex CLI not in PATH | Throws `CodexNotFoundError` with install hint |
| Prompt construction for `chat` | Output contains brief fields and message; no raw history |
| Prompt construction for `implement` | Output contains brief fields and extra_instructions |
| Codex process exceeds timeout | Rejects with `CodexTimeoutError`; process killed |
| Codex process exits with non-zero code | Rejects with `CodexExecutionError` containing stderr |

### Integration Tests
_(All Codex CLI calls are replaced with a stub that echoes a pre-defined response)_

| Test | Expected |
|------|----------|
| `codex_create_session` → session file + worktree created | Both exist; status = `DRAFTING` |
| `codex_update_brief` → brief fields updated in session file | Correct values persisted |
| `codex_chat` → response returned; history appended | `summary` and `detail` present; history has 2 new entries |
| `codex_implement` → status transitions `DRAFTING → IMPLEMENTING → REVIEW` | Final status = `REVIEW` |
| `codex_get_diff` → returns git diff of worktree | Diff string returned (may be empty for stub) |
| `codex_merge` (no conflict) → branch merged; worktree removed | `success: true`; worktree dir gone |
| `codex_merge` (with conflict) → conflicts listed; worktree intact | `conflicts` array non-empty; worktree still exists |
| `codex_delete_session` → session file + branch removed | File gone; `git branch -a` does not list task branch |

### End-to-End Scenarios
_(Manual verification or CI with a real isolated git repo; Codex CLI still stubbed)_

| Scenario | Steps | Pass criteria |
|----------|-------|---------------|
| **Happy path** | create → update_brief → chat → implement → get_diff → merge → delete | All tools return success; no leftover files or branches |
| **Iteration loop** | create → implement → review diff → update_brief → implement again → merge → delete | Second implement reflects updated brief; final diff shows both iterations |
| **Worktree creation failure** | create_session on a path that is not a git repo | Error returned; no session file created; no partial state |
| **Timeout recovery** | chat with stub that hangs past timeout | `CodexTimeoutError` returned; session status unchanged |
| **Merge conflict** | create two sessions that modify the same line; merge first, then second | Second merge returns `conflicts` list; user can resolve manually |
| **Abandon task** | create → implement → delete (force) without merge | Worktree removed; branch deleted; session file gone |
| **Cross-platform paths** | Run happy path on both Windows and Linux with project path containing spaces | All paths resolved correctly; no shell escaping errors |

### Test File Structure

```
codex-mcp/
└── src/
    └── __tests__/
        ├── unit/
        │   ├── session-manager.test.ts
        │   ├── worktree-manager.test.ts
        │   └── codex-bridge.test.ts
        ├── integration/
        │   ├── create-session.test.ts
        │   ├── chat.test.ts
        │   ├── implement.test.ts
        │   ├── merge.test.ts
        │   └── delete-session.test.ts
        └── e2e/
            ├── happy-path.test.ts
            ├── iteration-loop.test.ts
            └── error-recovery.test.ts
```

Test framework: **Vitest** (fast, TypeScript-native, compatible with Node.js).  
Git operations in tests use a temporary directory created per test suite and cleaned up in `afterAll`.

---

## Typical Workflow

```
1. Claude calls codex_create_session(task, project_path)
   → worktree created, session in DRAFTING

2. Claude calls codex_update_brief(session_id, { goal, constraints, ... })
   → brief established

3. Claude calls codex_chat(session_id, "What's the best approach for X?")
   → Codex responds based on brief; Claude may call codex_update_brief to record the decision

4. Claude calls codex_implement(session_id)
   → Codex implements in worktree; session moves to REVIEW

5. Claude calls codex_get_diff(session_id)
   → Reviews changes

6. If unsatisfied: Claude updates brief and calls codex_implement again (back to DRAFTING → REVIEW loop)

7. Claude calls codex_merge(session_id)
   → Branch merged into main; worktree removed; session moves to MERGED

8. Claude calls codex_delete_session(session_id)
   → Session file removed; cleanup complete
```
