# Qwen Code Map

## Official Docs

| Feature       | Official docs                                                                 | Upstream surface                                                                                     |
| ------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| index         | `https://qwenlm.github.io/qwen-code-docs/en/`                                 | Qwen Code documentation index                                                                        |
| `rules`       | `https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/`           | Context files such as `QWEN.md`, hierarchical instructional context                                  |
| `ignore`      | `https://qwenlm.github.io/qwen-code-docs/en/users/configuration/qwen-ignore/` | `.qwenignore`, `context.fileFiltering.respectQwenIgnore`                                             |
| `mcp`         | `https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/`              | `settings.json` `mcpServers`; Rulesync Qwen Code MCP is not currently README-supported               |
| `skills`      | `https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/`           | `.qwen/skills` noted in project `.qwen` directory; Rulesync Qwen Code skills not currently supported |
| `permissions` | `https://qwenlm.github.io/qwen-code-docs/en/users/features/approval-mode/`    | Approval mode and tool approval controls                                                             |
| `commands`    | No Rulesync-supported Qwen Code commands target found                         | Upstream slash command settings exist; no Rulesync Qwen Code commands target                         |
| `subagents`   | No Rulesync-supported Qwen Code subagents target found                        | Upstream may expose SubAgents; no Rulesync Qwen Code subagents target                                |
| `hooks`       | No Rulesync-supported Qwen Code hooks target found                            | No Rulesync Qwen Code hooks target                                                                   |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `rules`       | Qwen context-file conversion and target gating in `qwencode-rule.ts`                                                      |
| `ignore`      | `.qwenignore` passthrough in `qwencode-ignore.ts`                                                                         |
| `permissions` | Qwen `permissions.allow` / `ask` / `deny` mapping, tool aliases, and project/global settings in `qwencode-permissions.ts` |
