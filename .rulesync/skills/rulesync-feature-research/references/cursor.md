# Cursor Map

## Official Docs

| Feature       | Official docs                                          | Upstream surface                                                                                   |
| ------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| index         | `https://docs.cursor.com/en/cli/using`                 | Cursor CLI overview, rules, MCP, command approval, non-interactive mode                            |
| `rules`       | `https://docs.cursor.com/context/rules`                | `.cursor/rules/*.mdc`, User Rules, `AGENTS.md`, `.cursorrules` legacy                              |
| `ignore`      | `https://docs.cursor.com/en/context/ignore-files`      | `.cursorignore` and global ignore settings                                                         |
| `mcp`         | `https://docs.cursor.com/cli/mcp`                      | Cursor CLI MCP, shared `mcp.json` configuration, project/global/nested precedence                  |
| `commands`    | `https://docs.cursor.com/en/agent/chat/commands`       | `.cursor/commands/*.md`, reusable slash-command workflows                                          |
| `subagents`   | `https://cursor.com/docs/plugins`                      | Plugin-bundled agents/subagents and marketplace surfaces                                           |
| `skills`      | `https://cursor.com/docs/plugins`                      | Plugin-bundled skills and marketplace surfaces                                                     |
| `hooks`       | `https://cursor.com/docs/hooks`                        | `.cursor/hooks.json`, hook events, command/prompt hook entries                                     |
| `permissions` | `https://docs.cursor.com/en/cli/reference/permissions` | `.cursor/cli.json`, `~/.cursor/cli-config.json`, `Shell`, `Read`, `Write`, `WebFetch`, `Mcp` rules |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `rules`       | Cursor MDC frontmatter, nested `.cursor/rules`, and `.md` to `.mdc` conversion in `cursor-rule.ts`    |
| `ignore`      | `.cursorignore` conversion in `cursor-ignore.ts`                                                      |
| `mcp`         | Cursor env interpolation conversion and `.cursor/mcp.json` merge behavior in `cursor-mcp.ts`          |
| `commands`    | Cursor command frontmatter passthrough, `description`, and `handoffs` handling in `cursor-command.ts` |
| `subagents`   | `.cursor/agents/*.md` frontmatter schema and project/global path handling in `cursor-subagent.ts`     |
| `skills`      | `.cursor/skills/<name>/SKILL.md` schema and supporting-file copy in `cursor-skill.ts`                 |
| `hooks`       | `CURSOR_HOOK_EVENTS`, event-name maps, and `.cursor/hooks.json` conversion in `cursor-hooks.ts`       |
| `permissions` | Cursor permission token maps, `ask` skip behavior, and config merge logic in `cursor-permissions.ts`  |
