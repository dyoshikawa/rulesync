# Windsurf Map

## Official Docs

| Feature       | Official docs                                         | Upstream surface                                                                     |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| index         | `https://docs.windsurf.com/`                          | Windsurf documentation index                                                         |
| `rules`       | `https://docs.windsurf.com/windsurf/cascade/memories` | `.windsurf/rules/*.md`, global rules, AGENTS.md, activation modes                    |
| `ignore`      | No dedicated upstream ignore surface found            | Rulesync maps a Windsurf ignore target; verify upstream before expanding behavior    |
| `mcp`         | No dedicated upstream MCP surface found               | No Rulesync-supported Windsurf MCP target                                            |
| `commands`    | `https://docs.windsurf.com/windsurf/cascade/memories` | Workflows exist upstream; no Rulesync-supported Windsurf commands target             |
| `subagents`   | No dedicated upstream subagents surface found         | No Rulesync-supported Windsurf subagents target                                      |
| `skills`      | `https://docs.windsurf.com/windsurf/cascade/memories` | Skills as bundled procedures with supporting files; Rulesync maps `.windsurf/skills` |
| `hooks`       | No dedicated upstream hooks surface found             | No Rulesync-supported Windsurf hooks target                                          |
| `permissions` | No dedicated upstream permissions surface found       | No Rulesync-supported Windsurf permissions target                                    |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface  | Anchor                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| `rules`  | `.windsurf/rules`, frontmatter `title`, `trigger`, `globs`, and activation conversion in `windsurf-rule.ts`       |
| `ignore` | Windsurf ignore adapter in `windsurf-ignore.ts`                                                                   |
| `skills` | Project `.windsurf/skills`, global `.codeium/windsurf/skills`, and Agent Skills conversion in `windsurf-skill.ts` |
