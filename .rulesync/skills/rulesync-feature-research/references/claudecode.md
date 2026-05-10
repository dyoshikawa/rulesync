# Claude Code Map

## Official Docs

| Feature       | Official docs                                              | Upstream surface                                             |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| index         | `https://code.claude.com/docs/llms.txt`                    | Docs index                                                   |
| `rules`       | `https://code.claude.com/docs/en/memory`                   | `CLAUDE.md`, project memory, imports, discovery, precedence  |
| `mcp`         | `https://code.claude.com/docs/en/mcp`                      | MCP scopes, transports, CLI-managed servers                  |
| `commands`    | `https://code.claude.com/docs/en/agent-sdk/slash-commands` | `.claude/commands/<name>.md`, metadata, arguments            |
| `skills`      | `https://code.claude.com/docs/en/skills`                   | `.claude/skills/<name>/SKILL.md`, metadata, supporting files |
| `subagents`   | `https://code.claude.com/docs/en/sub-agents`               | `.claude/agents/<name>.md`, fields, tool selection           |
| `hooks`       | `https://code.claude.com/docs/en/hooks`                    | Hook events, matchers, and `.claude/settings.json` commands  |
| `permissions` | `https://code.claude.com/docs/en/permissions`              | Permission rules and settings behavior                       |
| `ignore`      | `https://code.claude.com/docs/en/permissions`              | `permissions.deny` read rules in Claude settings             |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------- |
| `skills`      | Scheduled-task routing in `claudecode-skill.ts` and `skills-processor.ts`                    |
| `hooks`       | `CLAUDE_HOOK_EVENTS`, event-name maps, no-matcher events, and converter config               |
| `permissions` | Claude tool-name maps, permission converters, and merge logic in `claudecode-permissions.ts` |
| `ignore`      | `ClaudecodeIgnoreFileMode` and `Read(...)` deny conversion in `claudecode-ignore.ts`         |
