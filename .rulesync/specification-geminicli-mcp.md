---
root: false
targets: ["*"]
description: "Gemini CLI MCP (Model Context Protocol) configuration specification"
globs: []
---

# Gemini CLI MCP (Model Context Protocol) Configuration Specification

## File Placement

### Global Configuration
- **macOS/Linux**: `~/.gemini/settings.json`
- **Windows**: `%USERPROFILE%\.gemini\settings.json`

### Project Configuration (optional overrides)
- **Location**: `.gemini/settings.json` in repository root
- **Precedence**: Project settings → Global settings → Built-ins

## File Format
JSON format with top-level `mcpServers` object:

```json
{
  "mcpServers": {
    "serverName": {
      // Transport options (choose one)
      "command": "path/or/binary",        // STDIO transport
      "url": "https://host/sse",          // SSE transport  
      "httpUrl": "https://host/stream"    // HTTP chunked stream
      
      // Optional fields
      "args": ["--arg1", "value"],
      "env": { "API_KEY": "${SECRET}" },
      "cwd": "./working/directory",
      "timeout": 30000,
      "trust": false
    }
  }
}
```

## Transport Options
1. **STDIO**: Local executable communicating via stdin/stdout
2. **SSE**: Server-Sent Events endpoint
3. **HTTP**: HTTP chunked streaming endpoint

## Configuration Fields

### Required (choose exactly one)
- **command**: Path to executable for STDIO transport
- **url**: Full URL for SSE endpoint
- **httpUrl**: Full URL for HTTP streaming endpoint

### Optional
- **args**: Array of command-line arguments (used with `command`)
- **env**: Environment variables object with `${VAR}` or `$VAR` expansion
- **cwd**: Working directory for the process
- **timeout**: Request timeout in milliseconds (default: 30000)
- **trust**: Boolean to skip confirmation dialogs (use carefully)

## Configuration Examples

### Python MCP Server (STDIO)
```json
{
  "mcpServers": {
    "pythonTools": {
      "command": "python",
      "args": ["-m", "my_mcp_server", "--port", "8080"],
      "cwd": "./mcp-servers/python",
      "env": {
        "DATABASE_URL": "$DB_CONNECTION_STRING",
        "API_KEY": "${EXTERNAL_API_KEY}"
      },
      "timeout": 15000
    }
  }
}
```

### Remote SSE Server
```json
{
  "mcpServers": {
    "deepview": {
      "url": "https://deepview.example.com/mcp",
      "env": {
        "GEMINI_API_KEY": "$GEMINI_API_KEY"
      }
    }
  }
}
```

### Trusted Node.js Server
```json
{
  "mcpServers": {
    "nodeServer": {
      "command": "node",
      "args": ["dist/server.js", "--verbose"],
      "cwd": "./mcp-servers/node",
      "trust": true
    }
  }
}
```

### Compiled Binary Server
```json
{
  "mcpServers": {
    "secops-mcp": {
      "command": "/usr/local/bin/secops-mcp",
      "args": ["--profile", "prod"],
      "timeout": 60000
    }
  }
}
```

## Environment Variable Expansion
- **Syntax**: `${VAR_NAME}` or `$VAR_NAME`
- **Purpose**: Reference shell environment variables safely
- **Use case**: Keep secrets out of JSON files

## Management
- **Verification**: Use `/mcp` command in Gemini CLI to list loaded servers and tools
- **Merging**: Project settings override global settings for same-named servers
- **Reloading**: Changes require Gemini CLI restart

## Best Practices
- Keep secrets in environment variables, not in JSON
- Use project configuration for team-shared servers
- Use descriptive server names (becomes tool prefix)
- Only set `trust: true` for audited, controlled servers
- Test locally before deploying remote servers
- Version control project `.gemini/settings.json` for team consistency

## Security Considerations
- **trust: false** (default): Gemini asks confirmation before running tools
- **trust: true**: Tools run automatically without prompts (use carefully)
- Environment variable expansion prevents secret exposure in configuration files