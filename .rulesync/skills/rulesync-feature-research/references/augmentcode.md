# AugmentCode Map

## Official Docs

| Feature       | Official docs                                                      | Upstream surface                                                                                 |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| index         | `https://docs.augmentcode.com/`                                    | Augment documentation index                                                                      |
| `rules`       | `https://docs.augmentcode.com/cli/rules`                           | `.augment/rules`, `~/.augment/rules`, AGENTS.md and CLAUDE.md hierarchical rules                 |
| `ignore`      | `https://docs.augmentcode.com/cli/setup-auggie/workspace-indexing` | `.augmentignore`, `.gitignore` interaction, workspace indexing filters                           |
| `mcp`         | No dedicated upstream MCP surface found                            | MCP tool names appear in permissions; no Rulesync-supported AugmentCode MCP target               |
| `commands`    | No dedicated upstream commands surface found                       | No Rulesync-supported AugmentCode commands target                                                |
| `subagents`   | No dedicated upstream subagents surface found                      | No Rulesync-supported AugmentCode subagents target                                               |
| `skills`      | No dedicated upstream skills surface found                         | No Rulesync-supported AugmentCode skills target                                                  |
| `hooks`       | No dedicated upstream hooks surface found                          | No Rulesync-supported AugmentCode hooks target                                                   |
| `permissions` | `https://docs.augmentcode.com/cli/permissions`                     | `~/.augment/settings.json`, `toolPermissions`, `allow`/`deny`/`ask-user`, first-match-wins rules |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules`       | `.augment/rules` non-root conversion and frontmatter stripping in `augmentcode-rule.ts`                                                       |
| `ignore`      | `.augmentignore` passthrough and gitignore-compatible comments in `augmentcode-ignore.ts`                                                     |
| `permissions` | `.augment/settings.json`, `toolPermissions`, tool-name aliases, regex/glob fallback, and fail-closed ordering in `augmentcode-permissions.ts` |
