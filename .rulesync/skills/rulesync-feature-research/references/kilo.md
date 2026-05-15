# Kilo Code Map

## Official Docs

| Feature       | Official docs                                                          | Upstream surface                                                                            |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| index         | `https://kilo.ai/docs/`                                                | Kilo Code documentation index                                                               |
| `rules`       | `https://kilo.ai/docs/customize/custom-instructions`                   | Custom instructions, `.kilo/rules-*`, `.kilorules-*`, mode-specific instructions            |
| `ignore`      | `https://kilo.ai/docs/customize/context/kilocodeignore`                | `.kilocodeignore` access-control surface; Rulesync currently maps `.kiloignore`             |
| `mcp`         | `https://kilo.ai/docs/automate/mcp/using-in-kilo-code`                 | `kilo.jsonc`, `.kilo/kilo.jsonc`, global `~/.config/kilo/kilo.jsonc`, MCP tool permissions  |
| `commands`    | `https://kilo.ai/docs/customize/custom-modes`                          | Mode and workflow customization surfaces; Rulesync maps command files                       |
| `subagents`   | `https://kilo.ai/docs/customize/custom-subagents`                      | Adapter exists in source, but no README-supported Rulesync Kilo subagents target            |
| `skills`      | `https://kilo.ai/docs/customize/skills`                                | `.kilocode/skills`, `~/.kilocode/skills`, mode-specific `skills-{mode}` directories         |
| `hooks`       | No dedicated upstream hooks surface in map                             | Adapter exists in source, but no README-supported Rulesync Kilo hooks target                |
| `permissions` | `https://kilo.ai/docs/getting-started/settings/auto-approving-actions` | `kilo.jsonc` permission values, `allow`/`ask`/`deny`, built-in and MCP tool permission keys |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `rules`       | `.kilo/rules` style paths and custom-instruction conversion in `kilo-rule.ts`                           |
| `ignore`      | `.kiloignore` passthrough in `kilo-ignore.ts`                                                           |
| `mcp`         | Kilo JSONC config, server normalization, and permissions-aware MCP handling in `kilo-mcp.ts`            |
| `commands`    | Kilo command file conversion and project/global roots in `kilo-command.ts`                              |
| `skills`      | `.kilocode/skills` and global skill roots in `kilo-skill.ts`                                            |
| `permissions` | Kilo `permission` object conversion, JSONC fallback, and tool category mapping in `kilo-permissions.ts` |
| `subagents`   | `kilo-subagent.ts` exists; verify processor support because README does not claim the feature           |
| `hooks`       | `kilo-hooks.ts` exists; verify processor support because README does not claim the feature              |
