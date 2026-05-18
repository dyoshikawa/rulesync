# Roo Code Map

## Official Docs

| Feature       | Official docs                                            | Upstream surface                                                                        |
| ------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| index         | `https://docs.roocode.com/`                              | Roo Code documentation index and shutdown notice                                        |
| `rules`       | `https://docs.roocode.com/features/custom-instructions`  | `.roo/rules`, `.roorules`, mode-specific rules, AGENTS.md compatibility                 |
| `ignore`      | `https://docs.roocode.com/features/rooignore`            | `.rooignore` file surface                                                               |
| `mcp`         | `https://docs.roocode.com/features/mcp/using-mcp-in-roo` | MCP server configuration                                                                |
| `commands`    | `https://docs.roocode.com/features/slash-commands`       | `.roo/commands` reusable command files                                                  |
| `subagents`   | `https://docs.roocode.com/features/custom-modes`         | Custom modes and orchestrator-style delegation                                          |
| `skills`      | `https://docs.roocode.com/features/skills`               | Roo skills surface                                                                      |
| `hooks`       | No dedicated upstream hooks surface in map               | No Rulesync-supported Roo hooks target in map                                           |
| `permissions` | No dedicated upstream permissions surface in map         | Roo modes can constrain tool groups                                                     |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface     | Anchor                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------ |
| `rules`     | `.roo/rules`, `.roorules`, and Roo custom-instruction conversion in `roo-rule.ts`          |
| `ignore`    | `.rooignore` passthrough in `roo-ignore.ts`                                                |
| `mcp`       | Roo MCP JSON conversion, stdio/SSE/HTTP handling, and server normalization in `roo-mcp.ts` |
| `commands`  | `.roo/commands` frontmatter and command body conversion in `roo-command.ts`                |
| `subagents` | Simulated custom mode conversion in `roo-subagent.ts`                                      |
| `skills`    | `.roo/skills` and global skill roots in `roo-skill.ts`                                     |
