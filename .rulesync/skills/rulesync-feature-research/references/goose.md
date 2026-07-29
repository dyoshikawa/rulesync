# Goose Map

## Official Docs

| Feature       | Official docs                                                             | Upstream surface                                                                |
| ------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| index         | `https://goose-docs.ai/docs/category/getting-started/`                    | Goose documentation index                                                       |
| `rules`       | `https://goose-docs.ai/docs/guides/context-engineering/using-goosehints/` | `.goosehints`, `AGENTS.md`, nested hints, global `~/.agents/AGENTS.md`          |
| `ignore`      | Retired upstream (docs removed in v1.44.0; goose#10343)                   | No ignore file — `.gitignore` plus tool permissions are the guidance            |
| `mcp`         | `https://goose-docs.ai/docs/getting-started/using-extensions/`            | Global `config.yaml` `extensions:`; project open-plugin `.mcp.json`             |
| `commands`    | `https://goose-docs.ai/docs/guides/recipes/recipe-reference/`             | Recipes at `.goose/recipes/` and `~/.config/goose/recipes/`                     |
| `subagents`   | `https://goose-docs.ai/docs/guides/context-engineering/custom-agents/`    | Custom agents (Markdown), `.goose/agents/` + `~/.config/goose/agents/` et al.   |
| `skills`      | `https://goose-docs.ai/docs/guides/context-engineering/using-skills/`     | `.goose/skills/`, `.agents/skills/`, global `~/.config/goose/skills/`           |
| `hooks`       | Open Plugins hooks (`.agents/plugins/<name>/hooks/hooks.json`)            | Eleven `HookEvent` values; no `SubagentStart`/`SubagentStop`                    |
| `permissions` | `https://goose-docs.ai/docs/guides/managing-tools/tool-permissions/`      | Global `~/.config/goose/permission.yaml` (`user` key) in `goose-permissions.ts` |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface     | Anchor                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `rules`     | Root `.goosehints`, nested `.goose/memories`, and plain-Markdown conversion in `goose-rule.ts`    |
| `subagents` | Custom-agent Markdown under `.goose/agents/` and `~/.config/goose/agents/` in `goose-subagent.ts` |
| `commands`  | Top-level recipes under `.goose/recipes/` in `goose-command.ts`                                   |
