# Pi Coding Agent Map

## Official Docs

| Feature       | Official docs                                    | Upstream surface                                                                                 |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| index         | `https://pi.dev/docs/latest`                     | Pi Coding Agent documentation index                                                              |
| `rules`       | `https://pi.dev/docs/latest/usage`               | `AGENTS.md`, `CLAUDE.md`, global `~/.pi/agent/AGENTS.md`, context-file discovery                 |
| `ignore`      | No dedicated upstream ignore surface in map      | No Rulesync-supported Pi ignore target in map                                                    |
| `mcp`         | No dedicated upstream MCP surface in map         | No Rulesync-supported Pi MCP target in map                                                       |
| `commands`    | `https://pi.dev/docs/latest/prompt-templates`    | `.pi/prompts/*.md`, `~/.pi/agent/prompts/*.md`, prompt template frontmatter and `/name` commands |
| `subagents`   | No dedicated upstream subagents surface in map   | No Rulesync-supported Pi subagents target in map                                                 |
| `skills`      | `https://pi.dev/docs/latest/skills`              | `.pi/skills`, `~/.pi/agent/skills`, `.agents/skills`, packages, settings, `--skill`              |
| `hooks`       | No dedicated upstream hooks surface in map       | No Rulesync-supported Pi hooks target in map                                                     |
| `permissions` | No dedicated upstream permissions surface in map | Tool selection and settings exist upstream                                                       |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface    | Anchor                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `rules`    | Project and global context-file conversion in `pi-rule.ts`                                               |
| `commands` | `.pi/prompts`, `~/.pi/agent/prompts`, `argument-hint`, and prompt template conversion in `pi-command.ts` |
| `skills`   | `.pi/skills`, global `.pi/agent/skills`, and Agent Skills conversion in `pi-skill.ts`                    |
