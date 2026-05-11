# Gemini CLI Map

## Official Docs

| Feature       | Official docs                                                                           | Upstream surface                                                                              |
| ------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| index         | `https://github.com/google-gemini/gemini-cli/blob/main/docs/index.md`                   | Gemini CLI docs index                                                                         |
| `rules`       | `https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md`           | `GEMINI.md`, context hierarchy, imports, configurable context file names                      |
| `ignore`      | `https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-ignore.md`       | `.geminiignore`, file filtering settings                                                      |
| `mcp`         | `https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md`        | `settings.json` `mcpServers`, stdio/SSE/HTTP transports, tool include/exclude settings        |
| `commands`    | `https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/custom-commands.md`     | `.gemini/commands/*.toml`, `description`, `prompt`, `{{args}}`, `!{...}`                      |
| `subagents`   | `https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md`          | `.gemini/agents/*.md`, YAML frontmatter, tools, MCP, model, run limits                        |
| `skills`      | `https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/skills.md`              | Agent skills management commands, `.gemini/skills`, reload/list/install/enable/disable        |
| `hooks`       | `https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/writing-hooks.md`     | `.gemini/settings.json` hooks, matcher groups, command hooks, hook-specific JSON output       |
| `permissions` | `https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md` | Policy engine, approval modes, `allowed-tools`, `allowed-mcp-server-names`, security settings |

## Client Anchors

Common adapter paths: `rulesync-source-map.md`.

| Surface       | Anchor                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `rules`       | `GEMINI.md`, `.gemini/memories`, global `.gemini/GEMINI.md`, and plain Markdown conversion in `geminicli-rule.ts`                     |
| `ignore`      | `.geminiignore` conversion in `geminicli-ignore.ts`                                                                                   |
| `mcp`         | `settings.json` `mcpServers` merge and non-deletable settings behavior in `geminicli-mcp.ts`                                          |
| `commands`    | TOML command parsing, `{{args}}` and `!{...}` syntax translation, and `.gemini/commands` paths in `geminicli-command.ts`              |
| `subagents`   | `.gemini/agents/*.md` schema and frontmatter passthrough in `geminicli-subagent.ts`                                                   |
| `skills`      | `.gemini/skills/<name>/SKILL.md` schema and supporting-file copy in `geminicli-skill.ts`                                              |
| `hooks`       | `GEMINICLI_HOOK_EVENTS`, PascalCase event maps, matcher grouping, and `$GEMINI_PROJECT_DIR` command rewriting in `geminicli-hooks.ts` |
| `permissions` | Policy TOML generation/import, tool-name maps, priority ordering, and glob-to-regex conversion in `geminicli-permissions.ts`          |
