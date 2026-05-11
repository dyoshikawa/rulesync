# Replit Map

## Official Docs

| Feature       | Official docs                                         | Upstream surface                                                               |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| index         | `https://docs.replit.com/core-concepts/agent`         | Replit Agent documentation                                                     |
| `rules`       | `https://docs.replit.com/core-concepts/agent`         | Replit Agent project context; Rulesync maps a Replit rules target              |
| `skills`      | `https://docs.replit.com/core-concepts/agent/skills`  | Project `/.agents/skills`, Agent Skills standard, Skills pane and `npx skills` |
| `ignore`      | No dedicated Replit Agent ignore file surface found   | No Rulesync Replit ignore target                                               |
| `mcp`         | `https://docs.replit.com/tutorials/agent-skills`      | MCP is discussed as complementary to skills; no Rulesync Replit MCP target     |
| `commands`    | No dedicated Replit Agent custom command target found | No Rulesync Replit commands target                                             |
| `subagents`   | No dedicated Replit Agent subagent target found       | No Rulesync Replit subagents target                                            |
| `hooks`       | No dedicated Replit Agent hooks file surface found    | No Rulesync Replit hooks target                                                |
| `permissions` | No dedicated Rulesync Replit permissions target found | No Rulesync Replit permissions target                                          |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface  | Anchor                                                                                 |
| -------- | -------------------------------------------------------------------------------------- |
| `rules`  | Replit rule conversion and project output path handling in `replit-rule.ts`            |
| `skills` | Replit Agent Skills conversion and `/.agents/skills` style output in `replit-skill.ts` |
