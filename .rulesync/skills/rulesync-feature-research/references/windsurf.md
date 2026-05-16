# Windsurf Map

## Official Docs

| Feature       | Official docs                                          | Upstream surface                                                                     |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| index         | `https://docs.windsurf.com/`                           | Windsurf documentation index                                                         |
| `rules`       | `https://docs.windsurf.com/windsurf/cascade/memories`  | `.windsurf/rules/*.md`, global rules, AGENTS.md, activation modes                    |
| `ignore`      | No dedicated upstream ignore surface in map            | Rulesync maps a Windsurf ignore target; verify upstream before expanding behavior    |
| `mcp`         | No dedicated upstream MCP surface in map               | No Rulesync-supported Windsurf MCP target in map                                     |
| `commands`    | `https://docs.windsurf.com/windsurf/cascade/workflows` | Workflows exist upstream; no Rulesync-supported Windsurf commands target             |
| `subagents`   | No dedicated upstream subagents surface in map         | No Rulesync-supported Windsurf subagents target in map                               |
| `skills`      | `https://docs.windsurf.com/windsurf/cascade/skills`    | Skills as bundled procedures with supporting files; Rulesync maps `.windsurf/skills` |
| `hooks`       | No dedicated upstream hooks surface in map             | No Rulesync-supported Windsurf hooks target in map                                   |
| `permissions` | No dedicated upstream permissions surface in map       | No Rulesync-supported Windsurf permissions target in map                             |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface  | Anchor                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| `rules`  | `.windsurf/rules`, frontmatter `title`, `trigger`, `globs`, and activation conversion in `windsurf-rule.ts`       |
| `ignore` | Windsurf ignore adapter in `windsurf-ignore.ts`                                                                   |
| `skills` | Project `.windsurf/skills`, global `.codeium/windsurf/skills`, and Agent Skills conversion in `windsurf-skill.ts` |
