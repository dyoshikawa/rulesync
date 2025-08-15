---
root: false
targets: ["*"]
description: "Roo Code MCP (Model Context Protocol) configuration specification"
globs: []
---

# Roo Code MCP (Model Context Protocol) Configuration Specification

## Overview
Roo Code supports Model Context Protocol (MCP) integration, enabling the AI assistant to communicate with external tools and services through a standardized JSON-RPC 2.0 protocol. MCP allows Roo Code to extend its capabilities with filesystem access, database connections, web APIs, and custom development tools.

## Architecture and Integration Flow

### Client/Server Communication
- **Roo Code Role**: MCP client that manages server connections and tool invocations
- **Server Management**: Automatically spawns local processes or connects to remote endpoints
- **Protocol**: JSON-RPC 2.0 messages serialized through transport adapters
- **Tool Discovery**: Enumerates available tools via ListTools request after handshake
- **User Approval**: Prompts for confirmation unless tools are on always-allow list

### Transport Types
1. **STDIO Transport**: Local executable communicating via stdin/stdout
2. **Streamable-HTTP**: Remote server using HTTP streaming (recommended for remote)
3. **SSE (Server-Sent Events)**: Legacy support for older remote servers

## Configuration File Locations

### File Placement and Precedence

| Level | File | Location | Editor | Precedence |
|-------|------|----------|--------|------------|
| **Global (User)** | `mcp_settings.json` | Roo Code global storage folder | Edit via "Edit Global MCP" button in MCP panel | Lower |
| **Project** | `.roo/mcp.json` | `<workspace-root>/.roo/mcp.json` | Manual editing, committed to VCS | Higher |

### Precedence Rules
- If the same server name appears in both files, **project configuration wins**
- Project settings are ideal for team-shared server configurations
- Global settings for personal development tools and user-specific servers

### Platform-Specific Global Paths
- **macOS**: `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`
- **Windows**: `%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\mcp_settings.json`
- **Linux**: `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`

## JSON Configuration Format

### Schema and Structure
```jsonc
{
  "mcpServers": {
    "<server-name>": {
      // ───────── COMMON FIELDS ─────────
      "command": "python",               // required for local STDIO
      "args": ["server.py", "--flag"],   // optional
      "cwd": "/abs/path",                // optional
      "env": { "API_KEY": "xxx" },       // optional
      "alwaysAllow": ["tool_a"],         // optional
      "disabled": false,                 // optional

      // ───────── REMOTE-ONLY FIELDS ─────────
      "type": "streamable-http" | "sse", // required for remote
      "url": "https://host/mcp",         // required for remote
      "headers": { "X-API-Key": "…" }    // optional
    }
  }
}
```

### Official JSON Schema
- **Schema ID**: `https://modelcontextprotocol.io/schemas/2025-08/mcp_client_config.schema.json`
- **Validation**: Roo Code validates configuration against schema on save
- **Error Reporting**: Schema violations appear in VS Code Problems panel

## Configuration Fields Reference

### Required Fields (Transport-Specific)

#### STDIO Transport (Local Servers)
- **command**: Path to executable or command name (e.g., `"python"`, `"node"`, `"/usr/bin/my-server"`)

#### Remote Transport (Streamable-HTTP/SSE)
- **type**: Transport protocol (`"streamable-http"` or `"sse"`)
- **url**: Full endpoint URL (must be accessible from client)

### Optional Fields

#### Common Fields
- **args**: Array of command-line arguments for STDIO servers
- **cwd**: Working directory for server process execution
- **env**: Environment variables object with `${env:VAR}` expansion support
- **alwaysAllow**: Array of tool names to run without user confirmation
- **disabled**: Boolean to temporarily disable server without removing configuration

#### Remote-Only Fields
- **headers**: HTTP headers object for authentication and custom headers

### Environment Variable Expansion
- **Syntax**: `${env:VAR_NAME}` format for environment variable substitution
- **Use Case**: Reference shell environment variables for API keys and secrets
- **Security**: Keeps sensitive data out of configuration files

## Configuration Examples

### Local STDIO Servers

#### Basic Python Server
```json
{
  "mcpServers": {
    "local-tools": {
      "command": "python",
      "args": ["-m", "my_mcp_server", "--port", "8080"],
      "cwd": "${workspaceFolder}/servers/local-tools",
      "alwaysAllow": ["find_in_files"]
    }
  }
}
```

#### Node.js Server with Environment Variables
```json
{
  "mcpServers": {
    "node-server": {
      "command": "node",
      "args": ["index.js"],
      "cwd": "${workspaceFolder}/mcp-servers/node",
      "env": {
        "DATABASE_URL": "${env:DATABASE_URL}",
        "API_KEY": "${env:EXTERNAL_API_KEY}",
        "NODE_ENV": "development"
      }
    }
  }
}
```

