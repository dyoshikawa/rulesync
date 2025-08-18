---
root: false
targets: ["*"]
description: Claude Code MCP (Model Context Protocol) configuration specification
globs: []
---

# Claude Code MCP (Model Context Protocol) Configuration Specification

## Overview
MCP servers expose tools to Claude Code following the naming convention: `mcp__<serverName>__<toolName>`

Security requires explicit tool allowlisting with `--allowedTools` or blocking with `--disallowedTools`.

## Adding Servers with CLI

### STDIO (Local Process)
```bash
claude mcp add my-stdio-srv /path/to/server [arg1 arg2]
```

### SSE (Server-Sent Events)
```bash
claude mcp add --transport sse my-sse-srv https://example.com/mcp --header 'X-API-Key:123'
```

### HTTP Endpoint
```bash
claude mcp add --transport http my-http-srv https://example.com/mcp
```

### Add from JSON
```bash
claude mcp add-json weather '{"type":"stdio","command":"weather","args":["--units","metric"]}'
```

## Management Commands
- `claude mcp list` - Show all configured servers
- `claude mcp get <name>` - Show specific server configuration
- `claude mcp remove <name>` - Remove server configuration

## Configuration Scope

### Local Scope (default)
- **File**: `.claude/settings.local.json` (per-user, per-project)
- **Visibility**: Only current user in current repository
- **Command**: `claude mcp add --scope local` (default)

### Project Scope
- **File**: `.mcp.json` (repository root)
- **Visibility**: Shared with team via version control
- **Command**: `claude mcp add --scope project`
- **Security**: Prompts teammates on first use

### User Scope
- **File**: `~/.claude/settings.json` (global user settings)
- **Visibility**: Available to all projects for current user
- **Command**: `claude mcp add --scope user`

### Custom Configuration
- **Runtime**: `--mcp-config <file.json>` option
- **Purpose**: Use custom configuration file without modifying defaults

## Precedence Order
1. Local scope (`.claude/settings.local.json`)
2. Project scope (`.mcp.json`)
3. User scope (`~/.claude/settings.json`)

## JSON Schema

### Project-Scoped (.mcp.json)
```json
{
  "mcpServers": {
    "shared-server": {
      "command": "/path/to/server",
      "args": [],
      "env": {}
    }
  }
}
```

### Complete Configuration Example
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/src"
      ]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    },
    "price-feed": {
      "transport": "sse",
      "url": "https://prices.example.com/mcp",
      "headers": { "X-API-Key": "abc" }
    }
  }
}
```

## Configuration Fields

### Common Fields
- **command**: Executable path for STDIO transport (required for STDIO)
- **args**: Command line arguments array (optional)
- **env**: Environment variables object (optional)
- **transport**: Transport type - "stdio" (default), "sse", or "http"

### Remote Server Fields (SSE/HTTP)
- **url**: Server endpoint URL (required for remote)
- **headers**: HTTP headers object (optional)

## Transport Types
1. **STDIO**: Local process communication via stdin/stdout
2. **SSE**: Server-Sent Events over HTTP/HTTPS
3. **HTTP**: Plain HTTP endpoint

## Usage in Sessions

### With Tool Allowlisting
```bash
claude -p "List project files" \
      --mcp-config mcp-servers.json \
      --allowedTools "mcp__filesystem__list_directory"
```

### With Permission Prompt Tool
```bash
claude --permission-prompt-tool mcp__<srv>__<tool>
```

## File Locations

### Local Settings
- `.claude/settings.local.json` (in repository root)

### Project Settings  
- `.mcp.json` (in repository root, version controlled)

### User Settings
- `~/.claude/settings.json` (global user configuration)

## Security Considerations
- All MCP tools require explicit allowlisting for security
- Project-scoped servers prompt teammates before first use
- Environment variables can contain sensitive data (API keys, tokens)
- Use appropriate scope for sensitivity level

## Best Practices
- Use project scope for team-shared servers
- Commit `.mcp.json` for project scope configurations
- Use user scope for personal development tools
- Use local scope for experimental or temporary servers
- Always specify `--allowedTools` in non-interactive mode
- Audit configurations with `claude mcp list`
- Use environment variables for sensitive data