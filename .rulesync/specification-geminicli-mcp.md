---
root: false
targets: ["*"]
description: "Gemini CLI MCP (Model Context Protocol) configuration specification"
globs: []
---

# Gemini CLI MCP (Model Context Protocol) Configuration Specification

## Overview
Gemini CLI supports Model Context Protocol (MCP) servers to extend its capabilities with external tools and services. MCP allows integration with various language servers, APIs, and development tools to enhance AI-assisted coding workflows.

## Configuration Location

### Settings File Hierarchy
MCP server configurations are defined in settings.json files with the following priority order:
1. **System-wide**: `/etc/gemini-cli/settings.json` (Linux) or OS-specific equivalent
2. **User-wide**: `~/.gemini/settings.json`
3. **Project-specific**: `<project-root>/.gemini/settings.json`

Project settings override user settings; system settings override both.

## JSON Configuration Format

### Basic Structure
```json
{
  "mcpServers": {
    "serverAlias": {
      // Transport configuration (choose exactly one)
      "command": "path/to/executable",      // stdio transport
      "url": "http://localhost:8080/sse",   // SSE transport
      "httpUrl": "http://localhost:3000/mcp", // HTTP streaming transport

      // Optional configuration
      "args": ["--arg1", "value1"],
      "cwd": "./working-dir",
      "env": { "API_KEY": "$MY_API_TOKEN" },
      "headers": { "X-Custom": "Value" },
      "timeout": 30000,
      "trust": false,
      "includeTools": ["safe_toolA", "safe_toolB"],
      "excludeTools": ["dangerous_tool"]
    }
  }
}
```

### Configuration Fields

#### Transport Selection (Required - Choose One)
- **command**: Executable path for stdio transport
- **url**: Server URL for Server-Sent Events transport
- **httpUrl**: Server URL for streaming HTTP transport

#### Optional Fields
- **args**: Command-line arguments array (stdio only)
- **cwd**: Working directory for server execution (stdio only)
- **env**: Environment variables object (supports `$VAR` and `${VAR}` expansion)
- **headers**: HTTP headers object (HTTP/SSE only)
- **timeout**: Per-request timeout in milliseconds (default: 600,000ms / 10 minutes)
- **trust**: Skip user confirmation for tool calls (default: false)
- **includeTools**: Whitelist specific tool names from this server
- **excludeTools**: Blacklist specific tool names from this server

## Transport Types

### 1. STDIO Transport
Local process communication via stdin/stdout:

```json
{
  "mcpServers": {
    "pythonTools": {
      "command": "python",
      "args": ["-m", "my_mcp_server", "--port", "8080"],
      "cwd": "./mcp-servers/python",
      "env": { "DATABASE_URL": "$DB_CONN" },
      "timeout": 15000
    }
  }
}
```

### 2. Server-Sent Events (SSE) Transport
HTTP-based communication using SSE:

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

### 3. HTTP Streaming Transport
Direct HTTP communication:

```json
{
  "mcpServers": {
    "httpServer": {
      "httpUrl": "http://localhost:3000/mcp",
      "timeout": 5000
    }
  }
}
```

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

### Docker-Wrapped Server
```json
{
  "mcpServers": {
    "dockerized": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "API_KEY",
        "-v", "${PWD}:/workspace",
        "my-mcp-server:latest"
      ],
      "env": { "API_KEY": "$EXT_SERVICE_TOKEN" }
    }
  }
}
```

### GitHub Integration Server
```json
{
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {},
      "targets": ["*"]
    }
  }
}
```

### Database Server with Tool Filtering
```json
{
  "mcpServers": {
    "postgres": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "PGHOST=localhost",
        "-e", "PGUSER=developer",
        "-e", "PGPASSWORD=secret",
        "-e", "PG_DATABASE=app",
        "ghcr.io/modelcontextprotocol/postgres-mcp:latest"
      ],
      "includeTools": ["query_database", "list_tables"],
      "excludeTools": ["drop_table", "delete_database"]
    }
  }
}
```

## Server Discovery and Execution Flow

### Startup Process
1. **Configuration Loading**: Gemini CLI reads all `mcpServers` entries from settings files
2. **Transport Selection**: Automatically determined by configuration keys:
   - `command` → stdio transport
   - `url` → SSE transport
   - `httpUrl` → HTTP transport
3. **Server Connection**: For each server:
   - Establish connection (status: CONNECTING → CONNECTED/DISCONNECTED)
   - List available tools via MCP protocol
   - Sanitize JSON schemas and register tools
   - Resolve naming conflicts (first server keeps bare name, later ones get `serverAlias__toolName`)

### Tool Execution
When a tool is called, `DiscoveredMCPTool` handles:
- Request wrapping and timeout application
- User confirmation logic (unless `trust: true`)
- Error handling and response processing

## Security and Governance

