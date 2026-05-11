# Google Antigravity Map

## Official Docs

| Feature       | Official docs                                                               | Upstream surface                                                              |
| ------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| index         | `https://antigravity.google/`                                               | Google Antigravity product site                                               |
| `rules`       | `https://codelabs.developers.google.com/getting-started-google-antigravity` | Rules customization panel; project and workspace guidance                     |
| `commands`    | `https://codelabs.developers.google.com/getting-started-google-antigravity` | Workflows customization panel and slash-triggered workflows                   |
| `skills`      | No public official Google Antigravity skills URL captured                   | Rulesync maps `.agent/skills`; verify upstream docs before expanding behavior |
| `mcp`         | No Rulesync-supported Antigravity MCP target found                          | No Rulesync Antigravity MCP target                                            |
| `ignore`      | No Rulesync-supported Antigravity ignore target found                       | No Rulesync Antigravity ignore target                                         |
| `subagents`   | No Rulesync-supported Antigravity subagents target found                    | No Rulesync Antigravity subagents target                                      |
| `hooks`       | No Rulesync-supported Antigravity hooks target found                        | No Rulesync Antigravity hooks target                                          |
| `permissions` | No Rulesync-supported Antigravity permissions target found                  | No Rulesync Antigravity permissions target                                    |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface    | Anchor                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `rules`    | `.agent/rules/*.md`, `trigger`, `globs`, `description`, and kebab-case filenames in `antigravity-rule.ts`           |
| `commands` | `.agent/workflows/*.md`, `description`, `trigger`, `turbo`, and workflow body wrapping in `antigravity-command.ts`  |
| `skills`   | Project `.agent/skills`, global `.gemini/antigravity/skills`, and Agent Skills conversion in `antigravity-skill.ts` |
