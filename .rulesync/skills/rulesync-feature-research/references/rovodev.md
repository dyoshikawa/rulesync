# Rovo Dev Map

## Official Docs

| Feature       | Official docs                                                                       | Upstream surface                                                                             |
| ------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| index         | `https://support.atlassian.com/rovo/docs/use-rovo-dev-cli/`                         | Rovo Dev CLI documentation index                                                             |
| `rules`       | `https://support.atlassian.com/rovo/docs/use-memory-in-rovo-dev-cli/`               | User memory `~/.rovodev/AGENTS.md`, project `AGENTS.md`, `AGENTS.local.md`, legacy migration |
| `mcp`         | `https://support.atlassian.com/rovo/docs/connect-to-an-mcp-server-in-rovo-dev-cli/` | MCP server configuration in Rovo Dev CLI                                                     |
| `subagents`   | `https://support.atlassian.com/rovo/docs/use-subagents-in-rovo-dev-cli/`            | `.rovodev/subagents`, `~/.rovodev/subagents`, Markdown files with YAML frontmatter           |
| `skills`      | `https://support.atlassian.com/rovo/docs/extend-rovo-dev-cli-with-agent-skills/`    | `.rovodev/skills`, Agent Skills directories                                                  |
| `ignore`      | No dedicated Rovo Dev ignore file surface found                                     | No Rulesync Rovo Dev ignore target                                                           |
| `commands`    | No dedicated Rovo Dev custom command file target found                              | No Rulesync Rovo Dev commands target                                                         |
| `hooks`       | No dedicated Rovo Dev hooks file surface found                                      | No Rulesync Rovo Dev hooks target                                                            |
| `permissions` | `https://support.atlassian.com/rovo/docs/use-tools-in-rovo-dev-cli/`                | Tool controls exist upstream; no Rulesync Rovo Dev permissions target                        |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface     | Anchor                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `rules`     | Rovo Dev AGENTS.md memory conversion and project/global roots in `rovodev-rule.ts`                       |
| `mcp`       | Global-only Rovo Dev MCP handling in `rovodev-mcp.ts`                                                    |
| `subagents` | `.rovodev/subagents`, `~/.rovodev/subagents`, and YAML frontmatter conversion in `rovodev-subagent.ts`   |
| `skills`    | `.rovodev/skills`, `.agents/skills` alternative roots, and Agent Skills conversion in `rovodev-skill.ts` |
