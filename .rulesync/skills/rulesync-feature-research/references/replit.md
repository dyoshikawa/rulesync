# Replit Map

## Official Docs

| Feature       | Official docs                                        | Upstream surface                                                               |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| index         | `https://docs.replit.com/core-concepts/agent`        | Replit Agent documentation                                                     |
| `rules`       | `https://docs.replit.com/core-concepts/agent`        | Replit Agent project context; Rulesync maps a Replit rules target              |
| `ignore`      | No dedicated upstream ignore surface in map          | No Rulesync-supported Replit ignore target in map                              |
| `mcp`         | No dedicated upstream MCP surface in map             | No Rulesync-supported Replit MCP target in map                                 |
| `commands`    | No dedicated upstream commands surface in map        | No Rulesync-supported Replit commands target in map                            |
| `subagents`   | No dedicated upstream subagents surface in map       | No Rulesync-supported Replit subagents target in map                           |
| `skills`      | `https://docs.replit.com/core-concepts/agent/skills` | Project `/.agents/skills`, Agent Skills standard, Skills pane and `npx skills` |
| `hooks`       | No dedicated upstream hooks surface in map           | No Rulesync-supported Replit hooks target in map                               |
| `permissions` | No dedicated upstream permissions surface in map     | No Rulesync-supported Replit permissions target in map                         |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface  | Anchor                                                                                 |
| -------- | -------------------------------------------------------------------------------------- |
| `rules`  | Replit rule conversion and project output path handling in `replit-rule.ts`            |
| `skills` | Replit Agent Skills conversion and `/.agents/skills` style output in `replit-skill.ts` |
