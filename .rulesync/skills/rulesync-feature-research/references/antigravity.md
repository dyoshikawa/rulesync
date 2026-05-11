# Google Antigravity Map

## Official Docs

| Feature       | Official docs                                                               | Upstream surface                                                         |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| index         | `https://antigravity.google/`                                               | Google Antigravity product site                                          |
| `rules`       | `https://codelabs.developers.google.com/getting-started-google-antigravity` | Rules customization panel; project and workspace guidance                |
| `ignore`      | No dedicated upstream ignore surface found                                  | No Rulesync-supported Antigravity ignore target                          |
| `mcp`         | No dedicated upstream MCP surface found                                     | No Rulesync-supported Antigravity MCP target                             |
| `commands`    | `https://codelabs.developers.google.com/getting-started-google-antigravity` | Workflows customization panel and slash-triggered workflows              |
| `subagents`   | No dedicated upstream subagents surface found                               | No Rulesync-supported Antigravity subagents target                       |
| `skills`      | No dedicated upstream skills surface found                                  | Rulesync maps `.agent/skills`; verify upstream before expanding behavior |
| `hooks`       | No dedicated upstream hooks surface found                                   | No Rulesync-supported Antigravity hooks target                           |
| `permissions` | No dedicated upstream permissions surface found                             | No Rulesync-supported Antigravity permissions target                     |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface    | Anchor                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `rules`    | `.agent/rules/*.md`, `trigger`, `globs`, `description`, and kebab-case filenames in `antigravity-rule.ts`           |
| `commands` | `.agent/workflows/*.md`, `description`, `trigger`, `turbo`, and workflow body wrapping in `antigravity-command.ts`  |
| `skills`   | Project `.agent/skills`, global `.gemini/antigravity/skills`, and Agent Skills conversion in `antigravity-skill.ts` |
