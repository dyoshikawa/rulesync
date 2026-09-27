# Codex CLI Map

## Official Docs

The `developers.openai.com/codex/*` URLs now redirect to `learn.chatgpt.com/docs/*` (observed 2026-09-26).

| Feature       | Official docs                                                  | Upstream surface                                             |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| index         | `https://learn.chatgpt.com/docs/llms.txt`                      | Docs index                                                   |
| `rules`       | `https://learn.chatgpt.com/docs/agent-configuration/agents-md` | `AGENTS.md` and override behavior                            |
| `ignore`      | No dedicated upstream ignore surface in map                    | No Rulesync-supported Codex CLI ignore target in map         |
| `mcp`         | `https://learn.chatgpt.com/docs/extend/mcp?surface=cli`        | MCP server config, transports, authentication                |
| `commands`    | `https://learn.chatgpt.com/docs/custom-prompts`                | `~/.codex/prompts/*.md`, metadata, arguments                 |
| `subagents`   | `https://learn.chatgpt.com/docs/agent-configuration/subagents` | Subagent files, fields, model and tool config                |
| `skills`      | `https://learn.chatgpt.com/docs/build-skills`                  | `.agents/skills/<name>/SKILL.md`, metadata, supporting files |
| `hooks`       | `https://learn.chatgpt.com/docs/hooks`                         | Hook events, matcher patterns, hook JSON, feature flags      |
| `permissions` | `https://learn.chatgpt.com/docs/agent-approvals-security`      | Approval policy and sandbox behavior                         |
| `permissions` | `https://learn.chatgpt.com/docs/config-file/config-reference`  | Config keys and profile overrides                            |
| `permissions` | `https://learn.chatgpt.com/docs/agent-configuration/rules`     | Command execution rules files                                |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------- |
| `mcp`         | Codex config-shape converters in `codexcli-mcp.ts`                                       |
| `subagents`   | `CodexCliSubagentTomlSchema` in `codexcli-subagent.ts`                                   |
| `skills`      | `metadata.short-description` mapping in `codexcli-skill.ts`                              |
| `hooks`       | `CODEXCLI_HOOK_EVENTS`, event-name maps, converter config, and `CodexcliConfigToml`      |
| `permissions` | `CodexPermissionProfile`, Codex permission converters, and `createCodexcliBashRulesFile` |
