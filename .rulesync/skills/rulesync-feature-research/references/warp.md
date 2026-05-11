# Warp Map

## Official Docs

| Feature       | Official docs                                             | Upstream surface                                                                |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| index         | `https://docs.warp.dev/`                                  | Warp documentation index                                                        |
| `rules`       | `https://docs.warp.dev/agent-platform/capabilities/rules` | Global Rules, Project Rules, `AGENTS.md`, `WARP.md`, imported legacy rule files |
| `ignore`      | No dedicated Warp ignore file surface found               | No Rulesync Warp ignore target                                                  |
| `mcp`         | No Rulesync-supported Warp MCP target found               | No Rulesync Warp MCP target                                                     |
| `commands`    | No dedicated Warp custom command target found             | No Rulesync Warp commands target                                                |
| `subagents`   | No dedicated Warp subagent target found                   | No Rulesync Warp subagents target                                               |
| `skills`      | No dedicated Warp Agent Skills surface found              | No Rulesync Warp skills target                                                  |
| `hooks`       | No dedicated Warp hooks file surface found                | No Rulesync Warp hooks target                                                   |
| `permissions` | No dedicated Rulesync Warp permissions target found       | No Rulesync Warp permissions target                                             |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface | Anchor                                                                                    |
| ------- | ----------------------------------------------------------------------------------------- |
| `rules` | `AGENTS.md` / `WARP.md` style project rule conversion and target gating in `warp-rule.ts` |
