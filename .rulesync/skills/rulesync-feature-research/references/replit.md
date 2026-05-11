# Replit Map

## Official Docs

| Feature       | Official docs                                        | Upstream surface                                                                     |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| index         | `https://docs.replit.com/core-concepts/agent`        | Replit Agent documentation                                                           |
| `rules`       | `https://docs.replit.com/core-concepts/agent`        | Replit Agent project context; Rulesync maps a Replit rules target                    |
| `ignore`      | No dedicated upstream ignore surface found           | No Rulesync-supported Replit ignore target                                           |
| `mcp`         | `https://docs.replit.com/tutorials/agent-skills`     | MCP is discussed as complementary to skills; no Rulesync-supported Replit MCP target |
| `commands`    | No dedicated upstream commands surface found         | No Rulesync-supported Replit commands target                                         |
| `subagents`   | No dedicated upstream subagents surface found        | No Rulesync-supported Replit subagents target                                        |
| `skills`      | `https://docs.replit.com/core-concepts/agent/skills` | Project `/.agents/skills`, Agent Skills standard, Skills pane and `npx skills`       |
| `hooks`       | No dedicated upstream hooks surface found            | No Rulesync-supported Replit hooks target                                            |
| `permissions` | No dedicated upstream permissions surface found      | No Rulesync-supported Replit permissions target                                      |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface  | Anchor                                                                                 |
| -------- | -------------------------------------------------------------------------------------- |
| `rules`  | Replit rule conversion and project output path handling in `replit-rule.ts`            |
| `skills` | Replit Agent Skills conversion and `/.agents/skills` style output in `replit-skill.ts` |
