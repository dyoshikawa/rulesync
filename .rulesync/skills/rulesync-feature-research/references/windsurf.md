# Windsurf Map

## Official Docs

| Feature       | Official docs                                          | Upstream surface                                                                  |
| ------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| index         | `https://docs.windsurf.com/`                           | Windsurf documentation index                                                      |
| `rules`       | `https://docs.windsurf.com/windsurf/cascade/memories`  | `.windsurf/rules/*.md`, global rules, AGENTS.md, activation modes                 |
| `ignore`      | No dedicated upstream ignore surface in map            | Rulesync maps a Windsurf ignore target; verify upstream before expanding behavior |
| `mcp`         | `https://docs.windsurf.com/windsurf/cascade/mcp`       | MCP server configuration with stdio, HTTP, and SSE transports                     |
| `commands`    | `https://docs.windsurf.com/windsurf/cascade/workflows` | Cascade workflows as Markdown files invoked via slash commands                    |
| `subagents`   | No dedicated upstream subagents surface in map         | No Rulesync-supported Windsurf subagents target in map                            |
| `skills`      | `https://docs.windsurf.com/windsurf/cascade/skills`    | Skills as bundled procedures with supporting files                                |
| `hooks`       | `https://docs.windsurf.com/windsurf/cascade/hooks`     | Cascade pre/post hooks for shell commands at workflow events                      |
| `permissions` | No dedicated upstream permissions surface in map       | No Rulesync-supported Windsurf permissions target in map                          |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface    | Anchor                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules`    | `.windsurf/rules` (project) + global `~/.codeium/windsurf/memories/global_rules.md`, `trigger`/`globs` activation conversion in `windsurf-rule.ts` |
| `commands` | Project `.windsurf/workflows/*.md`, global `~/.codeium/windsurf/global_workflows/*.md` in `windsurf-command.ts`                                    |
| `mcp`      | Project `.windsurf/mcp_config.json`, global `~/.codeium/windsurf/mcp_config.json` (`mcpServers`) in `windsurf-mcp.ts`                              |
| `hooks`    | Project `.windsurf/hooks.json`, global `~/.codeium/windsurf/hooks.json`, 12-event bijective mapping in `windsurf-hooks.ts`                         |
| `ignore`   | Windsurf ignore adapter in `windsurf-ignore.ts`                                                                                                    |
| `skills`   | Project `.windsurf/skills`, global `.codeium/windsurf/skills`, and Agent Skills conversion in `windsurf-skill.ts`                                  |
