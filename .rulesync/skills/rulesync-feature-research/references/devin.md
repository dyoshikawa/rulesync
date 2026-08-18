# Devin Map

## Official Docs

| Feature       | Official docs                                                     | Upstream surface                                                                                                                           |
| ------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| index         | `https://docs.devin.ai/cli`                                       | Devin Local (Devin CLI) quickstart; extensibility index at `/cli/extensibility` (`/cli/overview` now 404s)                                 |
| `rules`       | `https://docs.devin.ai/cli/extensibility/rules`                   | `.devin/rules/*.md` + root `AGENTS.md`/`AGENTS.local.md` (project), `~/.devin/rules/*.md` + `~/.config/devin/AGENTS.md` (global)           |
| `ignore`      | `https://docs.devin.ai/desktop/context-awareness/windsurf-ignore` | Three project files with no documented precedence: `.devinignore`, `.codeiumignore`, `.windsurfignore`; global `~/.codeium/.codeiumignore` |
| `mcp`         | `https://docs.devin.ai/cli/extensibility/mcp/overview`            | `mcpServers` key in `.devin/config.json` / `~/.config/devin/config.json`                                                                   |
| `commands`    | `https://docs.devin.ai/cli/extensibility/skills/overview`         | No separate commands file surface: a skill IS the slash command (`/skill-name`), and plugin skills are `/<plugin>:<skill>`                 |
| `subagents`   | `https://docs.devin.ai/cli/subagents`                             | Subagent profiles under `.devin/agents/`, global `~/.config/devin/agents/`                                                                 |
| `skills`      | `https://docs.devin.ai/cli/extensibility/skills/overview`         | `<name>/SKILL.md` under `.devin/skills/` (also `.agents/`, `.windsurf/`); global `~/.config/devin/skills/` (also `~/.codeium/<channel>/`)  |
| `hooks`       | `https://docs.devin.ai/cli/extensibility/hooks/overview`          | Claude-style events, `.devin/hooks.v1.json` / `hooks` key in `config.json`                                                                 |
| `permissions` | `https://docs.devin.ai/cli/reference/permissions`                 | `permissions` block (allow/deny/ask) in `config.json`, `Read/Write/Exec/Fetch`                                                             |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rules`       | Project `.devin/rules/*.md` + root `AGENTS.md`/`AGENTS.local.md`; global `~/.devin/rules/*.md` + plain `~/.config/devin/AGENTS.md` root, in `devin-rule.ts`        |
| `mcp`         | `mcpServers` key in `.devin/config.json` (project), `~/.config/devin/config.json` (global), merged with siblings in `devin-mcp.ts`                                 |
| `hooks`       | Project `.devin/hooks.v1.json` (top-level event map), global `hooks` key in `~/.config/devin/config.json`, Claude-style events in `devin-hooks.ts`                 |
| `permissions` | `permissions` block (allow/deny/ask, `Read/Write/Exec/Fetch` matchers) in `config.json`, deny > ask > allow precedence in `devin-permissions.ts`                   |
| `ignore`      | Emits `.devinignore`; import falls back to `.codeiumignore` then `.windsurfignore` in `devin-ignore.ts`                                                            |
| `skills`      | Project `.devin/skills`, global `~/.config/devin/skills`, Agent Skills conversion in `devin-skill.ts`; `devin-command.ts` emits commands into the same skills tree |
