## Configuration

You can configure Rulesync by creating a `rulesync.jsonc` file in the root of your project.

### JSON Schema Support

Rulesync provides a JSON Schema for editor validation and autocompletion. Add the `$schema` property to your `rulesync.jsonc`:

```jsonc
// rulesync.jsonc
{
  "$schema": "https://raw.githubusercontent.com/dyoshikawa/rulesync/refs/heads/main/config-schema.json",
  "targets": ["claudecode"],
  "features": ["rules"],
}
```

### Configuration Options

Example:

```jsonc
// rulesync.jsonc
{
  "$schema": "https://raw.githubusercontent.com/dyoshikawa/rulesync/refs/heads/main/config-schema.json",

  // List of tools to generate configurations for. You can specify "*" to generate all tools.
  "targets": ["cursor", "claudecode", "geminicli", "opencode", "codexcli"],

  // Features to generate. You can specify "*" to generate all features.
  "features": ["rules", "ignore", "mcp", "commands", "subagents", "hooks"],

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
  "modularMcp": false, // Enable modular-mcp for context compression (experimental, Claude Code only)
}
```

### Local Configuration

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

### Target Order and File Conflicts

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
