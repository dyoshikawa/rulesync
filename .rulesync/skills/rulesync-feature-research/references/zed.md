# Zed Map

## Official Docs

| Feature       | Official docs                                                                                                              | Upstream surface                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| index         | `https://zed.dev/docs/ai/overview`                                                                                         | Zed AI documentation index                                                                                   |
| `rules`       | `https://zed.dev/docs/ai/instructions`                                                                                     | `.rules`, AGENTS.md-compatible files, global instructions, Rules Library                                     |
| `ignore`      | `https://zed.dev/docs/reference/all-settings#private-files`                                                                | `.zed/settings.json`, `private_files` glob list (`ExtendingVec`, accumulates across scopes)                  |
| `mcp`         | `https://zed.dev/docs/ai/mcp`                                                                                              | `context_servers` in `.zed/settings.json` / global `settings.json`                                           |
| `commands`    | No dedicated upstream commands surface in map                                                                              | Skills double as `/name` slash commands; no native command files (discussion zed-industries/zed#57943)       |
| `subagents`   | No dedicated upstream subagents surface in map                                                                             | Agent profiles and `spawn_agent` are runtime settings, not per-agent definition files                        |
| `skills`      | `https://zed.dev/docs/ai/skills`                                                                                           | Agent Skills (`SKILL.md`); `disable-model-invocation`; description limit counted in characters since v1.20.1 |
| `hooks`       | No dedicated upstream hooks surface in map                                                                                 | No hook surface (discussion zed-industries/zed#57943)                                                        |
| `permissions` | `https://zed.dev/docs/ai/tool-permissions`, `https://zed.dev/docs/ai/sandboxing`, `https://zed.dev/docs/ai/agent-profiles` | `agent.tool_permissions`, `sandbox_permissions`, `agent.profiles`, `agent.default_profile`                   |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `rules`       | `.rules` (project) and global `AGENTS.md` in `zed-rule.ts`                                                           |
| `ignore`      | `.zed/settings.json`, non-deletable settings merge, and `private_files` conversion in `zed-ignore.ts`                |
| `mcp`         | `context_servers` conversion in `zed-mcp.ts`                                                                         |
| `skills`      | `.agents/skills/` emission and the description-length warning in `zed-skill.ts`                                      |
| `permissions` | `ZED_OVERRIDE_AGENT_KEYS` (`sandbox_permissions`, `profiles`) and tool-permission conversion in `zed-permissions.ts` |
