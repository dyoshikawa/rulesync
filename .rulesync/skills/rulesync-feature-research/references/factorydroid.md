# Factory Droid Map

## Official Docs

| Feature       | Official docs                                                     | Upstream surface                                                                                                |
| ------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| index         | `https://docs.factory.ai/cli/getting-started/quickstart`          | Factory Droid CLI documentation                                                                                 |
| `rules`       | `https://docs.factory.ai/cli/configuration/agents-md`             | `AGENTS.md`, nested AGENTS.md, personal `~/.factory/AGENTS.md`                                                  |
| `ignore`      | No dedicated upstream ignore surface in map                       | No Rulesync-supported Factory Droid ignore target in map                                                        |
| `mcp`         | `https://docs.factory.ai/cli/configuration/mcp`                   | `.factory/mcp.json`, `~/.factory/mcp.json`, stdio and HTTP servers                                              |
| `commands`    | `https://docs.factory.ai/cli/configuration/custom-slash-commands` | `.factory/commands` and `~/.factory/commands`, `description`/`argument-hint` frontmatter only (no tool scoping) |
| `subagents`   | `https://docs.factory.ai/cli/configuration/custom-droids`         | Custom droids in `.factory/droids` and `~/.factory/droids`                                                      |
| `skills`      | `https://docs.factory.ai/cli/configuration/skills`                | `.factory/skills/<name>/SKILL.md`, `skill.mdx`, invocation controls                                             |
| `hooks`       | `https://docs.factory.ai/reference/hooks-reference`               | `.factory/hooks.json` and `~/.factory/hooks.json`, hook events, matcher groups, command-type hooks only         |
| `permissions` | `https://docs.factory.ai/cli/configuration/settings`              | `commandAllowlist`, `commandDenylist`, autonomy settings                                                        |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface     | Anchor                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `rules`     | Project `AGENTS.md`, global `.factory/AGENTS.md`, and `.factory/rules` non-root path in `factorydroid-rule.ts`                  |
| `mcp`       | `.factory/mcp.json`, stdio/HTTP server conversion, and project/global handling in `factorydroid-mcp.ts`                         |
| `commands`  | Native command files under `.factory/commands` in `factorydroid-command.ts`                                                     |
| `subagents` | Native custom droids under `.factory/droids` in `factorydroid-subagent.ts`                                                      |
| `skills`    | Native skills under `.factory/skills` in `factorydroid-skill.ts`                                                                |
| `hooks`     | `.factory/hooks.json` (legacy `settings.json` fallback), Factory hook events, and matcher conversion in `factorydroid-hooks.ts` |
