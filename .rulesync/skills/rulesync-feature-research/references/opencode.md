# OpenCode Map

## Official Docs

| Feature       | Official docs                              | Upstream surface                                                                              |
| ------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| index         | `https://opencode.ai/docs/`                | OpenCode docs index                                                                           |
| `rules`       | `https://opencode.ai/docs/rules/`          | `AGENTS.md`, global `~/.config/opencode/AGENTS.md`, Claude Code compatibility, `instructions` |
| `ignore`      | No dedicated OpenCode ignore surface found | No Rulesync OpenCode ignore target                                                            |
| `mcp`         | `https://opencode.ai/docs/mcp-servers/`    | `opencode.json` `mcp`, `local`/`remote` servers, `environment`, `enabled`, tool gates         |
| `commands`    | `https://opencode.ai/docs/commands/`       | `.opencode/commands/*.md`, `~/.config/opencode/commands`, config `command` entries            |
| `subagents`   | `https://opencode.ai/docs/agents/`         | `.opencode/agent/*.md`, `~/.config/opencode/agent`, agent modes, tools, permissions           |
| `skills`      | `https://opencode.ai/docs/skills/`         | `.opencode/skills/<name>/SKILL.md`, compatible `.claude/skills`, `.agents/skills`, metadata   |
| `hooks`       | `https://opencode.ai/docs/plugins/`        | Plugin events such as `session.created`, `tool.execute.before`, `permission.asked`            |
| `permissions` | `https://opencode.ai/docs/permissions`     | `permission` config, `allow`/`ask`/`deny`, granular tool rules, per-agent overrides           |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules`       | `AGENTS.md`, `.opencode/memories`, global `.config/opencode/AGENTS.md`, and Agents.md-style conversion in `opencode-rule.ts`                    |
| `mcp`         | OpenCode `local`/`remote` MCP conversion, `environment`, `enabled`, JSON/JSONC fallback, and tool-filter map in `opencode-mcp.ts`               |
| `commands`    | OpenCode command frontmatter fields and project/global command paths in `opencode-command.ts`                                                   |
| `subagents`   | OpenCode-style agent frontmatter, `mode`, name fallback, and `.opencode/agent` paths in `opencode-subagent.ts` and `opencode-style-subagent.ts` |
| `skills`      | OpenCode skill schema, `allowed-tools`, and project/global skill paths in `opencode-skill.ts`                                                   |
| `hooks`       | `OPENCODE_HOOK_EVENTS`, dot-notation event maps, and generated plugin code in `opencode-hooks.ts` and `opencode-style-generator.ts`             |
| `permissions` | OpenCode `permission` object normalization, JSON/JSONC fallback, and shorthand expansion in `opencode-permissions.ts`                           |
