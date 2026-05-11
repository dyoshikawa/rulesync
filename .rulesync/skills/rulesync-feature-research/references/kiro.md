# Kiro Map

## Official Docs

| Feature       | Official docs                                         | Upstream surface                                                              |
| ------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| index         | `https://kiro.dev/docs/`                              | Kiro IDE documentation index                                                  |
| `rules`       | `https://kiro.dev/docs/steering/`                     | `.kiro/steering`, global `~/.kiro/steering`, AGENTS.md steering directives    |
| `ignore`      | No dedicated upstream ignore surface in map           | Rulesync maps `.kiroignore`; verify upstream before extending ignore behavior |
| `mcp`         | `https://kiro.dev/docs/mcp/`                          | MCP server configuration and prompt/resource mentions                         |
| `commands`    | `https://kiro.dev/docs/chat/slash-commands/`          | Slash commands for hooks, steering files, and skill commands                  |
| `subagents`   | `https://kiro.dev/docs/cli/reference/slash-commands/` | `/agent` command, `.kiro/agents`, `~/.kiro/agents`                            |
| `skills`      | `https://kiro.dev/docs/skills/`                       | `.kiro/skills`, `~/.kiro/skills`, Agent Skills standard                       |
| `hooks`       | `https://kiro.dev/docs/hooks/`                        | Agent hooks for IDE events and manual triggers                                |
| `permissions` | `https://kiro.dev/docs/cli/reference/slash-commands/` | `/tools` permissions and trusted tools                                        |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------- |
| `rules`       | `.kiro/steering` conversion, AGENTS.md handling, and steering metadata in `kiro-rule.ts` |
| `ignore`      | `.kiroignore` passthrough in `kiro-ignore.ts`                                            |
| `mcp`         | Kiro MCP JSON conversion and server normalization in `kiro-mcp.ts`                       |
| `commands`    | `.kiro/prompts` command file conversion in `kiro-command.ts`                             |
| `subagents`   | `.kiro/agents/*.json` custom-agent conversion in `kiro-subagent.ts`                      |
| `skills`      | `.kiro/skills/<name>/SKILL.md` project skill conversion in `kiro-skill.ts`               |
| `permissions` | Kiro permissions mapping and tool trust config conversion in `kiro-permissions.ts`       |
