# Takt Map

## Official Docs

| Feature       | Official docs                                    | Upstream surface                                     |
| ------------- | ------------------------------------------------ | ---------------------------------------------------- |
| index         | `https://github.com/nrslib/takt`                 | TAKT repository                                      |
| `rules`       | `https://nrslib.com/faceted-prompting/`          | Faceted prompting policies                           |
| `ignore`      | No dedicated upstream ignore surface in map      | No Rulesync-supported TAKT ignore target in map      |
| `mcp`         | No dedicated upstream MCP surface in map         | No Rulesync-supported TAKT MCP target in map         |
| `commands`    | `https://nrslib.com/faceted-prompting/`          | Faceted prompting instructions                       |
| `subagents`   | `https://nrslib.com/faceted-prompting/`          | Faceted prompting personas                           |
| `skills`      | `https://nrslib.com/faceted-prompting/`          | Faceted prompting knowledge                          |
| `hooks`       | No dedicated upstream hooks surface in map       | No Rulesync-supported TAKT hooks target in map       |
| `permissions` | No dedicated upstream permissions surface in map | No Rulesync-supported TAKT permissions target in map |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface     | Anchor                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `rules`     | `.takt/facets/policies`, `takt.name` stem override, and plain-Markdown output in `takt-rule.ts`        |
| `commands`  | `.takt/facets/instructions`, `takt.name` stem override, and frontmatter stripping in `takt-command.ts` |
| `subagents` | `.takt/facets/personas`, `takt.name` stem override, and plain-Markdown output in `takt-subagent.ts`    |
| `skills`    | Flat `.takt/facets/knowledge/{name}.md` output and unsupported reverse import in `takt-skill.ts`       |
