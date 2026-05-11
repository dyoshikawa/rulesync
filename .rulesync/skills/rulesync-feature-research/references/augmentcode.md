# AugmentCode Map

## Official Docs

| Feature       | Official docs                                                      | Upstream surface                                                                                 |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| index         | `https://docs.augmentcode.com/`                                    | Augment documentation index                                                                      |
| `rules`       | `https://docs.augmentcode.com/cli/rules`                           | `.augment/rules`, `~/.augment/rules`, AGENTS.md and CLAUDE.md hierarchical rules                 |
| `ignore`      | `https://docs.augmentcode.com/cli/setup-auggie/workspace-indexing` | `.augmentignore`, `.gitignore` interaction, workspace indexing filters                           |
| `permissions` | `https://docs.augmentcode.com/cli/permissions`                     | `~/.augment/settings.json`, `toolPermissions`, `allow`/`deny`/`ask-user`, first-match-wins rules |
| `mcp`         | No Rulesync-supported AugmentCode MCP target found                 | MCP tool names appear in permissions; no Rulesync AugmentCode MCP target                         |
| `commands`    | No dedicated AugmentCode custom command target found               | No Rulesync AugmentCode commands target                                                          |
| `subagents`   | No dedicated AugmentCode subagent target found                     | No Rulesync AugmentCode subagents target                                                         |
| `skills`      | No dedicated AugmentCode Agent Skills surface found                | No Rulesync AugmentCode skills target                                                            |
| `hooks`       | No dedicated AugmentCode hooks file surface found                  | No Rulesync AugmentCode hooks target                                                             |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules`       | `.augment/rules` non-root conversion and frontmatter stripping in `augmentcode-rule.ts`                                                       |
| `ignore`      | `.augmentignore` passthrough and gitignore-compatible comments in `augmentcode-ignore.ts`                                                     |
| `permissions` | `.augment/settings.json`, `toolPermissions`, tool-name aliases, regex/glob fallback, and fail-closed ordering in `augmentcode-permissions.ts` |
