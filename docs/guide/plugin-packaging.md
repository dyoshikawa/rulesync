# Plugin Packaging

Rulesync can generate and import configuration components inside existing Claude Code, Google Antigravity, AugmentCode (Auggie) and ZCode plugin directories. Use the packaging targets when the files are distributed as a plugin instead of being installed directly as project or user configuration:

- `claudecode-plugin`
- `antigravity-plugin`
- `augmentcode-plugin`
- `zcode-plugin`

Packaging targets are project-scope only and are intentionally excluded from `--targets "*"`. With `--global`, `generate` skips an explicitly requested packaging target with a warning, and `import` rejects it with an error. Their component directories, such as `skills/` and `rules/`, live directly under the output root and could otherwise collide with ordinary project directories.

## Generate into a plugin

Point `--output-roots` at the plugin root:

```bash
rulesync generate \
  --targets claudecode-plugin \
  --features mcp,commands,subagents,skills,hooks \
  --output-roots ./plugins/review-tools

rulesync generate \
  --targets antigravity-plugin \
  --features rules,mcp,subagents,skills,hooks \
  --output-roots ./plugins/review-tools

rulesync generate \
  --targets augmentcode-plugin \
  --features rules,mcp,commands,subagents,skills,hooks \
  --output-roots ./plugins/review-tools

rulesync generate \
  --targets zcode-plugin \
  --features mcp,commands,subagents,skills,hooks \
  --output-roots ./plugins/review-tools
```

The same configuration can be persisted in `rulesync.jsonc`:

```jsonc
{
  "outputRoots": {
    "claudecode-plugin": "./plugins/claude-review-tools",
    "antigravity-plugin": "./plugins/antigravity-review-tools",
    "augmentcode-plugin": "./plugins/auggie-review-tools",
    "zcode-plugin": "./plugins/zcode-review-tools",
  },
  "targets": {
    "claudecode-plugin": ["mcp", "commands", "subagents", "skills", "hooks"],
    "antigravity-plugin": ["rules", "mcp", "subagents", "skills", "hooks"],
    "augmentcode-plugin": ["rules", "mcp", "commands", "subagents", "skills", "hooks"],
    "zcode-plugin": ["mcp", "commands", "subagents", "skills", "hooks"],
  },
}
```

Rulesync manages the selected component files but does not create or modify plugin metadata, marketplace catalogs, scripts, or other package assets. Keep the required upstream manifest in the plugin directory:

- Claude Code: `.claude-plugin/plugin.json` when the plugin uses a manifest
- Antigravity: `plugin.json`
- AugmentCode: `.augment-plugin/plugin.json` (Auggie also accepts `.claude-plugin/plugin.json`), plus `.augment-plugin/marketplace.json` at the marketplace root
- ZCode: `.zcode-plugin/plugin.json` (ZCode also accepts `.claude-plugin/plugin.json`)

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
  --features rules,mcp,subagents,skills,hooks \
  --output-root ./plugins/review-tools

rulesync import \
  --targets augmentcode-plugin \
  --features rules,mcp,commands,subagents,skills,hooks \
  --output-root ./plugins/review-tools

rulesync import \
  --targets zcode-plugin \
  --features mcp,commands,subagents,skills,hooks \
  --output-root ./plugins/review-tools