### Trust and Confirmation
- **Default Behavior**: `trust: false` requires user confirmation for each tool call
- **Auto-Trust**: `trust: true` allows automatic tool execution (use carefully)
- **Tool Filtering**: Use `includeTools`/`excludeTools` for granular control

### Environment Variable Security
- Store sensitive data (API keys, tokens) in environment variables
- Use `$VAR` or `${VAR}` syntax for variable expansion
- Never hardcode secrets directly in configuration files

### Access Control
Additional server-level controls can be configured:
```json
{
  "allowMCPServers": ["approved_server1", "approved_server2"],
  "excludeMCPServers": ["blocked_server"]
}
```

## Network and Connection Management

### Timeout Configuration
- **Default**: 600,000ms (10 minutes)
- **Recommendation**: Set appropriate timeouts for server responsiveness
- **Long-running operations**: Increase timeout for servers with heavy processing

### Error Handling
- Connection failures are logged and reported
- Servers can be restarted manually if needed
- Failed servers don't block other MCP server operations

## Advanced Configuration

### Multi-Environment Setup
```json
{
  "mcpServers": {
    "dev-database": {
      "command": "python",
      "args": ["-m", "db_server"],
      "env": {
        "ENVIRONMENT": "development",
        "DB_HOST": "dev-db.example.com"
      }
    },
    "prod-database": {
      "command": "python",
      "args": ["-m", "db_server"],
      "env": {
        "ENVIRONMENT": "production",
        "DB_HOST": "prod-db.example.com"
      }
    }
  }
}
```

### Custom Headers for Authentication
```json
{
  "mcpServers": {
    "authenticated-api": {
      "url": "https://api.example.com/mcp/sse",
      "headers": {
        "Authorization": "Bearer $API_TOKEN",
        "X-Client-ID": "gemini-cli"
      }
    }
  }
}
```

## Tool Discovery and Usage

### Listing Available Tools
```bash
# List all available tools
gemini /tools

# Show tool descriptions
gemini /tools desc

# Hide tool descriptions
gemini /tools nodesc
```

### Tool Naming Conventions
- **Single server**: Tools use their original names
- **Multiple servers**: Later servers get prefixed names (`serverAlias__toolName`)
- **Name conflicts**: First server to register keeps the simple name

### Tool Invocation
Tools are automatically discovered and can be called by:
- Natural language requests that trigger appropriate tools
- Direct tool invocation in prompts
- Programmatic calls within server implementations

## Troubleshooting

### Common Issues

#### 1. Server Connection Failures
**Symptoms**: Server shows as DISCONNECTED
**Solutions**:
- Verify command path and arguments
- Check network connectivity for remote servers
- Increase timeout values
- Review server logs for errors

#### 2. Tool Discovery Issues
**Symptoms**: Expected tools not appearing in `/tools` list
**Solutions**:
- Confirm server started successfully
- Check `includeTools`/`excludeTools` configuration
- Verify MCP protocol compliance

#### 3. Permission and Trust Issues
**Symptoms**: Tools require unexpected confirmations
**Solutions**:
- Review `trust` settings
- Check `includeTools`/`excludeTools` filters
- Verify user has necessary permissions

### Debug Configuration
Enable verbose logging:
```json
{
  "mcpServers": {
    "debug-server": {
      "command": "python",
      "args": ["-m", "server"],
      "env": { "DEBUG": "true" }
    }
  }
}
```

### Health Checks
Monitor server status and performance:
- Connection status via `/tools` command
- Response times for tool calls
- Error rates and failure patterns

## Best Practices

### Configuration Management
1. **Version Control**: Store project-specific configurations in VCS
2. **Documentation**: Document server purposes and requirements
3. **Testing**: Validate configurations in development environments
4. **Monitoring**: Regular health checks for production servers

### Security Best Practices
1. **Secrets Management**: Use environment variables for sensitive data
2. **Access Control**: Implement appropriate `includeTools`/`excludeTools` filters
3. **Trust Carefully**: Only use `trust: true` for thoroughly vetted servers
4. **Audit Logging**: Monitor tool usage for security compliance

### Performance Optimization
1. **Timeout Tuning**: Set appropriate timeouts for different server types
2. **Connection Pooling**: Use servers that support connection reuse
3. **Tool Filtering**: Limit exposed tools to reduce discovery overhead
4. **Resource Monitoring**: Track memory and CPU usage of long-running servers

## Integration with Development Workflow

### Team Collaboration
- Share project-level MCP configurations through version control
- Document team-specific server requirements and setup procedures
- Establish guidelines for server trust and security settings

### CI/CD Integration
- Validate MCP configurations in CI pipelines
- Test server connectivity and tool availability
- Deploy server configurations consistently across environments

### Multi-Project Support
- Use global settings for commonly used servers
- Override with project-specific configurations as needed
- Organize servers by functionality and access patterns

This specification provides comprehensive guidance for configuring MCP servers in Gemini CLI, enabling powerful integrations that extend AI-assisted development capabilities.