# codex-mcp

A stdio-based MCP server that lets Claude act as a project manager and delegate coding tasks to the [OpenAI Codex CLI](https://github.com/openai/codex).

## How it works

- Each task gets an isolated **git worktree** and a **task brief** (structured JSON).
- Claude dispatches work via 8 MCP tools: discuss, implement, review diff, merge.
- Codex CLI only receives the current brief + message — not raw conversation history — keeping token costs flat.
- No daemon process. The server is spawned by Claude Code on demand and exits when done.

## Requirements

- Node.js 22+
- Git 2.5+ (worktree support)
- [OpenAI Codex CLI](https://github.com/openai/codex) installed and in PATH

```bash
npm install -g @openai/codex
```

## Installation

```bash
git clone https://github.com/fantacy1031-star/codex-mcp.git
cd codex-mcp
npm install
npm run build
```

## Claude Code Configuration

Add to your Claude Code MCP config (`.claude/mcp.json` or global settings):

```json
{
  "mcpServers": {
    "codex-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/codex-mcp/dist/index.js"]
    }
  }
}
```

## Session Storage

Sessions are stored in `~/.codex-mcp/sessions/`. Each session file is a JSON document containing the task brief, status, and conversation history.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEX_MCP_TIMEOUT_MS` | `300000` (5 min) | Timeout for each Codex CLI invocation |
| `CODEX_MCP_SESSIONS_DIR` | `~/.codex-mcp/sessions` | Override session storage directory (useful for testing) |

## Available Tools

| Tool | Description |
|------|-------------|
| `codex_create_session` | Start a new task with an isolated git worktree |
| `codex_update_brief` | Update the task brief (goal, constraints, decisions) |
| `codex_chat` | Ask Codex a question based on the brief (no file changes) |
| `codex_get_history` | Get the full Claude ↔ Codex conversation log |
| `codex_implement` | Instruct Codex to implement the task brief |
| `codex_get_diff` | Get the current git diff of the worktree |
| `codex_merge` | Merge the task branch into the main branch |
| `codex_delete_session` | Clean up session files, worktree, and branch |

## Development

```bash
npm test          # run all tests
npm run typecheck # type-check without building
npm run build     # compile to dist/
```
