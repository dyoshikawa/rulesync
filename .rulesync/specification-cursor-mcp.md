---
root: false
targets: ["*"]
description: Cursor MCP (Model Context Protocol) configuration specification
globs: ["**/*.json", "**/*.ts", "**/*.js"]
---

# Cursor MCP (Model Context Protocol) Configuration Specification

## File Placement
- **Project-local**: `.cursor/mcp.json` (in repository root)
- **Global/user**: `~/.cursor/mcp.json` (applies to all projects)
- **OS-specific paths**:
  - macOS: `~/Library/Application Support/Cursor/mcp-servers.json`
  - Windows: `%APPDATA%\Cursor\mcp-servers.json`
  - Linux: `~/.config/Cursor/mcp-servers.json`

## File Format
JSON configuration with the following structure:

```json
{
  "mcpServers": {
    "<server-name>": {
      // Transport options (choose one):
      
      // stdio (local executable)
      "command": "npx",
      "args": ["-y", "mcp-server"],
      
      // OR sse/streamable-http (remote)
      "url": "http://localhost:3030",
      "type": "sse",  // or "streamable-http"
      
      // Optional fields
      "env": { "API_KEY": "..." },
      "cwd": "/optional/working/dir"
    }
  }
}
```

## Transport Options
1. **stdio**: Local process launched by Cursor
2. **sse**: Server-Sent-Events endpoint (local or remote)
3. **streamable-http**: Remote HTTP endpoint that streams

## Protocol Messages

### Request Object (Cursor → Server)
```json
{
  "version": "1.0",
  "request_id": "uuid-v4",
  "query": "Natural-language user request",
  "context": {
    "files": [...],
    "cursor_position": {...},
    "selection": {...}
  }
}
```

### Response Object (Server → Cursor)
```json
{
  "version": "1.0",
  "request_id": "same-as-above",
  "response": {
    "type": "text | code | action",
    "content": "...",
    "language": "optional-code-lang",
    "actions": [
      {
        "type": "edit | create | delete",
        ...
      }
    ]
  }
}
```

## Configuration Fields
- **command + args**: Run a local process with stdio transport
- **url**: Endpoint for SSE or streamable-http servers
- **type**: Explicitly choose transport ("stdio", "sse", "streamable-http")
- **env**: Environment variables (safe for API keys)
- **cwd**: Optional working directory for the process

## Management
- **UI**: Settings → Features → MCP to manage servers
- **Reloading**: Changes take effect immediately, no restart needed
- **Verification**: Check "Available Tools" section in MCP settings

## Best Practices
- Use project-local `.cursor/mcp.json` for team consistency
- Keep secrets in `env` section, never commit them
- Use unique server names (becomes tool prefix)
- Test with stdio first, then move to SSE/HTTP for multi-user setups
- Add `"type": "sse"` for remote URLs to prevent local spawning attempts