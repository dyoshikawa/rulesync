# JetBrains Junie Map

## Official Docs

| Feature       | Official docs                                                       | Upstream surface                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| index         | `https://junie.jetbrains.com/docs/junie-ide-plugin.html`            | Junie IDE plugin and CLI documentation                                                                                                                                                                                                     |
| `rules`       | `https://junie.jetbrains.com/docs/junie-ide-plugin.html`            | `.junie/AGENTS.md`, root `AGENTS.md`, legacy guidelines                                                                                                                                                                                    |
| `ignore`      | `https://junie.jetbrains.com/docs/junie-ide-plugin.html`            | `.aiignore` restrictions (IDE integration)                                                                                                                                                                                                 |
| `mcp`         | `https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html` | `.junie/mcp/mcp.json`, `~/.junie/mcp/mcp.json`, stdio and remote MCP servers                                                                                                                                                               |
| `commands`    | `https://junie.jetbrains.com/docs/slash-commands.html`              | Custom slash commands and Junie CLI command locations                                                                                                                                                                                      |
| `subagents`   | `https://junie.jetbrains.com/docs/junie-cli-subagents.html`         | `.junie/agents` custom agents plus `.agents/` / `~/.agents/` discovery roots                                                                                                                                                               |
| `skills`      | `https://junie.jetbrains.com/docs/agent-skills.html`                | `.junie/skills` and Agent Skills discovery                                                                                                                                                                                                 |
| `hooks`       | `https://junie.jetbrains.com/docs/junie-cli-hooks.html`             | Junie CLI hooks (global `~/.junie/config.json`; project `.junie/config.json` hooks are ignored unless passed via `--config-location`)                                                                                                      |
| `permissions` | `https://junie.jetbrains.com/docs/action-allowlist.html`            | Action Allowlist                                                                                                                                                                                                                           |
| extensions    | `https://junie.jetbrains.com/docs/junie-cli-extensions.html`        | CLI Extensions bundles (native `.junie-extension/marketplace.json` + Claude-compatible `.claude-plugin/marketplace.json`); no dedicated rulesync target — a `claudecode-plugin` bundle is installable through the Claude-compatible format |

CLI docs live under `junie.jetbrains.com/docs/*` (old `jetbrains.com/help/junie/*` URLs 301-redirect; `/docs/cli`, `/docs/changelog`, `/docs/rules`, `/docs/cli/rules`, `/docs/cli/workflows` 404).

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
| `hooks`     | Global `~/.junie/config.json` hooks conversion in `junie-hooks.ts`                           |
