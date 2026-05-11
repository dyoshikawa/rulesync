# GitHub Copilot Map

## Official Docs

| Feature       | Official docs                                                                                                     | Upstream surface                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| index         | `https://docs.github.com/en/copilot`                                                                              | GitHub Copilot documentation index                                                                   |
| `rules`       | `https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions`            | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, agent instruction files |
| `mcp`         | `https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-chat-with-mcp`                          | `.vscode/mcp.json`, MCP server definitions                                                           |
| `commands`    | `https://docs.github.com/en/copilot/concepts/about-customizing-github-copilot-chat-responses`                     | Prompt files such as `.github/prompts/*.prompt.md`                                                   |
| `subagents`   | `https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents`                              | Agent profiles in `.github/agents/*.md`                                                              |
| `skills`      | `https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills` | Agent skills in `.github/skills/<name>/SKILL.md`                                                     |
| `hooks`       | `https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-hooks`                                     | Repository hooks in `.github/hooks/*.json`                                                           |
| `ignore`      | No dedicated GitHub Copilot ignore file surface found                                                             | No Rulesync Copilot ignore target                                                                    |
| `permissions` | No repository-level Copilot permission file surface found                                                         | No Rulesync Copilot permissions target                                                               |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface     | Anchor                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `rules`     | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, and frontmatter in `copilot-rule.ts` |
| `mcp`       | `.vscode/mcp.json` and `{ servers: ... }` shape in `copilot-mcp.ts`                                               |
| `commands`  | `.github/prompts/*.prompt.md` prompt-file conversion in `copilot-command.ts`                                      |
| `subagents` | `.github/agents/*.agent.md`, `tools`, and `agent/runSubagent` handling in `copilot-subagent.ts`                   |
| `skills`    | `.github/skills/<name>/SKILL.md` project-only skill directories in `copilot-skill.ts`                             |
| `hooks`     | `.github/hooks/copilot-hooks.json`, `COPILOT_HOOK_EVENTS`, and event-name mapping in `copilot-hooks.ts`           |
