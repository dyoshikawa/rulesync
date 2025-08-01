---
root: false
targets: ["*"]
description: RooCode MCP (Model Context Protocol) configuration specification
globs: []
---

# RooCode MCP (Model Context Protocol) Configuration Specification

## File Placement

### Global Configuration (user-wide)
- **File**: `mcp_settings.json`
- **Access**: Roo Code → MCP pane → "Edit Global MCP"
- **Paths**:
  - **macOS**: `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`
  - **Windows**: `%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\mcp_settings.json`
  - **Linux**: `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`

### Project Configuration (per-repo)
- **File**: `.roo/mcp.json` (at repository root)
- **Access**: Roo Code → MCP pane → "Edit Project MCP"
- **Version control**: Should be committed for team consistency
- **Precedence**: Overrides global settings for same-named servers

## File Format

### STDIO (Local Child Process)
```json
{
  "mcpServers": {
    "server-name": {
      "command": "python",
      "args": ["server.py", "--foo"],
      "cwd": "/path/where/it/runs",
      "env": { "API_KEY": "..." },
      "alwaysAllow": ["tool1", "tool2"],
      "disabled": false
    }
  }
}
```

### Streamable HTTP (Modern Remote)
```json
{
  "mcpServers": {
    "server-name": {
      "type": "streamable-http",
      "url": "https://host.tld/mcp",
      "headers": { "Authorization": "Bearer ..." },
      "alwaysAllow": ["toolA"],
      "disabled": false
    }
  }
}
```

### SSE (Legacy Remote)
```json
{
  "mcpServers": {
    "server-name": {
      "type": "sse",
      "url": "https://old-host.tld/mcp-base",
      "headers": { "X-API-Key": "..." },
      "alwaysAllow": ["oldTool"],
      "disabled": false
    }
  }
}
```

## Configuration Fields

### Common Fields
- **alwaysAllow**: Array of tool names to auto-approve (skip permission prompt)
- **disabled**: Boolean to disable server without removing configuration
- **timeout**: Integer seconds (default 60) for server timeout
- **networkTimeout**: Alternative timeout field supported by community servers

### STDIO Fields
- **command**: Required executable path
- **args**: Optional command line arguments array
- **cwd**: Optional working directory
- **env**: Optional environment variables (adds/overrides)

### Remote Fields (HTTP/SSE)
- **type**: Required transport type ("streamable-http" or "sse")
- **url**: Required endpoint URL
- **headers**: Optional HTTP headers for authentication

## Environment Variable Substitution
- Use `${env:VAR_NAME}` in args to safely splice host environment variables
- Example: `"headers": { "X-API-Key": "${env:WX_KEY}" }`

## Management

### File Editing
- **Global**: MCP sidebar → "Edit Global MCP"
- **Project**: MCP sidebar → "Edit Project MCP"
- **Auto-reload**: Changes take effect immediately after save

### Runtime Controls
- **Global toggle**: "Enable MCP Servers" for all MCP functionality
- **Per-server controls**: Enable/disable toggle, restart button, delete icon
- **Network timeout**: Dropdown to adjust timeout (30s - 5min)

## Protocol Specification
- **Message layer**: JSON-RPC 2.0 (request, response, notification)
- **Server capabilities**:
  - **tools**: Callable functions with JSON schema parameters
  - **resources**: Contextual data blobs
  - **prompts**: Predefined templates/workflows
- **Security**: User consent required for new tools (unless in alwaysAllow)

## Example Configuration
```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "alwaysAllow": ["remember", "recall"]
    },
    "weather-remote": {
      "type": "streamable-http",
      "url": "https://myorg.cloud/mcp",
      "headers": { "X-API-Key": "${env:WX_KEY}" }
    }
  }
}
```

## Best Practices
- Use project `.roo/mcp.json` for team-shared servers
- Commit project configuration to version control
- Use environment variables for sensitive data
- Name servers descriptively (becomes tool prefix)
- Test locally before deploying remote servers