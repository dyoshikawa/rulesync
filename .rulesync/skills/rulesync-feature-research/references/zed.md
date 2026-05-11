# Zed Map

## Official Docs

| Feature       | Official docs                                               | Upstream surface                                                                            |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| index         | `https://zed.dev/docs/ai/overview`                          | Zed AI documentation index                                                                  |
| `rules`       | `https://zed.dev/docs/ai/rules`                             | `.rules`, AGENTS.md-compatible files, Rules Library; no Rulesync-supported Zed rules target |
| `ignore`      | `https://zed.dev/docs/reference/all-settings#private-files` | `.zed/settings.json`, `private_files` glob list                                             |
| `mcp`         | `https://zed.dev/docs/ai/configuration`                     | AI configuration and external agents; no Rulesync-supported Zed MCP target                  |
| `commands`    | No dedicated upstream commands surface found                | No Rulesync-supported Zed commands target                                                   |
| `subagents`   | No dedicated upstream subagents surface found               | No Rulesync-supported Zed subagents target                                                  |
| `skills`      | No dedicated upstream skills surface found                  | No Rulesync-supported Zed skills target                                                     |
| `hooks`       | No dedicated upstream hooks surface found                   | No Rulesync-supported Zed hooks target                                                      |
| `permissions` | `https://zed.dev/docs/ai/agent-settings`                    | `agent.tool_permissions`; no Rulesync-supported Zed permissions target                      |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface  | Anchor                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------- |
| `ignore` | `.zed/settings.json`, non-deletable settings merge, and `private_files` conversion in `zed-ignore.ts` |
