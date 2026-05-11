# Factory Droid Map

## Official Docs

| Feature       | Official docs                                             | Upstream surface                                                                         |
| ------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| index         | `https://docs.factory.ai/cli/getting-started/quickstart`  | Factory Droid CLI documentation                                                          |
| `rules`       | `https://docs.factory.ai/cli/configuration/agents-md`     | `AGENTS.md`, nested AGENTS.md, personal `~/.factory/AGENTS.md`                           |
| `mcp`         | `https://docs.factory.ai/cli/configuration/mcp`           | `.factory/mcp.json`, `~/.factory/mcp.json`, stdio and HTTP servers                       |
| `commands`    | `https://docs.factory.ai/cli/configuration/skills`        | Legacy `.factory/commands` files, now merged with skills                                 |
| `subagents`   | `https://docs.factory.ai/cli/configuration/custom-droids` | Custom droids in `.factory/droids` and `~/.factory/droids`                               |
| `skills`      | `https://docs.factory.ai/cli/configuration/skills`        | `.factory/skills/<name>/SKILL.md`, `skill.mdx`, invocation controls                      |
| `hooks`       | `https://docs.factory.ai/reference/hooks-reference`       | `.factory/settings.json`, hook events, matcher groups, command hooks                     |
| `permissions` | `https://docs.factory.ai/cli/configuration/settings`      | `commandAllowlist`, `commandDenylist`, autonomy settings; no Rulesync permissions target |
| `ignore`      | No dedicated Factory Droid ignore file surface found      | No Rulesync Factory Droid ignore target                                                  |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface     | Anchor                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `rules`     | Project `AGENTS.md`, global `.factory/AGENTS.md`, and `.factory/rules` non-root path in `factorydroid-rule.ts` |
| `mcp`       | `.factory/mcp.json`, stdio/HTTP server conversion, and project/global handling in `factorydroid-mcp.ts`        |
| `commands`  | Simulated command conversion under `.factory/commands` in `factorydroid-command.ts`                            |
| `subagents` | Simulated custom droid conversion under `.factory/droids` in `factorydroid-subagent.ts`                        |
| `skills`    | Simulated skill conversion under `.factory/skills` in `factorydroid-skill.ts`                                  |
| `hooks`     | `.factory/settings.json`, Factory hook events, and matcher conversion in `factorydroid-hooks.ts`               |