#### NPX Package Server
```json
{
  "mcpServers": {
    "github-tools": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${env:GITHUB_TOKEN}"
      },
      "alwaysAllow": ["create_repository", "list_issues"]
    }
  }
}
```

#### Binary Executable Server
```json
{
  "mcpServers": {
    "rust-tools": {
      "command": "/usr/local/bin/rust-mcp-server",
      "args": ["--config", "production.toml"],
      "env": {
        "RUST_LOG": "info"
      },
      "alwaysAllow": ["compile_check", "format_code"]
    }
  }
}
```

### Remote Servers

#### Streamable-HTTP Server (Recommended)
```json
{
  "mcpServers": {
    "analytics-remote": {
      "type": "streamable-http",
      "url": "https://analytics.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${env:ANALYTICS_TOKEN}",
        "X-Client-Version": "1.0.0"
      },
      "alwaysAllow": ["run_sql_query", "get_dashboard_data"]
    }
  }
}
```

#### Legacy SSE Server
```json
{
  "mcpServers": {
    "legacy-server": {
      "type": "sse",
      "url": "https://old-system.example.com/mcp-base",
      "headers": {
        "X-API-Key": "${env:LEGACY_API_KEY}"
      }
    }
  }
}
```

### Platform-Specific Configurations

#### Windows Command Wrapper
```json
{
  "mcpServers": {
    "windows-tools": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "my-mcp-server"],
      "env": {
        "NODE_ENV": "development"
      }
    }
  }
}
```

#### Runtime Manager Integration (mise/asdf)
```json
{
  "mcpServers": {
    "python-tools": {
      "command": "mise",
      "args": ["exec", "python@3.11", "--", "python", "-m", "my_server"],
      "cwd": "${workspaceFolder}",
      "env": {
        "PYTHONPATH": "${workspaceFolder}/src"
      }
    }
  }
}
```

### Advanced Configurations

#### Multi-Environment Server Setup
```json
{
  "mcpServers": {
    "database-dev": {
      "command": "python",
      "args": ["-m", "db_mcp_server"],
      "env": {
        "ENVIRONMENT": "development",
        "DB_HOST": "dev-db.example.com",
        "DB_NAME": "app_dev"
      }
    },
    "database-staging": {
      "command": "python",
      "args": ["-m", "db_mcp_server"],
      "env": {
        "ENVIRONMENT": "staging",
        "DB_HOST": "staging-db.example.com",
        "DB_NAME": "app_staging"
      },
      "disabled": true
    }
  }
}
```

#### Docker-Based Server
```json
{
  "mcpServers": {
    "docker-server": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "${workspaceFolder}:/workspace",
        "-e", "WORKSPACE=/workspace",
        "-e", "API_KEY=${env:DOCKER_SERVER_API_KEY}",
        "custom/mcp-server:latest"
      ]
    }
  }
}
```

#### Database Integration Example
```json
{
  "mcpServers": {
    "postgres": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "PGHOST=localhost",
        "-e", "PGUSER=${env:DB_USER}",
        "-e", "PGPASSWORD=${env:DB_PASSWORD}",
        "-e", "PG_DATABASE=${env:DB_NAME}",
        "ghcr.io/modelcontextprotocol/postgres-mcp:latest"
      ],
      "alwaysAllow": ["query", "list_tables"]
    }
  }
}
```

## Tool Schema and Definition

### Server-Side Tool Definition
```typescript
// Example tool definition in MCP server (TypeScript SDK)
tool({
  name: "calculate_sum",
  description: "Add two numbers together",
  inputSchema: {
    type: "object",
    properties: {
      a: { 
        type: "number", 
        description: "First number to add" 
      },
      b: { 
        type: "number", 
        description: "Second number to add" 
      }
    },
    required: ["a", "b"]
  },
  outputSchema: {        // Optional (MCP 2025-06+)
    type: "object",
    properties: { 
      result: { 
        type: "number",
        description: "Sum of the two numbers"
      }
    },
    required: ["result"]
  }
});
```

### Input/Output Schema Requirements
- **Input Schema**: Required JSON Schema for argument validation
- **Output Schema**: Optional schema for response validation (MCP 2025-06+)
- **Auto-wrapping**: Primitive outputs automatically wrapped under `"result"` key
- **Validation**: Roo Code validates arguments before sending to server

## Server Management and Operations

### Server Lifecycle
1. **Configuration Loading**: Roo Code reads configuration on startup
2. **Server Spawning**: Launches STDIO processes or connects to remote endpoints
3. **Handshake**: Establishes MCP connection and protocol negotiation
4. **Tool Discovery**: Enumerates available tools via ListTools request
5. **Runtime Operations**: Tool invocations with user approval flow

