# Plugin Packaging

Rulesync can generate and import configuration components inside existing Claude Code and Google Antigravity plugin directories. Use the packaging targets when the files are distributed as a plugin instead of being installed directly as project or user configuration:

- `claudecode-plugin`
- `antigravity-plugin`

Packaging targets are project-scope only and are intentionally excluded from `--targets "*"`. Their component directories, such as `skills/` and `rules/`, live directly under the output root and could otherwise collide with ordinary project directories.

## Generate into a plugin

Point `--output-roots` at the plugin root:

```bash
rulesync generate \
  --targets claudecode-plugin \
  --features mcp,commands,subagents,skills,hooks \
  --output-roots ./plugins/review-tools

rulesync generate \
  --targets antigravity-plugin \
  --features rules,mcp,skills,hooks \
  --output-roots ./plugins/review-tools
```

The same configuration can be persisted in `rulesync.jsonc`:

```jsonc
{
  "outputRoots": {
    "claudecode-plugin": "./plugins/claude-review-tools",
    "antigravity-plugin": "./plugins/antigravity-review-tools",
  },
  "targets": {
    "claudecode-plugin": ["mcp", "commands", "subagents", "skills", "hooks"],
    "antigravity-plugin": ["rules", "mcp", "skills", "hooks"],
  },
}
```

Rulesync manages the selected component files but does not create or modify plugin metadata, marketplace catalogs, scripts, or other package assets. Keep the required upstream manifest in the plugin directory:

- Claude Code: `.claude-plugin/plugin.json` when the plugin uses a manifest
- Antigravity: `plugin.json`

The plugin root must already exist. Rulesync rejects symbolic links anywhere in the plugin tree before importing, generating, or deleting files so package components cannot escape the selected root.

`--delete` reconciles the selected Rulesync-managed component trees, so do not mix hand-authored files into a component tree that Rulesync owns.

## Import from a plugin

Use `--output-root` to identify the plugin directory to read. Imported canonical files are written to `.rulesync/` in the current working directory:

```bash
rulesync import \
  --targets claudecode-plugin \
  --features mcp,commands,subagents,skills,hooks \
  --output-root ./plugins/review-tools

rulesync import \
  --targets antigravity-plugin \
  --features rules,mcp,skills,hooks \
  --output-root ./plugins/review-tools
```

The `convert` command does not accept packaging targets because it has no separate source and destination plugin roots. Import from the source plugin first, then generate into the destination plugin.

## Component paths

| Target               | Rules        | MCP               | Commands        | Subagents     | Skills              | Hooks              |
| -------------------- | ------------ | ----------------- | --------------- | ------------- | ------------------- | ------------------ |
| `claudecode-plugin`  | —            | `.mcp.json`       | `commands/*.md` | `agents/*.md` | `skills/*/SKILL.md` | `hooks/hooks.json` |
| `antigravity-plugin` | `rules/*.md` | `mcp_config.json` | —               | —             | `skills/*/SKILL.md` | `hooks.json`       |

Claude-specific frontmatter and hook overrides continue to use the `claudecode` sections in Rulesync source files. Antigravity plugin output uses the `antigravity-ide` conversion model and override sections because its plugin components follow the Antigravity IDE format.

## Claude Code plugin constraints

Claude Code applies rules to plugin-shipped components that do not apply to the same components installed directly in a project, so `claudecode-plugin` output differs from `claudecode` output in two ways:

- **Hook commands resolve against the plugin, not the consumer's project.** A relative hook command such as `./scripts/fmt.sh` is written as `"$CLAUDE_PLUGIN_ROOT"/scripts/fmt.sh` (the exec form uses the braced `${CLAUDE_PLUGIN_ROOT}/…` placeholder). `$CLAUDE_PROJECT_DIR`, used for the `claudecode` target, would point into each consumer's own repository, where the bundled script does not exist. Import recognizes both forms and converts them back to the relative command. To point at something in the consumer's project instead, write the command with an explicit leading variable, such as `$CLAUDE_PROJECT_DIR/scripts/hook.sh`; commands that already start with a variable are passed through untouched.
- **`hooks`, `mcpServers`, and `permissionMode` are dropped from subagent frontmatter.** Claude Code does not support them for plugin-shipped agents, so Rulesync omits them with a warning rather than writing frontmatter that is silently discarded. `isolation` is likewise dropped unless it is `worktree`, the only value plugin agents accept. Importing from a plugin cannot recover fields that were never written, so keep the canonical `.rulesync/subagents/*.md` files as the source of truth.

Independently of packaging, Rulesync warns when a Claude Code subagent name contains `:`, which Claude Code reserves for plugin namespacing (`<plugin>:<agent>`) and rejects in agent Markdown files.

See the [Claude Code plugins reference](https://code.claude.com/docs/en/plugins-reference) for the upstream rules.

## Installing a `claudecode-plugin` bundle in JetBrains Junie

[Junie CLI Extensions](https://junie.jetbrains.com/docs/junie-cli-extensions.html) — Junie's bundle system for skills, MCP servers, subagents, slash commands, and guidelines — accept two marketplace manifest formats: the native `.junie-extension/marketplace.json` and Claude Code's `.claude-plugin/marketplace.json`. A plugin generated with the `claudecode-plugin` target and published in a Claude-compatible plugin marketplace is therefore installable in Junie via `/extensions`, without a Junie-specific rulesync target.

As with Claude Code, rulesync manages only the component files (`commands/`, `agents/`, `skills/`, `.mcp.json`, `hooks/hooks.json`); the `.claude-plugin/plugin.json` and marketplace catalog remain hand-authored. Junie's documentation confirms the manifest-format compatibility but does not enumerate a directory-level mapping for Claude plugin contents, so verify the components you care about after installing.
