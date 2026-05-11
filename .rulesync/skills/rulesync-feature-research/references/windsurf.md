# Windsurf Map

## Official Docs

| Feature       | Official docs                                           | Upstream surface                                                                         |
| ------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| index         | `https://docs.windsurf.com/`                            | Windsurf documentation index                                                             |
| `rules`       | `https://docs.windsurf.com/windsurf/cascade/memories`   | `.windsurf/rules/*.md`, global rules, AGENTS.md, activation modes                        |
| `ignore`      | No dedicated Windsurf ignore page captured              | Rulesync maps a Windsurf ignore target; verify upstream before expanding ignore behavior |
| `skills`      | `https://docs.windsurf.com/windsurf/cascade/memories`   | Skills as bundled procedures with supporting files; Rulesync maps `.windsurf/skills`     |
| `mcp`         | No Rulesync-supported Windsurf MCP target found         | No Rulesync Windsurf MCP target                                                          |
| `commands`    | `https://docs.windsurf.com/windsurf/cascade/memories`   | Workflows exist upstream; no Rulesync Windsurf commands target                           |
| `subagents`   | No dedicated Windsurf subagent target found             | No Rulesync Windsurf subagents target                                                    |
| `hooks`       | No dedicated Windsurf hooks file surface found          | No Rulesync Windsurf hooks target                                                        |
| `permissions` | No dedicated Rulesync Windsurf permissions target found | No Rulesync Windsurf permissions target                                                  |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface  | Anchor                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| `rules`  | `.windsurf/rules`, frontmatter `title`, `trigger`, `globs`, and activation conversion in `windsurf-rule.ts`       |
| `ignore` | Windsurf ignore adapter in `windsurf-ignore.ts`                                                                   |
| `skills` | Project `.windsurf/skills`, global `.codeium/windsurf/skills`, and Agent Skills conversion in `windsurf-skill.ts` |