### Management Interface
- **MCP Panel**: Access via Roo Code sidebar for server status and management
- **Edit Buttons**: "Edit Global MCP" and "Edit Project MCP" for configuration
- **Refresh Button**: "⟳" icon to restart servers after configuration changes
- **Status Indicators**: Visual indication of server connection status
- **Error Reporting**: Server logs available in OUTPUT → "Roo Code MCP" channel

### Always-Allow Lists
```json
{
  "mcpServers": {
    "development-tools": {
      "command": "python",
      "args": ["-m", "dev_tools"],
      "alwaysAllow": [
        "lint_code",
        "format_file",
        "run_tests",
        "check_syntax"
      ]
    }
  }
}
```

Benefits of always-allow lists:
- Streamlined development workflow for trusted tools
- Reduced interruption for frequently-used safe operations
- Granular control over automation vs. manual approval

## Security Considerations

### Environment Variable Security
- Store sensitive data (API keys, tokens) in environment variables
- Never hardcode secrets in configuration files
- Use shell environment or VS Code environment for secret management
- Consider using secret management tools for team environments

### Command Execution Safety
- Validate command paths and arguments before deployment
- Use absolute paths when possible to avoid PATH manipulation
- Restrict working directory access appropriately
- Review server code for security before deployment

### Network Security
- Use HTTPS for all remote server connections
- Validate SSL certificates for secure connections
- Configure appropriate firewall rules for network access
- Implement authentication for multi-user server environments

### Access Control
- Use always-allow lists judiciously for trusted tools only
- Regularly review and audit tool permissions
- Implement server-side access controls and rate limiting
- Monitor tool usage patterns for security anomalies

## Troubleshooting

### Common Issues

#### 1. Server Connection Failures
**Symptoms**: Server not appearing in MCP panel or connection errors
**Solutions**:
- Verify JSON syntax in configuration files
- Check command paths and executable permissions
- Ensure environment variables are properly set
- Review OUTPUT → "Roo Code MCP" logs for detailed errors

#### 2. Tool Discovery Problems
**Symptoms**: Server connects but no tools available
**Solutions**:
- Verify server implements ListTools RPC method correctly
- Check server logs for tool registration errors
- Ensure server tool definitions include required schemas
- Test server independently with MCP inspector tools

#### 3. Environment Variable Issues
**Symptoms**: Authentication failures or missing configuration
**Solutions**:
- Verify environment variables are set in shell/VS Code
- Check variable name spelling and case sensitivity (`${env:EXACT_NAME}`)
- Test variable expansion with simple echo commands
- Use absolute paths instead of relative variables when possible

#### 4. Performance Problems
**Symptoms**: Slow tool responses or timeouts
**Solutions**:
- Monitor server resource usage and optimize accordingly
- Implement server-side caching for expensive operations
- Use connection pooling for database-backed servers
- Consider async/streaming responses for long operations

### Debug and Monitoring

#### Logging Configuration
```json
{
  "mcpServers": {
    "debug-server": {
      "command": "python",
      "args": ["-m", "my_server", "--log-level", "debug"],
      "env": {
        "DEBUG": "true",
        "LOG_FILE": "/tmp/mcp-server.log"
      }
    }
  }
}
```

#### Health Check Implementation
```typescript
// Server-side health check tool
tool({
  name: "health_check",
  description: "Check server health and status",
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      status: { type: "string" },
      uptime: { type: "number" },
      memory_usage: { type: "number" }
    }
  }
});
```

## Quick Start Checklist

1. **Configuration**: Add server entry to `mcp_settings.json` (global) or `.roo/mcp.json` (project)
2. **Restart/Refresh**: Click "⟳" icon in MCP panel or restart Roo Code
3. **Verify Connection**: Check MCP panel for server status and available tools
4. **Test Tool**: Run simple prompt using tool name: "Use `server-name.tool-name` to..."
5. **Approve Tool**: Confirm tool execution when prompted (unless in alwaysAllow)
6. **Monitor Logs**: Watch OUTPUT → "Roo Code MCP" for connection and error messages

## Best Practices

### Configuration Management
1. **Version Control**: Commit project `.roo/mcp.json` for team consistency
2. **Documentation**: Document server purposes and required environment variables
3. **Testing**: Validate configurations in development environments first
4. **Secrets**: Use environment variables for all sensitive data

### Server Development
1. **Error Handling**: Implement robust error handling and logging
2. **Resource Management**: Proper cleanup of connections and resources
3. **API Design**: Clear, consistent tool interfaces with good documentation
4. **Performance**: Optimize for response time and resource usage

### Team Collaboration
1. **Shared Standards**: Establish team conventions for server configurations
2. **Environment Setup**: Document required environment variables and setup
3. **Server Registry**: Maintain team registry of available MCP servers
4. **Access Control**: Implement appropriate authentication and authorization

This comprehensive specification provides all necessary information for configuring, deploying, and managing MCP servers with Roo Code, enabling powerful AI-assisted development workflows through external tool integration.