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

## Component paths

| Target               | Rules        | MCP               | Commands        | Subagents     | Skills              | Hooks              |
| -------------------- | ------------ | ----------------- | --------------- | ------------- | ------------------- | ------------------ |
| `claudecode-plugin`  | —            | `.mcp.json`       | `commands/*.md` | `agents/*.md` | `skills/*/SKILL.md` | `hooks/hooks.json` |
| `antigravity-plugin` | `rules/*.md` | `mcp_config.json` | —               | —             | `skills/*/SKILL.md` | `hooks.json`       |

Claude-specific frontmatter and hook overrides continue to use the `claudecode` sections in Rulesync source files. Antigravity plugin output uses the `antigravity-ide` conversion model and override sections because its plugin components follow the Antigravity IDE format.
