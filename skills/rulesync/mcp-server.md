# Rulesync MCP Server

Rulesync provides an MCP (Model Context Protocol) server that enables AI agents to manage your Rulesync files. This allows AI agents to discover, read, create, update, and delete files dynamically.

> [!NOTE]
> The MCP server exposes the only one tool to minimize your agent's token usage. Approximately less than 1k tokens for the tool definition.

## Supported Features and Operations

The single `rulesyncTool` multiplexes by `feature` and `operation`:

- `rule`, `command`, `subagent`, `skill`: `list`, `get`, `put`, `delete`
- `ignore`, `mcp`, `permissions`, `hooks`: `get`, `put`, `delete`
- `generate`: `run`
- `import`: `run`

The `permissions` feature operates on `.rulesync/permissions.json` and the `hooks` feature operates on `.rulesync/hooks.json`. Both accept a `content` string (valid JSON) on `put`.

## Usage

### Starting the MCP Server

```bash
rulesync mcp
```

This starts an MCP server using stdio transport that AI agents can communicate with.

### Configuration

Add the Rulesync MCP server to your `.rulesync/mcp.json`:

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
