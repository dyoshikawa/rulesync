# Cline Map

## Official Docs

| Feature       | Official docs                                               | Upstream surface                                                                 |
| ------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| index         | `https://docs.cline.bot/`                                   | Cline documentation index                                                        |
| `rules`       | `https://docs.cline.bot/customization/cline-rules`          | Rules, workflows, `.clinerules`, and customization surfaces                      |
| `ignore`      | `https://docs.cline.bot/customization/clineignore`          | `.clineignore` customization surface                                             |
| `mcp`         | `https://docs.cline.bot/mcp/adding-and-configuring-servers` | `cline_mcp_settings.json`, stdio/HTTP/SSE style MCP server entries               |
| `commands`    | `https://docs.cline.bot/core-workflows/using-commands`      | Slash commands and workflow-style reusable commands                              |
| `subagents`   | No dedicated upstream subagents surface in map              | No Rulesync-supported Cline subagents target in map                              |
| `skills`      | `https://docs.cline.bot/customization/skills`               | `.cline/skills`, `~/.cline/skills`, `.clinerules/skills`, `.claude/skills`       |
| `hooks`       | `https://docs.cline.bot/cline-cli/configuration`            | CLI configuration exposes a Hooks tab                                            |
| `permissions` | `https://docs.cline.bot/features/auto-approve`              | Auto approve settings for read, edit, commands, browser, MCP, and request limits |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `rules`       | Cline rule conversion and `.clinerules` flat directory output in `cline-rule.ts`                                            |
| `ignore`      | `.clineignore` passthrough in `cline-ignore.ts`                                                                             |
| `mcp`         | Cline MCP settings conversion, JSON fallback, and server normalization in `cline-mcp.ts`                                    |
| `commands`    | `.cline/commands` plus project/global command roots in `cline-command.ts`                                                   |
| `skills`      | `.cline/skills`, global `~/.cline/skills`, and Agent Skills frontmatter in `cline-skill.ts`                                 |
| `permissions` | Cline auto-approve settings conversion, tool category mapping, and local/global settings handling in `cline-permissions.ts` |
