# Kilo Code Map

## Official Docs

| Feature       | Official docs                                                          | Upstream surface                                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| index         | `https://kilo.ai/docs/`                                                | Kilo Code documentation index                                                                                                                                                                                             |
| `rules`       | `https://kilo.ai/docs/customize/custom-instructions`                   | Custom instructions, `.kilo/rules-*`, `.kilorules-*`, mode-specific instructions                                                                                                                                          |
| `ignore`      | `https://kilo.ai/docs/customize/context/kilocodeignore`                | `.kilocodeignore` access-control surface, gitignore syntax, workspace root only; Rulesync emits the same name                                                                                                             |
| `mcp`         | `https://kilo.ai/docs/automate/mcp/using-in-kilo-code`                 | `kilo.jsonc`, `.kilo/kilo.jsonc`, global `~/.config/kilo/kilo.jsonc`, MCP tool permissions                                                                                                                                |
| `commands`    | `https://kilo.ai/docs/customize/custom-modes`                          | Mode and workflow customization surfaces                                                                                                                                                                                  |
| `subagents`   | `https://kilo.ai/docs/customize/custom-subagents`                      | `.kilo/agents` (project) and `~/.config/kilo/agents` (global); file name is the `@agent` id                                                                                                                               |
| `skills`      | `https://kilo.ai/docs/customize/skills`                                | `.kilo/skills`, `~/.kilo/skills`, plus `.agents/skills` / `.claude/skills` compatibility roots and `kilo.jsonc` `skills.paths` / `skills.urls`; the platform no longer uses mode-specific skill directories               |
| `hooks`       | `https://kilo.ai/docs/automate/extending/plugins`                      | Plugin modules auto-registered from `.kilo/plugins` and `~/.config/kilo/plugins`, each also in its singular `plugin/` form (plus the legacy `.kilocode/plugin/`); lifecycle/tool/chat hooks plus a catch-all `event` hook |
| `permissions` | `https://kilo.ai/docs/getting-started/settings/auto-approving-actions` | `kilo.jsonc` permission values, `allow`/`ask`/`deny`, built-in and MCP tool permission keys                                                                                                                               |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `rules`       | `.kilo/rules` style paths and custom-instruction conversion in `kilo-rule.ts`                           |
| `ignore`      | `.kilocodeignore` passthrough in `kilo-ignore.ts` (`KILO_IGNORE_FILE_NAME`)                             |
| `mcp`         | Kilo JSONC config, server normalization, and permissions-aware MCP handling in `kilo-mcp.ts`            |
| `commands`    | Kilo command file conversion and project/global roots in `kilo-command.ts`                              |
| `skills`      | `.kilo/skills` in both scopes (`KILO_SKILLS_DIR_PATH`) in `kilo-skill.ts`                               |
| `permissions` | Kilo `permission` object conversion, JSONC fallback, and tool category mapping in `kilo-permissions.ts` |
| `subagents`   | `.kilo/agents` and `~/.config/kilo/agents` in `kilo-subagent.ts` (README claims project and global)     |
| `hooks`       | `rulesync-hooks.js` plugin module under `.kilo/plugins` / `~/.config/kilo/plugins` in `kilo-hooks.ts`   |
