# Warp Map

## Official Docs

| Feature       | Official docs                                             | Upstream surface                                                                |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| index         | `https://docs.warp.dev/`                                  | Warp documentation index                                                        |
| `rules`       | `https://docs.warp.dev/agent-platform/capabilities/rules` | Global Rules, Project Rules, `AGENTS.md`, `WARP.md`, imported legacy rule files |
| `ignore`      | No dedicated upstream ignore surface found                | No Rulesync-supported Warp ignore target                                        |
| `mcp`         | No dedicated upstream MCP surface found                   | No Rulesync-supported Warp MCP target                                           |
| `commands`    | No dedicated upstream commands surface found              | No Rulesync-supported Warp commands target                                      |
| `subagents`   | No dedicated upstream subagents surface found             | No Rulesync-supported Warp subagents target                                     |
| `skills`      | No dedicated upstream skills surface found                | No Rulesync-supported Warp skills target                                        |
| `hooks`       | No dedicated upstream hooks surface found                 | No Rulesync-supported Warp hooks target                                         |
| `permissions` | No dedicated upstream permissions surface found           | No Rulesync-supported Warp permissions target                                   |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface | Anchor                                                                                    |
| ------- | ----------------------------------------------------------------------------------------- |
| `rules` | `AGENTS.md` / `WARP.md` style project rule conversion and target gating in `warp-rule.ts` |
