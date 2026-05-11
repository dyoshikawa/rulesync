# GitHub Copilot CLI Map

## Official Docs

| Feature       | Official docs                                                                                           | Upstream surface                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| index         | `https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/overview`                     | Copilot CLI customization overview                                                                                                     |
| `rules`       | `https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions`      | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, local instructions |
| `ignore`      | No dedicated Copilot CLI ignore surface found                                                           | No Rulesync Copilot CLI ignore target                                                                                                  |
| `mcp`         | `https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers`              | MCP servers, user `~/.copilot/mcp-config.json`, project MCP config precedence                                                          |
| `commands`    | No dedicated Copilot CLI custom command file surface found                                              | No Rulesync Copilot CLI commands target                                                                                                |
| `subagents`   | `https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli` | Custom agent profiles used as subagents, `.github/agents/*.agent.md`, `~/.copilot/agents/*.agent.md`                                   |
| `skills`      | `https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills`                   | Agent skills in `.github/skills`, `.claude/skills`, `.agents/skills`, `~/.copilot/skills`, `~/.agents/skills`                          |
| `hooks`       | `https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks`                    | `.github/hooks/<name>.json`, hook events, `bash`/`powershell` command entries                                                          |
| `permissions` | `https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools`                 | Tool allow/deny behavior and interactive approval                                                                                      |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `rules`       | `copilotcli-rule.ts` reuses `CopilotRule` custom-instruction conversion                                                    |
| `mcp`         | Copilot CLI type injection, transport normalization, and `.copilot/mcp-config.json` in `copilotcli-mcp.ts`                 |
| `subagents`   | `CopilotCliSubagentFrontmatterSchema`, `.agent.md` suffix conversion, and project/global paths in `copilotcli-subagent.ts` |
| `hooks`       | Copilot event-name maps, `bash`/`powershell` command field selection, and CLI-specific hook paths in `copilotcli-hooks.ts` |
| `permissions` | No Copilot CLI permissions adapter                                                                                         |
