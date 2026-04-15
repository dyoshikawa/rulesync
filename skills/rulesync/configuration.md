# Configuration

You can configure Rulesync by creating a `rulesync.jsonc` file in the root of your project.

## JSON Schema Support

Rulesync provides a JSON Schema for editor validation and autocompletion. Add the `$schema` property to your `rulesync.jsonc`:

```jsonc
// rulesync.jsonc
{
  "$schema": "https://github.com/dyoshikawa/rulesync/releases/latest/download/config-schema.json",
  "targets": ["claudecode"],
  "features": ["rules"],
}
```

## Configuration Options

Example:

```jsonc
// rulesync.jsonc
{
  "$schema": "https://github.com/dyoshikawa/rulesync/releases/latest/download/config-schema.json",

  // List of tools to generate configurations for. You can specify "*" to generate all tools.
  "targets": ["cursor", "claudecode", "geminicli", "opencode", "codexcli"],

  // Features to generate. You can specify "*" to generate all features.
  "features": ["rules", "ignore", "mcp", "commands", "subagents", "hooks"],

  // Alternatively, you can use object format to specify features per target:
  // "features": {
  //   "claudecode": ["rules", "commands"],
  //   "cursor": ["rules", "mcp"],
  // },

  // Base directories for generation.
  // Basically, you can specify a `["."]` only.
  // However, for example, if your project is a monorepo and you have to launch the AI agent at each package directory, you can specify multiple base directories.
  "baseDirs": ["."],

  // Delete existing files before generating
  "delete": true,

  // Verbose output
  "verbose": false,

  // Silent mode - suppress all output (except errors)
  "silent": false,

  // Advanced options
  "global": false, // Generate for global(user scope) configuration files
  "simulateCommands": false, // Generate simulated commands
  "simulateSubagents": false, // Generate simulated subagents
  "simulateSkills": false, // Generate simulated skills

  // When true (default), `rulesync gitignore` only emits entries for the
  // tools listed in `targets`. Set to false to emit entries for all supported
  // tools regardless of `targets`.
  "gitignoreTargetsOnly": true,

  // Declarative skill sources — installed via 'rulesync install'
  // See the "Declarative Skill Sources" section for details.
  // "sources": [
  //   { "source": "owner/repo" },
  //   { "source": "org/repo", "skills": ["specific-skill"] },
  // ],
}
```

## Per-Target Features

The `targets` option accepts both an array and an object format. Use the
object format when you want to declare per-target feature configuration in
a single place — the object keys are the target tools, and each value
carries the features to generate for that tool:

```jsonc
// rulesync.jsonc
{
  "targets": {
    "claudecode": ["rules", "commands"],
    "cursor": ["rules", "mcp"],
    "copilot": ["rules", "subagents"],
  },
}
```

In this example:

- `claudecode` generates rules and commands
- `cursor` generates rules and MCP configuration
- `copilot` generates rules and subagents

> **Important:** When `targets` is in object form, the top-level `features`
> field must be omitted. Declaring both would double-define the target
> set, so the config loader rejects that combination.

You can also use `*` (wildcard) inside a target's value to enable every
feature for that tool:

```jsonc
{
  "targets": {
    "claudecode": ["*"], // Generate all features for Claude Code
    "cursor": ["rules"], // Only rules for Cursor
  },
}
```

### Per-feature options

Some features accept additional configuration. To pass options through, use
the object form for a target's value instead of an array. Each feature key
maps to either `true`/`false` (enable/disable) or an options object.

```jsonc
{
  "targets": {
    "claudecode": {
      "rules": { "ruleDiscoveryMode": "explicit" },
      "ignore": { "fileMode": "local" },
    },
  },
}
```

### Deprecated: object form under `features`

Earlier versions of Rulesync accepted per-target configuration under the
top-level `features` field, paired with a `targets` array. That form is
still parsed for backward compatibility but emits a deprecation warning;
new configs should use the `targets` object form shown above.

> **⚠️ Breaking change in v8.0.0:** mixing `targets` (array) with
> `features` (object) is no longer accepted — the config loader throws.
> If your config previously looked like
> `targets: ["claudecode"], features: { claudecode: {...} }`, migrate to
> the `targets` object form (recommended) or drop the `targets` array and
> keep only the `features` object (deprecated path). The migration is
> mechanical — see the example below.

```jsonc
// ⚠️  Deprecated — still works, logs a warning
{
  "features": {
    "claudecode": { "rules": true, "ignore": { "fileMode": "local" } },
  },
}
```

To silence the deprecation warning (for example, in CI pipelines that
intentionally run on the deprecated form until the migration is scheduled),
set the `RULESYNC_SILENT_DEPRECATION` environment variable to any truthy
value:

```bash
RULESYNC_SILENT_DEPRECATION=1 npx rulesync generate
```

The current per-feature options are:

| Target       | Feature  | Option              | Values                                                                         | Default      |
| ------------ | -------- | ------------------- | ------------------------------------------------------------------------------ | ------------ |
| `claudecode` | `rules`  | `ruleDiscoveryMode` | `"none"` / `"explicit"`                                                        | tool default |
| any          | `rules`  | `includeLocalRoot`  | `true` / `false` (when `false`, `localRoot` rules are skipped for this target) | `true`       |
| `claudecode` | `ignore` | `fileMode`          | `"shared"` (settings.json) / `"local"` (settings.local.json)                   | `"shared"`   |

See [`docs/reference/file-formats.md`](../reference/file-formats.md#where-ignore-patterns-are-written-per-tool)
for the rationale behind the Claude Code default and when to switch to
`"local"`.

## Local Configuration

Rulesync supports a local configuration file (`rulesync.local.jsonc`) for machine-specific or developer-specific settings. This file is automatically added to `.gitignore` by `rulesync gitignore` and should not be committed to the repository.

**Configuration Priority** (highest to lowest):

1. CLI options
2. `rulesync.local.jsonc`
3. `rulesync.jsonc`
4. Default values

Example usage:

```jsonc
// rulesync.local.jsonc (not committed to git)
{
  "$schema": "https://github.com/dyoshikawa/rulesync/releases/latest/download/config-schema.json",
  // Override targets for local development
  "targets": ["claudecode"],
  // Enable verbose output for debugging
  "verbose": true,
}
```

## Target Order and File Conflicts

When multiple targets write to the same output file, **the last target in the array wins**. This is the "last-wins" behavior.

For example, both `agentsmd` and `opencode` generate `AGENTS.md`:

```jsonc
{
  // opencode wins because it comes last
  "targets": ["agentsmd", "opencode"],
  "features": ["rules"],
}
```

In this case:

1. `agentsmd` generates `AGENTS.md` first
2. `opencode` generates `AGENTS.md` second, overwriting the previous file

If you want `agentsmd`'s output instead, reverse the order:

```jsonc
{
  // agentsmd wins because it comes last
  "targets": ["opencode", "agentsmd"],
  "features": ["rules"],
}
```
