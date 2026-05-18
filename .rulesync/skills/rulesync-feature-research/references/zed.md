# Zed Map

## Official Docs

| Feature       | Official docs                                               | Upstream surface                                    |
| ------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| index         | `https://zed.dev/docs/ai/overview`                          | Zed AI documentation index                          |
| `rules`       | `https://zed.dev/docs/ai/rules`                             | `.rules`, AGENTS.md-compatible files, Rules Library |
| `ignore`      | `https://zed.dev/docs/reference/all-settings#private-files` | `.zed/settings.json`, `private_files` glob list     |
| `mcp`         | `https://zed.dev/docs/ai/configuration`                     | AI configuration and external agents                |
| `commands`    | No dedicated upstream commands surface in map               | No Rulesync-supported Zed commands target in map    |
| `subagents`   | No dedicated upstream subagents surface in map              | No Rulesync-supported Zed subagents target in map   |
| `skills`      | No dedicated upstream skills surface in map                 | No Rulesync-supported Zed skills target in map      |
| `hooks`       | No dedicated upstream hooks surface in map                  | No Rulesync-supported Zed hooks target in map       |
| `permissions` | `https://zed.dev/docs/ai/agent-settings`                    | `agent.tool_permissions`                            |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface  | Anchor                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------- |
| `ignore` | `.zed/settings.json`, non-deletable settings merge, and `private_files` conversion in `zed-ignore.ts` |
