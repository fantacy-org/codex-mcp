# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build       # compile TypeScript → dist/
npm test            # run all tests (vitest run)
npm run test:watch  # run tests in watch mode
npm run typecheck   # type-check without emitting
npm run dev         # run via tsx (no compile step, for quick iteration)
```

Run a single test file:
```bash
npx vitest run src/__tests__/unit/session-manager.test.ts
```

## Architecture

**codex-mcp** is a stdio MCP server. Claude spawns it as an MCP server process; Claude then calls the 8 exposed tools to delegate coding tasks to the OpenAI Codex CLI. Codex runs in an isolated git worktree for each task.

### Module layout

```
src/
  index.ts              # MCP server entry: registers tools, routes CallTool requests
  session/
    types.ts            # Session, Brief, HistoryEntry types + custom Error subclasses
    manager.ts          # CRUD for session JSON files (~/.codex-mcp/sessions/<id>.json)
  worktree/
    manager.ts          # git worktree create/remove, getDiff, mergeBranch (all via spawnSync)
  codex/
    bridge.ts           # spawns Codex CLI process; builds chat/implement prompts
  tools/                # one file per MCP tool; thin handlers calling session/worktree/bridge
    create-session.ts   # creates worktree + session file
    implement.ts        # calls runCodexImplement, manages IMPLEMENTING→REVIEW status
    merge.ts            # merges task branch, removes worktree on success
    ...
  __tests__/
    unit/               # isolated tests for manager, bridge, worktree
    integration/        # tool handler tests (mocks git/Codex)
    e2e/scenarios.test.ts  # full flow tests against a real temp git repo; mocks codex/bridge.js
```

### Data flow

1. `codex_create_session` → creates a `task/<shortId>` branch + worktree at `<project>/.worktrees/task-<shortId>`, saves session JSON (status: `DRAFTING`).
2. `codex_update_brief` → patches the in-session `Brief` object (goal, constraints, decisions, relevant_files, current_focus). **The brief is the only context Codex ever sees.**
3. `codex_implement` → sets status `IMPLEMENTING`, spawns Codex CLI with `--approval-mode full-auto` in the worktree directory, reverts to `DRAFTING` on error, sets `REVIEW` on success.
4. `codex_merge` → runs `git merge --no-ff` on the project repo, removes worktree on success, sets status `MERGED`.
5. `codex_delete_session` → removes worktree, branch, and session file.

### Session status transitions

`DRAFTING` → `IMPLEMENTING` → `REVIEW` → `MERGED`

On Codex failure during implement, status reverts to `DRAFTING` so the session stays usable.

### Key design decisions

- **No history passed to Codex.** Codex receives only the structured `Brief`, keeping token costs flat across iterations.
- **Sessions dir is env-configurable.** Tests use `CODEX_MCP_SESSIONS_DIR` (via `vi.stubEnv`) to isolate from `~/.codex-mcp/sessions`.
- **Codex CLI detection at startup.** `findCodexCli()` is called in `index.ts` before the server starts; it exits with code 1 if `codex` is not in PATH.
- **Windows support.** `findCodexCli` prefers `.cmd` shims; `runCodex` passes `shell: true` on Windows so `.cmd` files are executable.
- **getDiff shows the last commit, not the working tree.** It uses `HEAD~1..HEAD` (or `--cached` for initial commits), because Codex commits its changes before returning.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CODEX_MCP_TIMEOUT_MS` | `300000` | Timeout per Codex CLI invocation |
| `CODEX_MCP_SESSIONS_DIR` | `~/.codex-mcp/sessions` | Session storage directory |

### Testing patterns

- Unit tests use `vi.stubEnv('CODEX_MCP_SESSIONS_DIR', tempDir)` + `vi.resetModules()` + dynamic `import()` to get a fresh module instance per test.
- E2E tests mock `../../codex/bridge.js` entirely (no real Codex CLI needed) but run against a real temp git repo.
- Test timeout is 30 seconds (set in `vitest.config.ts`).
