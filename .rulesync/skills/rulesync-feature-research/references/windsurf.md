# Windsurf Map

## Official Docs

| Feature       | Official docs                                         | Upstream surface                                                                     |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| index         | `https://docs.windsurf.com/`                          | Windsurf documentation index                                                         |
| `rules`       | `https://docs.windsurf.com/windsurf/cascade/memories` | `.windsurf/rules/*.md`, global rules, AGENTS.md, activation modes                    |
| `ignore`      | No dedicated upstream ignore surface in map           | Rulesync maps a Windsurf ignore target; verify upstream before expanding behavior    |
| `mcp`         | `https://docs.windsurf.com/windsurf/cascade/mcp`      | MCP server configuration with stdio, HTTP, and SSE transports                        |
| `commands`    | `https://docs.windsurf.com/windsurf/cascade/workflows` | Cascade workflows as Markdown files invoked via slash commands                      |
| `subagents`   | No dedicated upstream subagents surface in map        | No Rulesync-supported Windsurf subagents target in map                               |
| `skills`      | `https://docs.windsurf.com/windsurf/cascade/skills`   | Skills as bundled procedures with supporting files                                   |
| `hooks`       | `https://docs.windsurf.com/windsurf/cascade/hooks`    | Cascade pre/post hooks for shell commands at workflow events                         |
| `permissions` | No dedicated upstream permissions surface in map      | No Rulesync-supported Windsurf permissions target in map                             |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface  | Anchor                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| `rules`  | `.windsurf/rules`, frontmatter `title`, `trigger`, `globs`, and activation conversion in `windsurf-rule.ts`       |
| `ignore` | Windsurf ignore adapter in `windsurf-ignore.ts`                                                                   |
| `skills` | Project `.windsurf/skills`, global `.codeium/windsurf/skills`, and Agent Skills conversion in `windsurf-skill.ts` |
