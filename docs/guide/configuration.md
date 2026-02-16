# Configuration

You can configure Rulesync by creating a `rulesync.jsonc` file in the root of your project.

## JSON Schema Support

Rulesync provides a JSON Schema for editor validation and autocompletion. Add the `$schema` property to your `rulesync.jsonc`:

```jsonc
// rulesync.jsonc
{
  "$schema": "https://raw.githubusercontent.com/dyoshikawa/rulesync/refs/heads/main/config-schema.json",
  "targets": ["claudecode"],
  "features": ["rules"],
}
```

## Configuration Options

Example:

```jsonc
// rulesync.jsonc
{
  "$schema": "https://raw.githubusercontent.com/dyoshikawa/rulesync/refs/heads/main/config-schema.json",

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

  // Declarative skill sources — installed via 'rulesync install'
  // See the "Declarative Skill Sources" section for details.
  // "sources": [
  //   { "source": "owner/repo" },
  //   { "source": "org/repo", "skills": ["specific-skill"] },
  // ],
}
```

## Per-Target Features

The `features` option accepts both an array and an object format. Use the object format when you want to generate different features for different targets:

```jsonc
// rulesync.jsonc
{
  "targets": ["claudecode", "cursor", "copilot"],
  "features": {
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

You can also use `*` (wildcard) for specific targets:

```jsonc
{
  "targets": ["claudecode", "cursor"],
  "features": {
    "claudecode": ["*"], // Generate all features for Claude Code
    "cursor": ["rules"], // Only rules for Cursor
  },
}
```

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
  "$schema": "https://raw.githubusercontent.com/dyoshikawa/rulesync/refs/heads/main/config-schema.json",
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
