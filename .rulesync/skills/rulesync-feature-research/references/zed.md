# Zed Map

## Official Docs

| Feature       | Official docs                                               | Upstream surface                                                                  |
| ------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| index         | `https://zed.dev/docs/ai/overview`                          | Zed AI documentation index                                                        |
| `rules`       | `https://zed.dev/docs/ai/rules`                             | `.rules`, AGENTS.md-compatible files, Rules Library; no Rulesync Zed rules target |
| `ignore`      | `https://zed.dev/docs/reference/all-settings#private-files` | `.zed/settings.json`, `private_files` glob list                                   |
| `permissions` | `https://zed.dev/docs/ai/agent-settings`                    | `agent.tool_permissions`; no Rulesync Zed permissions target                      |
| `mcp`         | `https://zed.dev/docs/ai/configuration`                     | AI configuration and external agents; no Rulesync Zed MCP target                  |
| `commands`    | No dedicated Zed custom command target found                | No Rulesync Zed commands target                                                   |
| `subagents`   | No dedicated Zed subagent target found                      | No Rulesync Zed subagents target                                                  |
| `skills`      | No dedicated Zed Agent Skills surface found                 | No Rulesync Zed skills target                                                     |
| `hooks`       | No dedicated Zed hooks target found                         | No Rulesync Zed hooks target                                                      |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface  | Anchor                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------- |
| `ignore` | `.zed/settings.json`, non-deletable settings merge, and `private_files` conversion in `zed-ignore.ts` |
