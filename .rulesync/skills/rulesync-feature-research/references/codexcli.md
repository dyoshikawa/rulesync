# Codex CLI Map

## Official Docs

| Feature       | Official docs                                                  | Upstream surface                                             |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| index         | `https://developers.openai.com/codex/llms.txt`                 | Docs index                                                   |
| `rules`       | `https://developers.openai.com/codex/guides/agents-md`         | `AGENTS.md` and override behavior                            |
| `mcp`         | `https://developers.openai.com/codex/mcp`                      | MCP server config, transports, authentication                |
| `commands`    | `https://developers.openai.com/codex/custom-prompts`           | `~/.codex/prompts/*.md`, metadata, arguments                 |
| `skills`      | `https://developers.openai.com/codex/skills`                   | `.agents/skills/<name>/SKILL.md`, metadata, supporting files |
| `subagents`   | `https://developers.openai.com/codex/subagents`                | Subagent files, fields, model and tool config                |
| `hooks`       | `https://developers.openai.com/codex/hooks`                    | Hook events, matcher patterns, hook JSON, feature flags      |
| `permissions` | `https://developers.openai.com/codex/agent-approvals-security` | Approval policy and sandbox behavior                         |
| `permissions` | `https://developers.openai.com/codex/config-reference`         | Config keys and profile overrides                            |
| `permissions` | `https://developers.openai.com/codex/rules`                    | Command execution rules files                                |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------- |
| `mcp`         | Codex config-shape converters in `codexcli-mcp.ts`                                       |
| `subagents`   | `CodexCliSubagentTomlSchema` in `codexcli-subagent.ts`                                   |
| `skills`      | `metadata.short-description` mapping in `codexcli-skill.ts`                              |
| `hooks`       | `CODEXCLI_HOOK_EVENTS`, event-name maps, converter config, and `CodexcliConfigToml`      |
| `permissions` | `CodexPermissionProfile`, Codex permission converters, and `createCodexcliBashRulesFile` |
