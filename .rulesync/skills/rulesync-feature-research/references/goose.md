# Goose Map

## Official Docs

| Feature       | Official docs                                                               | Upstream surface                                                      |
| ------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| index         | `https://goose-docs.ai/docs/`                                               | Goose documentation index                                             |
| `rules`       | `https://goose-docs.ai/docs/guides/context-engineering/using-goosehints/`   | `.goosehints`, `AGENTS.md`, nested hints                              |
| `ignore`      | `https://goose-docs.ai/docs/guides/using-gooseignore/`                      | `.gooseignore`, global `~/.config/goose/.gooseignore`, local override |
| `mcp`         | No dedicated Rulesync Goose MCP target                                      | Upstream extensions are outside the current Rulesync Goose map        |
| `commands`    | No dedicated Goose command file surface found                               | No Rulesync Goose commands target                                     |
| `subagents`   | No dedicated Goose subagent file surface found                              | No Rulesync Goose subagents target                                    |
| `skills`      | No dedicated Goose Agent Skills surface found                               | No Rulesync Goose skills target                                       |
| `hooks`       | No dedicated Goose hooks surface found                                      | No Rulesync Goose hooks target                                        |
| `permissions` | No dedicated Goose permissions target beyond `.gooseignore` access controls | No Rulesync Goose permissions target                                  |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface  | Anchor                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------ |
| `rules`  | Root `.goosehints`, nested `.goose/memories`, and plain-Markdown conversion in `goose-rule.ts`         |
| `ignore` | Project `.gooseignore`, gitignore-compatible body passthrough, and default import in `goose-ignore.ts` |
