# Deep Agents CLI Map

## Official Docs

| Feature       | Official docs                                                                | Upstream surface                                                                                                 |
| ------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| index         | `https://docs.langchain.com/oss/javascript/deepagents/cli/overview`          | Deep Agents CLI overview                                                                                         |
| `rules`       | `https://docs.langchain.com/oss/javascript/deepagents/cli/overview`          | AGENTS.md files, memory, persistent project context                                                              |
| `ignore`      | No dedicated upstream ignore surface found                                   | No Rulesync-supported Deep Agents ignore target                                                                  |
| `mcp`         | `https://docs.langchain.com/oss/javascript/deepagents/cli/overview`          | MCP tools surfaced through CLI configuration                                                                     |
| `commands`    | No dedicated upstream commands surface found                                 | No Rulesync-supported Deep Agents commands target                                                                |
| `subagents`   | `https://docs.langchain.com/oss/javascript/deepagents/cli/overview`          | `task` delegation to subagents                                                                                   |
| `skills`      | `https://docs.langchain.com/oss/javascript/deepagents/cli/memory-and-skills` | `.deepagents/skills`, `.agents/skills`, `~/.deepagents/<agent>/skills`, progressive skill loading                |
| `hooks`       | No dedicated upstream hooks surface found                                    | Rulesync maps `.deepagents/hooks.json`; verify upstream before expanding hook behavior                           |
| `permissions` | `https://docs.langchain.com/oss/javascript/deepagents/cli/overview`          | CLI approval controls and non-interactive shell allow list; no Rulesync-supported Deep Agents permissions target |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface     | Anchor                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| `rules`     | `.deepagents/AGENTS.md` root file and `.deepagents/memories` non-root memories in `deepagents-rule.ts`     |
| `mcp`       | `.deepagents/.mcp.json`, `mcpServers`, and project/global handling in `deepagents-mcp.ts`                  |
| `subagents` | `.deepagents/agents` project subagent directory in `deepagents-subagent.ts`                                |
| `skills`    | `.deepagents/skills` project skill directory in `deepagents-skill.ts`                                      |
| `hooks`     | `.deepagents/hooks.json`, flat hook entries, and `DEEPAGENTS_HOOK_EVENTS` mapping in `deepagents-hooks.ts` |
