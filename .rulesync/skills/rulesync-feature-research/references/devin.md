# Devin Map

## Official Docs

| Feature       | Official docs                                            | Upstream surface                                                                   |
| ------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| index         | `https://docs.devin.ai/cli/overview`                     | Devin Local (Devin CLI) documentation index                                        |
| `rules`       | `https://docs.devin.ai/cli/extensibility/rules`          | `.devin/rules/*.md` (project), `~/.config/devin/AGENTS.md` (global always-on)      |
| `ignore`      | No dedicated upstream ignore surface in map              | Rulesync maps `.devinignore` (legacy `.codeiumignore`); verify upstream behavior   |
| `mcp`         | `https://docs.devin.ai/cli/extensibility/configuration`  | `mcpServers` key in `.devin/config.json` / `~/.config/devin/config.json`           |
| `commands`    | No dedicated upstream commands surface in map            | Devin workflows under `.devin/workflows/*.md`                                      |
| `subagents`   | `https://docs.devin.ai/cli/subagents`                    | Subagent profiles under `.devin/agents/`, global `~/.config/devin/agents/`         |
| `skills`      | No dedicated upstream skills surface in map              | Skills under `.devin/skills/` (project) and `~/.codeium/windsurf/skills/` (global) |
| `hooks`       | `https://docs.devin.ai/cli/extensibility/hooks/overview` | Claude-style events, `.devin/hooks.v1.json` / `hooks` key in `config.json`         |
| `permissions` | `https://docs.devin.ai/cli/reference/permissions`        | `permissions` block (allow/deny/ask) in `config.json`, `Read/Write/Exec/Fetch`     |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules`       | Project `.devin/rules/*.md` (trigger/globs activation), global `~/.config/devin/AGENTS.md` (plain root) in `devin-rule.ts`                         |
| `mcp`         | `mcpServers` key in `.devin/config.json` (project), `~/.config/devin/config.json` (global), merged with siblings in `devin-mcp.ts`                 |
| `hooks`       | Project `.devin/hooks.v1.json` (top-level event map), global `hooks` key in `~/.config/devin/config.json`, Claude-style events in `devin-hooks.ts` |
| `permissions` | `permissions` block (allow/deny/ask, `Read/Write/Exec/Fetch` matchers) in `config.json`, deny > ask > allow precedence in `devin-permissions.ts`   |
| `ignore`      | `.devinignore` (legacy `.codeiumignore`) in `devin-ignore.ts`                                                                                      |
| `skills`      | Project `.devin/skills`, global `.codeium/windsurf/skills`, Agent Skills conversion in `devin-skill.ts`                                            |
