# Pi Coding Agent Map

## Official Docs

| Feature       | Official docs                                   | Upstream surface                                                                                 |
| ------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| index         | `https://pi.dev/docs/latest`                    | Pi Coding Agent documentation index                                                              |
| `rules`       | `https://pi.dev/docs/latest/usage`              | `AGENTS.md`, `CLAUDE.md`, global `~/.pi/agent/AGENTS.md`, context-file discovery                 |
| `ignore`      | No dedicated upstream ignore surface found      | No Rulesync-supported Pi ignore target                                                           |
| `mcp`         | No dedicated upstream MCP surface found         | No Rulesync-supported Pi MCP target                                                              |
| `commands`    | `https://pi.dev/docs/latest/prompt-templates`   | `.pi/prompts/*.md`, `~/.pi/agent/prompts/*.md`, prompt template frontmatter and `/name` commands |
| `subagents`   | No dedicated upstream subagents surface found   | No Rulesync-supported Pi subagents target                                                        |
| `skills`      | `https://pi.dev/docs/latest/skills`             | `.pi/skills`, `~/.pi/agent/skills`, `.agents/skills`, packages, settings, `--skill`              |
| `hooks`       | No dedicated upstream hooks surface found       | No Rulesync-supported Pi hooks target                                                            |
| `permissions` | No dedicated upstream permissions surface found | Tool selection and settings exist upstream; no Rulesync-supported Pi permissions target          |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface    | Anchor                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `rules`    | Project and global context-file conversion in `pi-rule.ts`                                               |
| `commands` | `.pi/prompts`, `~/.pi/agent/prompts`, `argument-hint`, and prompt template conversion in `pi-command.ts` |
| `skills`   | `.pi/skills`, global `.pi/agent/skills`, and Agent Skills conversion in `pi-skill.ts`                    |
