# Takt Map

## Official Docs

| Feature       | Official docs                               | Upstream surface                    |
| ------------- | ------------------------------------------- | ----------------------------------- |
| index         | `https://github.com/nrslib/takt`            | TAKT repository                     |
| `rules`       | `https://nrslib.com/faceted-prompting/`     | Faceted prompting policies          |
| `commands`    | `https://nrslib.com/faceted-prompting/`     | Faceted prompting instructions      |
| `subagents`   | `https://nrslib.com/faceted-prompting/`     | Faceted prompting personas          |
| `skills`      | `https://nrslib.com/faceted-prompting/`     | Faceted prompting knowledge         |
| `mcp`         | No dedicated TAKT MCP file surface found    | No Rulesync TAKT MCP target         |
| `ignore`      | No dedicated TAKT ignore file surface found | No Rulesync TAKT ignore target      |
| `hooks`       | No dedicated TAKT hooks file surface found  | No Rulesync TAKT hooks target       |
| `permissions` | No dedicated TAKT permissions target found  | No Rulesync TAKT permissions target |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface     | Anchor                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `rules`     | `.takt/facets/policies`, `takt.name` stem override, and plain-Markdown output in `takt-rule.ts`        |
| `commands`  | `.takt/facets/instructions`, `takt.name` stem override, and frontmatter stripping in `takt-command.ts` |
| `subagents` | `.takt/facets/personas`, `takt.name` stem override, and plain-Markdown output in `takt-subagent.ts`    |
| `skills`    | Flat `.takt/facets/knowledge/{name}.md` output and unsupported reverse import in `takt-skill.ts`       |
