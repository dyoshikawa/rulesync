# Takt Map

## Official Docs

| Feature       | Official docs                                   | Upstream surface                              |
| ------------- | ----------------------------------------------- | --------------------------------------------- |
| index         | `https://github.com/nrslib/takt`                | TAKT repository                               |
| `rules`       | `https://nrslib.com/faceted-prompting/`         | Faceted prompting policies                    |
| `ignore`      | No dedicated upstream ignore surface found      | No Rulesync-supported TAKT ignore target      |
| `mcp`         | No dedicated upstream MCP surface found         | No Rulesync-supported TAKT MCP target         |
| `commands`    | `https://nrslib.com/faceted-prompting/`         | Faceted prompting instructions                |
| `subagents`   | `https://nrslib.com/faceted-prompting/`         | Faceted prompting personas                    |
| `skills`      | `https://nrslib.com/faceted-prompting/`         | Faceted prompting knowledge                   |
| `hooks`       | No dedicated upstream hooks surface found       | No Rulesync-supported TAKT hooks target       |
| `permissions` | No dedicated upstream permissions surface found | No Rulesync-supported TAKT permissions target |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface     | Anchor                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `rules`     | `.takt/facets/policies`, `takt.name` stem override, and plain-Markdown output in `takt-rule.ts`        |
| `commands`  | `.takt/facets/instructions`, `takt.name` stem override, and frontmatter stripping in `takt-command.ts` |
| `subagents` | `.takt/facets/personas`, `takt.name` stem override, and plain-Markdown output in `takt-subagent.ts`    |
| `skills`    | Flat `.takt/facets/knowledge/{name}.md` output and unsupported reverse import in `takt-skill.ts`       |
