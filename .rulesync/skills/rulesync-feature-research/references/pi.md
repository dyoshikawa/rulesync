# Pi Coding Agent Map

## Official Docs

| Feature       | Official docs                                                                             | Upstream surface                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| index         | `https://pi.dev/docs/latest`                                                              | Pi Coding Agent documentation index                                                                                                    |
| `rules`       | `https://pi.dev/docs/latest/usage`                                                        | `AGENTS.md`, `CLAUDE.md`, global `~/.pi/agent/AGENTS.md`, context-file discovery, `SYSTEM.md` / `APPEND_SYSTEM.md` system-prompt files |
| `ignore`      | No dedicated upstream ignore surface in map                                               | No Rulesync-supported Pi ignore target in map                                                                                          |
| `mcp`         | No dedicated upstream MCP surface in map                                                  | No Rulesync-supported Pi MCP target in map                                                                                             |
| `commands`    | `https://pi.dev/docs/latest/prompt-templates`                                             | `.pi/prompts/*.md`, `~/.pi/agent/prompts/*.md`, prompt template frontmatter and `/name` commands                                       |
| `subagents`   | No dedicated upstream subagents surface in map                                            | No Rulesync-supported Pi subagents target in map                                                                                       |
| `skills`      | `https://pi.dev/docs/latest/skills`                                                       | `.pi/skills`, `~/.pi/agent/skills`, `.agents/skills`, packages, settings, `--skill`                                                    |
| `hooks`       | `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md` | Extension lifecycle events (`session_start`, `tool_call`, `context`, `message_end`, `agent_end`, …) bridged via a generated extension  |
| `permissions` | No dedicated upstream permissions surface in map                                          | Tool selection and settings exist upstream                                                                                             |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface    | Anchor                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `rules`    | Project and global context-file conversion in `pi-rule.ts`                                                       |
| `commands` | `.pi/prompts`, `~/.pi/agent/prompts`, `argument-hint`, and prompt template conversion in `pi-command.ts`         |
| `skills`   | `.pi/skills`, global `.pi/agent/skills`, and Agent Skills conversion in `pi-skill.ts`                            |
| `hooks`    | Generated `.pi/extensions/rulesync-hooks.ts` (project and global) in `pi-hooks.ts` / `pi-extension-generator.ts` |

## System-prompt instruction files

Beyond `AGENTS.md`, Pi loads two system-prompt instruction files (docs: `https://pi.dev/docs/latest/usage`):

| File               | Project scope          | Global scope                   | Effect                                   |
| ------------------ | ---------------------- | ------------------------------ | ---------------------------------------- |
| `SYSTEM.md`        | `.pi/SYSTEM.md`        | `~/.pi/agent/SYSTEM.md`        | **Replaces** the default system prompt   |
| `APPEND_SYSTEM.md` | `.pi/APPEND_SYSTEM.md` | `~/.pi/agent/APPEND_SYSTEM.md` | **Appends** to the default system prompt |

Rulesync emits `APPEND_SYSTEM.md` from any rule that opts in via a `pi.systemPrompt: append` frontmatter block: those rule bodies are routed to `APPEND_SYSTEM.md` instead of being folded into `AGENTS.md`, multiple opted-in rules concatenate in source order, and the file participates in generate/import/delete (project and global scope) like the root file. `SYSTEM.md` is deliberately left hand-authored: it **replaces** the built-in system prompt entirely, which silently disables Pi's own tool instructions, so Rulesync never emits it.
