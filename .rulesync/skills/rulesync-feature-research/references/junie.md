# JetBrains Junie Map

## Official Docs

| Feature       | Official docs                                                          | Upstream surface                                                      |
| ------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| index         | `https://junie.jetbrains.com/docs/junie-ide-plugin.html`               | Junie IDE plugin and CLI documentation                                |
| `rules`       | `https://junie.jetbrains.com/docs/junie-ide-plugin.html`               | `.junie/AGENTS.md`, root `AGENTS.md`, legacy guidelines               |
| `ignore`      | `https://www.jetbrains.com/help/ai-assistant/junie-agent.html`         | `.aiignore` restrictions in JetBrains IDE integration                 |
| `mcp`         | `https://www.jetbrains.com/help/junie/model-context-protocol-mcp.html` | `.junie/mcp/mcp.json`, `~/.junie/mcp/mcp.json`, stdio MCP servers     |
| `commands`    | `https://junie.jetbrains.com/docs/slash-commands.html`                 | Custom slash commands and Junie CLI command locations                 |
| `subagents`   | `https://junie.jetbrains.com/docs/parameters.html`                     | Agent location flags and default per-user/per-project agent discovery |
| `skills`      | `https://junie.jetbrains.com/docs/parameters.html`                     | Skill location flags and default per-user/per-project skill discovery |
| `permissions` | `https://www.jetbrains.com/help/junie/action-allowlist.html`           | Action Allowlist; no Rulesync Junie permissions target                |
| `hooks`       | No dedicated Junie hooks file surface found                            | No Rulesync Junie hooks target                                        |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface     | Anchor                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------- |
| `rules`     | `.junie/AGENTS.md`, fallback AGENTS.md behavior, and guideline conversion in `junie-rule.ts` |
| `ignore`    | `.aiignore` passthrough in `junie-ignore.ts`                                                 |
| `mcp`       | `.junie/mcp/mcp.json`, global MCP root, and stdio server handling in `junie-mcp.ts`          |
| `commands`  | `.junie/commands` command conversion and project/global paths in `junie-command.ts`          |
| `subagents` | `.junie/agents` custom-agent conversion in `junie-subagent.ts`                               |
| `skills`    | `.junie/skills` Agent Skills conversion in `junie-skill.ts`                                  |
