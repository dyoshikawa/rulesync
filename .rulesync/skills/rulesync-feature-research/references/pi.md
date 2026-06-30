# Pi Coding Agent Map

## Official Docs

| Feature       | Official docs                                    | Upstream surface                                                                                                                       |
| ------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| index         | `https://pi.dev/docs/latest`                     | Pi Coding Agent documentation index                                                                                                    |
| `rules`       | `https://pi.dev/docs/latest/usage`               | `AGENTS.md`, `CLAUDE.md`, global `~/.pi/agent/AGENTS.md`, context-file discovery, `SYSTEM.md` / `APPEND_SYSTEM.md` system-prompt files |
| `ignore`      | No dedicated upstream ignore surface in map      | No Rulesync-supported Pi ignore target in map                                                                                          |
| `mcp`         | No dedicated upstream MCP surface in map         | No Rulesync-supported Pi MCP target in map                                                                                             |
| `commands`    | `https://pi.dev/docs/latest/prompt-templates`    | `.pi/prompts/*.md`, `~/.pi/agent/prompts/*.md`, prompt template frontmatter and `/name` commands                                       |
| `subagents`   | No dedicated upstream subagents surface in map   | No Rulesync-supported Pi subagents target in map                                                                                       |
| `skills`      | `https://pi.dev/docs/latest/skills`              | `.pi/skills`, `~/.pi/agent/skills`, `.agents/skills`, packages, settings, `--skill`                                                    |
| `hooks`       | No dedicated upstream hooks surface in map       | No Rulesync-supported Pi hooks target in map                                                                                           |
| `permissions` | No dedicated upstream permissions surface in map | Tool selection and settings exist upstream                                                                                             |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface    | Anchor                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `rules`    | Project and global context-file conversion in `pi-rule.ts`                                               |
| `commands` | `.pi/prompts`, `~/.pi/agent/prompts`, `argument-hint`, and prompt template conversion in `pi-command.ts` |
| `skills`   | `.pi/skills`, global `.pi/agent/skills`, and Agent Skills conversion in `pi-skill.ts`                    |

## System-prompt instruction files (not yet mapped)

Beyond `AGENTS.md`, Pi loads two system-prompt instruction files (docs: `https://pi.dev/docs/latest/usage`):

| File               | Project scope          | Global scope                   | Effect                                   |
| ------------------ | ---------------------- | ------------------------------ | ---------------------------------------- |
| `SYSTEM.md`        | `.pi/SYSTEM.md`        | `~/.pi/agent/SYSTEM.md`        | **Replaces** the default system prompt   |
| `APPEND_SYSTEM.md` | `.pi/APPEND_SYSTEM.md` | `~/.pi/agent/APPEND_SYSTEM.md` | **Appends** to the default system prompt |

Rulesync does not currently emit these files. Rulesync's rules model only routes a designated `root` rule to a single context file (`AGENTS.md`) and folds non-root rules into it; it has no convention for marking a rule as "replace the system prompt" vs "append to the system prompt". Wiring `SYSTEM.md` / `APPEND_SYSTEM.md` would require a new frontmatter routing convention, so this surface is documented here rather than implemented.
