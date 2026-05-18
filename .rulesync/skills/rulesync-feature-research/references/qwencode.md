# Qwen Code Map

## Official Docs

| Feature       | Official docs                                                                 | Upstream surface                                                                                 |
| ------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| index         | `https://qwenlm.github.io/qwen-code-docs/en/`                                 | Qwen Code documentation index                                                                    |
| `rules`       | `https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/`           | Context files such as `QWEN.md`, hierarchical instructional context                              |
| `ignore`      | `https://qwenlm.github.io/qwen-code-docs/en/users/configuration/qwen-ignore/` | `.qwenignore`, `context.fileFiltering.respectQwenIgnore`                                         |
| `mcp`         | `https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/`              | `settings.json` `mcpServers`                                                                     |
| `commands`    | No dedicated upstream commands surface in map                                 | Upstream slash command settings exist                                                            |
| `subagents`   | No dedicated upstream subagents surface in map                                | Upstream may expose SubAgents                                                                    |
| `skills`      | `https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/`           | `.qwen/skills` noted in project `.qwen` directory                                                |
| `hooks`       | No dedicated upstream hooks surface in map                                    | No Rulesync-supported Qwen Code hooks target in map                                              |
| `permissions` | `https://qwenlm.github.io/qwen-code-docs/en/users/features/approval-mode/`    | Approval mode and tool approval controls                                                         |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `rules`       | Qwen context-file conversion and target gating in `qwencode-rule.ts`                                                      |
| `ignore`      | `.qwenignore` passthrough in `qwencode-ignore.ts`                                                                         |
| `permissions` | Qwen `permissions.allow` / `ask` / `deny` mapping, tool aliases, and project/global settings in `qwencode-permissions.ts` |
