# Google Antigravity Map

## Official Docs

| Feature       | Official docs                                                               | Upstream surface                                                         |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| index         | `https://antigravity.google/`                                               | Google Antigravity product site                                          |
| `rules`       | `https://codelabs.developers.google.com/getting-started-google-antigravity` | Rules customization panel; project and workspace guidance                |
| `ignore`      | No dedicated upstream ignore surface in map                                 | No Rulesync-supported Antigravity ignore target in map                   |
| `mcp`         | No dedicated upstream MCP surface in map                                    | No Rulesync-supported Antigravity MCP target in map                      |
| `commands`    | `https://codelabs.developers.google.com/getting-started-google-antigravity` | Workflows customization panel and slash-triggered workflows              |
| `subagents`   | No dedicated upstream subagents surface in map                              | No Rulesync-supported Antigravity subagents target in map                |
| `skills`      | No dedicated upstream skills surface in map                                 | Rulesync maps `.agent/skills`; verify upstream before expanding behavior |
| `hooks`       | No dedicated upstream hooks surface in map                                  | No Rulesync-supported Antigravity hooks target in map                    |
| `permissions` | No dedicated upstream permissions surface in map                            | No Rulesync-supported Antigravity permissions target in map              |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface    | Anchor                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `rules`    | `.agent/rules/*.md`, `trigger`, `globs`, `description`, and kebab-case filenames in `antigravity-rule.ts`           |
| `commands` | `.agent/workflows/*.md`, `description`, `trigger`, `turbo`, and workflow body wrapping in `antigravity-command.ts`  |
| `skills`   | Project `.agent/skills`, global `.gemini/antigravity/skills`, and Agent Skills conversion in `antigravity-skill.ts` |
