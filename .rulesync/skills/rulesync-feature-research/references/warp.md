# Warp Map

## Official Docs

| Feature       | Official docs                                             | Upstream surface                                                                |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| index         | `https://docs.warp.dev/`                                  | Warp documentation index                                                        |
| `rules`       | `https://docs.warp.dev/agent-platform/capabilities/rules` | Global Rules, Project Rules, `AGENTS.md`, `WARP.md`, imported legacy rule files |
| `ignore`      | No dedicated upstream ignore surface in map               | No Rulesync-supported Warp ignore target in map                                 |
| `mcp`         | No dedicated upstream MCP surface in map                  | No Rulesync-supported Warp MCP target in map                                    |
| `commands`    | No dedicated upstream commands surface in map             | No Rulesync-supported Warp commands target in map                               |
| `subagents`   | No dedicated upstream subagents surface in map            | No Rulesync-supported Warp subagents target in map                              |
| `skills`      | No dedicated upstream skills surface in map               | No Rulesync-supported Warp skills target in map                                 |
| `hooks`       | No dedicated upstream hooks surface in map                | No Rulesync-supported Warp hooks target in map                                  |
| `permissions` | No dedicated upstream permissions surface in map          | No Rulesync-supported Warp permissions target in map                            |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface | Anchor                                                                                    |
| ------- | ----------------------------------------------------------------------------------------- |
| `rules` | `AGENTS.md` / `WARP.md` style project rule conversion and target gating in `warp-rule.ts` |
