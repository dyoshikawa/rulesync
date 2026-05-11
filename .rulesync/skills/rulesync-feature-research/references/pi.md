# Pi Coding Agent Map

## Official Docs

| Feature       | Official docs                                 | Upstream surface                                                                                 |
| ------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| index         | `https://pi.dev/docs/latest`                  | Pi Coding Agent documentation index                                                              |
| `rules`       | `https://pi.dev/docs/latest/usage`            | `AGENTS.md`, `CLAUDE.md`, global `~/.pi/agent/AGENTS.md`, context-file discovery                 |
| `commands`    | `https://pi.dev/docs/latest/prompt-templates` | `.pi/prompts/*.md`, `~/.pi/agent/prompts/*.md`, prompt template frontmatter and `/name` commands |
| `skills`      | `https://pi.dev/docs/latest/skills`           | `.pi/skills`, `~/.pi/agent/skills`, `.agents/skills`, packages, settings, `--skill`              |
| `mcp`         | No Rulesync-supported Pi MCP target found     | No Rulesync Pi MCP target                                                                        |
| `ignore`      | No dedicated Pi ignore file surface found     | No Rulesync Pi ignore target                                                                     |
| `subagents`   | No dedicated Pi subagent target found         | No Rulesync Pi subagents target                                                                  |
| `hooks`       | No dedicated Pi hooks target found            | No Rulesync Pi hooks target                                                                      |
| `permissions` | No dedicated Pi permissions page captured     | Tool selection and settings exist upstream; no Rulesync Pi permissions target                    |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface    | Anchor                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `rules`    | Project and global context-file conversion in `pi-rule.ts`                                               |
| `commands` | `.pi/prompts`, `~/.pi/agent/prompts`, `argument-hint`, and prompt template conversion in `pi-command.ts` |
| `skills`   | `.pi/skills`, global `.pi/agent/skills`, and Agent Skills conversion in `pi-skill.ts`                    |
