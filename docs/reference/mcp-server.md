# Rulesync MCP Server

Rulesync provides an MCP (Model Context Protocol) server that enables AI agents to manage your Rulesync files. This allows AI agents to discover, read, create, update, and delete files dynamically.

> [!NOTE]
> The MCP server exposes the only one tool to minimize your agent's token usage. Approximately less than 1k tokens for the tool definition.

## Supported Features and Operations

The single `rulesyncTool` multiplexes by `feature` and `operation`:

- `rule`, `command`, `subagent`, `skill`, `check`: `list`, `get`, `put`, `delete`
- `ignore`, `mcp`, `permissions`, `hooks`: `get`, `put`, `delete`
- `generate`: `run`
- `import`: `run`
- `convert`: `run`

The `permissions` feature operates on `.rulesync/permissions.jsonc` and the `hooks` feature operates on `.rulesync/hooks.jsonc`. Both accept a `content` string (valid JSONC) on `put`.

### Warnings from `generate` / `run`, `import` / `run`, and `convert` / `run`

The server writes nothing to a console the calling agent can read, so a diagnostic raised while reading the source tool's files, or while generating — for example, that a machine-local overrides file such as `.factory/settings.local.json` was read into files rulesync commits — travels back in the result instead, as a `warnings` array of strings. The field is omitted when the operation had nothing to report, and is present on failures too, since a run that warned and then failed is exactly when the warnings matter. At most 100 warnings are returned, each truncated to 1,000 characters and 8,000 characters in total; a run that exceeds any of those limits says so in a final entry rather than growing the result without bound. These three operations are the only ones that report warnings — the `list` / `get` / `put` / `delete` operations read and write `.rulesync/` files that the caller can inspect for itself, and say nothing.

### `skill` other files

A skill directory may contain files other than `SKILL.md`. They are passed as `otherFiles`, where each entry has:

| Field      | Type                  | Required | Description                                                                    |
| ---------- | --------------------- | -------- | ------------------------------------------------------------------------------ |
| `name`     | `string`              | Yes      | Path of the file relative to the skill directory (e.g. `references/logo.png`). |
| `body`     | `string`              | Yes      | File content, encoded according to `encoding`.                                 |
| `encoding` | `"utf-8" \| "base64"` | No       | Defaults to `"utf-8"`. Use `"base64"` for binary files such as images.         |

On `get`, every returned entry carries an explicit `encoding`: `"utf-8"` when the file content survives a UTF-8 round trip unchanged, and `"base64"` otherwise. On `put`, the declared `encoding` is trusted and the decoded bytes are written verbatim, so binary files round-trip byte for byte.

When feeding entries returned by `get` back into `put`, keep their `encoding` field. Dropping it makes a `"base64"` body be stored as literal text and corrupts the file.

A `"base64"` body must be canonical base64 (the standard or the URL-safe alphabet, padding optional); otherwise `put` fails with `Invalid base64 body for other file <name>`. The 1MB skill size limit is evaluated against the decoded byte length of each other file.

### `convert` / `run` options

When invoking `feature: "convert"` with `operation: "run"`, pass `convertOptions` with the following shape:

| Option     | Type       | Required | Description                                                                        |
| ---------- | ---------- | -------- | ---------------------------------------------------------------------------------- |
| `from`     | `string`   | Yes      | Source tool name (e.g. `"claudecode"`). Must be a valid `ToolTarget`.              |
| `to`       | `string[]` | Yes      | One or more destination tool names. Must not be empty and must not include `from`. |
| `features` | `string[]` | No       | Features to convert (e.g. `["rules", "commands"]`). Defaults to `["*"]`.           |
| `global`   | `boolean`  | No       | Convert global (user-scope) configurations. Defaults to `false`.                   |
| `dryRun`   | `boolean`  | No       | Preview changes without writing files. Defaults to `false`.                        |

## Usage

### Starting the MCP Server

```bash
rulesync mcp
```

This starts an MCP server using stdio transport that AI agents can communicate with.

### Configuration

Add the Rulesync MCP server to your `.rulesync/mcp.jsonc`:

```json
{
  "$schema": "https://github.com/dyoshikawa/rulesync/releases/latest/download/mcp-schema.json",
  "mcpServers": {
    "rulesync-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "rulesync", "mcp"],
      "env": {}
    }
  }
}
```
