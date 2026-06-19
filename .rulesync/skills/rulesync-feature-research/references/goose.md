# Goose Map

## Official Docs

| Feature       | Official docs                                                             | Upstream surface                                                                |
| ------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| index         | `https://goose-docs.ai/docs/category/getting-started/`                    | Goose documentation index                                                       |
| `rules`       | `https://goose-docs.ai/docs/guides/context-engineering/using-goosehints/` | `.goosehints`, `AGENTS.md`, nested hints                                        |
| `ignore`      | `https://goose-docs.ai/docs/guides/using-gooseignore/`                    | `.gooseignore`, global `~/.config/goose/.gooseignore`, local override           |
| `mcp`         | No dedicated upstream MCP surface in map                                  | Upstream extensions exist                                                       |
| `commands`    | No dedicated upstream commands surface in map                             | No Rulesync-supported Goose commands target in map                              |
| `subagents`   | No dedicated upstream subagents surface in map                            | No Rulesync-supported Goose subagents target in map                             |
| `skills`      | No dedicated upstream skills surface in map                               | No Rulesync-supported Goose skills target in map                                |
| `hooks`       | No dedicated upstream hooks surface in map                                | No Rulesync-supported Goose hooks target in map                                 |
| `permissions` | `https://goose-docs.ai/docs/guides/managing-tools/tool-permissions/`      | Global `~/.config/goose/permission.yaml` (`user` key) in `goose-permissions.ts` |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface  | Anchor                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------ |
| `rules`  | Root `.goosehints`, nested `.goose/memories`, and plain-Markdown conversion in `goose-rule.ts`         |
| `ignore` | Project `.gooseignore`, gitignore-compatible body passthrough, and default import in `goose-ignore.ts` |