```

The `convert` command does not accept packaging targets because it has no separate source and destination plugin roots. Import from the source plugin first, then generate into the destination plugin.

## Component paths

| Target               | Rules        | MCP               | Commands        | Subagents     | Skills              | Hooks              |
| -------------------- | ------------ | ----------------- | --------------- | ------------- | ------------------- | ------------------ |
| `claudecode-plugin`  | —            | `.mcp.json`       | `commands/*.md` | `agents/*.md` | `skills/*/SKILL.md` | `hooks/hooks.json` |
| `antigravity-plugin` | `rules/*.md` | `mcp_config.json` | —               | `agents/*.md` | `skills/*/SKILL.md` | `hooks.json`       |
| `augmentcode-plugin` | `rules/*.md` | `.mcp.json`       | `commands/*.md` | `agents/*.md` | `skills/*/SKILL.md` | `hooks/hooks.json` |
| `zcode-plugin`       | —            | `.mcp.json`       | `commands/*.md` | `agents/*.md` | `skills/*/SKILL.md` | `hooks/hooks.json` |

Claude-specific frontmatter and hook overrides continue to use the `claudecode` sections in Rulesync source files. Antigravity plugin output uses the `antigravity-ide` conversion model and override sections because its plugin components follow the Antigravity IDE format.

## AugmentCode plugins

[Auggie plugins](https://docs.augmentcode.com/cli/plugins) use the Claude Code plugin layout plus a `rules/` directory, and Auggie reads plugin rules and skills the same way as the matching `.augment/` directories. The `augmentcode-plugin` target therefore writes each component in the `augmentcode` format — rules keep their `type` / `description` frontmatter from the `augmentcode` section of a Rulesync rule — and `.mcp.json` in the Claude-style `mcpServers` shape Auggie documents for plugins. Auggie namespaces plugin commands and subagents under the plugin, and a nested command directory adds a `:` segment to the command name. Plugin commands and subagents are read more narrowly than their `.augment/` counterparts: a plugin command keeps only its `description` and `model` (Rulesync drops `argument-hint` and any other field with a warning), and a plugin subagent is named after its file and keeps only `description`, `model` and `hidden`. Rulesync therefore drops every other subagent field from the `augmentcode` section (such as `tools`, `disabled_tools` or `color`) with a warning, since Auggie would ignore it; an agent whose tools were restricted runs with the full tool set when shipped in a plugin, so keep it on the `augmentcode` target if the restriction matters. A subagent whose `name` differs from its file name is warned about, because Auggie shows the file name.

Hooks are written to `hooks/hooks.json` as a `{ "hooks": { ... } }` document in the same format as the `hooks` key of `.augment/settings.json` (PascalCase events, `command` hooks only, `timeout` in milliseconds), and the `augmentcode` override section of `.rulesync/hooks.json` applies to it. Rulesync owns the whole file, so it is overwritten on generate rather than merged. Because hook scripts ship inside the plugin, a relative hook command such as `./hooks/format.sh` is written as `"$AUGMENT_PLUGIN_ROOT"/hooks/format.sh` (Auggie sets that variable for plugin hooks and runs such a command through `bash -c`), and the exec form (a hook with `args`) uses the braced `${AUGMENT_PLUGIN_ROOT}/hooks/format.sh` placeholder that Auggie substitutes itself. Later `./` words that name a script the command runs are anchored the same way, while other arguments and bare commands such as `npx prettier --write ./src` are left as written. On Windows, Auggie runs the quoted form through `cmd.exe`, which does not expand `$AUGMENT_PLUGIN_ROOT`, so give a hook `args` (the exec form) when the plugin must run there. Import converts both forms back to the relative command. Auggie's `${AUGGIE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_ROOT}` aliases are passed through verbatim on import.

Since Auggie also accepts `.claude-plugin/` bundles, a `claudecode-plugin` bundle installs in Auggie too, but `claudecode-plugin` does not write `rules/` and its components carry Claude Code frontmatter; use `augmentcode-plugin` when the bundle targets Auggie.

## ZCode plugins

[ZCode plugins](https://zcode.z.ai/en/docs/plugin) use the Claude Code plugin layout without a `rules/` directory, and ZCode parses plugin commands and skills the same way as `.zcode/commands/` and `.zcode/skills/`. The `zcode-plugin` target therefore writes every component in the `zcode` format and reads the `zcode` sections and hook overrides of Rulesync source files. Plugin components differ from their `.zcode/` counterparts in three ways:

- **Subagents keep `permissionMode`.** ZCode reads plugin agents like user agents in `~/.zcode/agents/`, so the `permissionMode` that the project-scope `zcode` target drops is written.
- **MCP servers live in `.mcp.json` under `mcpServers`.** Servers keep ZCode's native shape (stdio `command` / `args` / `env`, remote `type` `http` or `sse` with `url` / `headers`), and a disabled server is written as `enabled: false`, the plugin loader's spelling, rather than the `enable: false` of `.zcode/config.json`. Import also accepts a bare server map without the `mcpServers` wrapper.
- **Hooks live in `hooks/hooks.json` with the event map directly under `hooks`**, without the `enabled` / `events` wrapper of `.zcode/config.json`. Hooks run with the consumer's project as the working directory, so a relative command such as `./scripts/setup.sh` is written as `"$ZCODE_PLUGIN_ROOT"/scripts/setup.sh`; ZCode exports `ZCODE_PLUGIN_ROOT` to plugin hooks. Import converts the anchored form back to the relative command, and skips ZCode `process` hooks with a warning, as the `zcode` target does.

ZCode namespaces plugin agents and MCP servers under the plugin name. Since ZCode also accepts `.claude-plugin/` bundles, a `claudecode-plugin` bundle installs in ZCode too, but its components carry Claude Code frontmatter and its hook commands use `$CLAUDE_PLUGIN_ROOT`; use `zcode-plugin` when the bundle targets ZCode.

## Claude Code plugin constraints

Claude Code applies rules to plugin-shipped components that do not apply to the same components installed directly in a project, so `claudecode-plugin` output differs from `claudecode` output in two ways:

- **Hook commands resolve against the plugin, not the consumer's project.** A relative hook command such as `./scripts/fmt.sh` is written as `"$CLAUDE_PLUGIN_ROOT"/scripts/fmt.sh` (the exec form uses the braced `${CLAUDE_PLUGIN_ROOT}/…` placeholder). `$CLAUDE_PROJECT_DIR`, used for the `claudecode` target, would point into each consumer's own repository, where the bundled script does not exist. Later `./` words that name a file the command runs, such as the script in `node ./scripts/check.js` or `uv run ./scripts/check.py`, or the next command in `./a.sh && ./b.sh`, are anchored to the plugin root the same way. Other arguments are left as written, so `npx prettier --write ./src` still formats the consumer's `src` (see the hook `command` key in [File formats](../reference/file-formats.md#rulesynchooksjsonc) for the exact positions). Import recognizes both forms wherever the variable starts a path and converts them back to the relative command, with a warning for a variable in a position generate does not anchor. To point at something in the consumer's project instead, use `$CLAUDE_PROJECT_DIR` explicitly, such as `$CLAUDE_PROJECT_DIR/scripts/hook.sh`; commands that already start with a variable, quoted or not, are passed through untouched.
- **`hooks`, `mcpServers`, and `permissionMode` are dropped from subagent frontmatter.** Claude Code does not support them for plugin-shipped agents, so Rulesync omits them with a warning rather than writing frontmatter that is silently discarded. `isolation` is likewise dropped unless it is `worktree`, the only value plugin agents accept. Importing from a plugin cannot recover fields that were never written, so keep the canonical `.rulesync/subagents/*.md` files as the source of truth.

Independently of packaging, Rulesync warns when a Claude Code subagent name contains `:`, which Claude Code reserves for plugin namespacing (`<plugin>:<agent>`) and rejects in agent Markdown files.

See the [Claude Code plugins reference](https://code.claude.com/docs/en/plugins-reference) for the upstream rules.

## Installing a `claudecode-plugin` bundle in JetBrains Junie

[Junie CLI Extensions](https://junie.jetbrains.com/docs/junie-cli-extensions.html) — Junie's bundle system for skills, MCP servers, subagents, slash commands, and guidelines — accept two marketplace manifest formats: the native `.junie-extension/marketplace.json` and Claude Code's `.claude-plugin/marketplace.json`. A plugin generated with the `claudecode-plugin` target and published in a Claude-compatible plugin marketplace is therefore installable in Junie via `/extensions`, without a Junie-specific rulesync target.

As with Claude Code, rulesync manages only the component files (`commands/`, `agents/`, `skills/`, `.mcp.json`, `hooks/hooks.json`); the `.claude-plugin/plugin.json` and marketplace catalog remain hand-authored. Junie's [hooks documentation](https://junie.jetbrains.com/docs/junie-cli-hooks.html) ("Packaging hooks in an extension") confirms that an extension's `hooks/hooks.json` in the Claude plugin layout is loaded (same schema as the `hooks` object in Junie's `config.json`, with `${CLAUDE_PLUGIN_ROOT}` and `${JUNIE_EXTENSION_ROOT}` both expanding to the installed extension directory) and merged after config-file hooks. Only Junie's own events apply there — `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop`, `StopFailure`, `PermissionRequest`, and `SessionEnd` — so Claude Code-only events in the bundle take no effect in Junie. For the other components Junie's documentation confirms the manifest-format compatibility but does not enumerate a directory-level mapping, so verify the ones you care about after installing.
