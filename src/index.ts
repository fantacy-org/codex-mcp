// src/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createSession } from './tools/create-session.js';
import { deleteSessionTool } from './tools/delete-session.js';
import { updateBrief } from './tools/update-brief.js';
import { chat } from './tools/chat.js';
import { getHistory } from './tools/get-history.js';
import { implement } from './tools/implement.js';
import { getDiff } from './tools/get-diff.js';
import { merge } from './tools/merge.js';
import { findCodexCli } from './codex/bridge.js';

// Validate Codex CLI is present at startup
try {
  findCodexCli();
} catch (err) {
  process.stderr.write(`[codex-mcp] ${(err as Error).message}\n`);
  process.exit(1);
}

const server = new Server(
  { name: 'codex-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'codex_create_session',
      description: 'Create a new task session with an isolated git worktree.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Human-readable task description' },
          project_path: { type: 'string', description: 'Absolute path to the git project root' },
        },
        required: ['task', 'project_path'],
      },
    },
    {
      name: 'codex_delete_session',
      description: 'Clean up a session: remove worktree, branch, and session file. Call after task is merged or abandoned.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          force: { type: 'boolean', description: 'Remove worktree even if it has uncommitted changes' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'codex_update_brief',
      description: 'Update the task brief. The brief is the only context Codex receives — keep it accurate.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          brief: {
            type: 'object',
            properties: {
              goal: { type: 'string' },
              constraints: { type: 'array', items: { type: 'string' } },
              decisions: { type: 'array', items: { type: 'string' } },
              relevant_files: { type: 'array', items: { type: 'string' } },
              current_focus: { type: 'string' },
            },
          },
        },
        required: ['session_id', 'brief'],
      },
    },
    {
      name: 'codex_chat',
      description: 'Ask Codex a question. Codex responds based on the brief only — no file modifications.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['session_id', 'message'],
      },
    },
    {
      name: 'codex_get_history',
      description: 'Get the full Claude ↔ Codex conversation log for a session.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'codex_implement',
      description: 'Instruct Codex to implement the task brief. Codex may modify files in the worktree.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          extra_instructions: { type: 'string', description: 'Optional additions to the brief for this run' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'codex_get_diff',
      description: 'Get the current git diff of the task worktree.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          stat_only: { type: 'boolean', description: 'Return only --stat summary (default: false)' },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'codex_merge',
      description: 'Merge the task branch into the target branch. Does not auto-resolve conflicts.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          target_branch: { type: 'string', description: 'Branch to merge into (default: current branch of project)' },
        },
        required: ['session_id'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    if (name === 'codex_create_session') {
      result = await createSession(args as unknown as Parameters<typeof createSession>[0]);
    } else if (name === 'codex_delete_session') {
      result = await deleteSessionTool(args as unknown as Parameters<typeof deleteSessionTool>[0]);
    } else if (name === 'codex_update_brief') {
      result = await updateBrief(args as unknown as Parameters<typeof updateBrief>[0]);
    } else if (name === 'codex_chat') {
      result = await chat(args as unknown as Parameters<typeof chat>[0]);
    } else if (name === 'codex_get_history') {
      result = await getHistory(args as unknown as Parameters<typeof getHistory>[0]);
    } else if (name === 'codex_implement') {
      result = await implement(args as unknown as Parameters<typeof implement>[0]);
    } else if (name === 'codex_get_diff') {
      result = await getDiff(args as unknown as Parameters<typeof getDiff>[0]);
    } else if (name === 'codex_merge') {
      result = await merge(args as unknown as Parameters<typeof merge>[0]);
    } else {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: message }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
