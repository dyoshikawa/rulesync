---
root: false
targets: ["*"]
description: "Windsurf Model Context Protocol (MCP) server configuration specification"
globs: ["**/*"]
---

# Windsurf Model Context Protocol (MCP) Configuration Specification

## Overview
Windsurf IDE integrates with the Model Context Protocol (MCP) to extend its Cascade agent capabilities through external tools and services. MCP is a JSON-RPC 2.0 application-layer protocol that standardizes how AI models discover and interact with tools, files, and data sources.

## Architecture Overview
Windsurf implements MCP with a client-server architecture:
- **MCP Client**: Windsurf's Cascade agent acts as the client
- **MCP Servers**: External processes that expose tools and capabilities

## Configuration File Location

### Primary Configuration
- **File**: `~/.codeium/windsurf/mcp_config.json`
- **Scope**: Global configuration for all Windsurf instances
- **Format**: JSON with `mcpServers` root object

### Alternative Configuration (VS Code compatibility)
- **File**: `.vscode/mcp.json` (project-specific)
- **Scope**: Project-level configuration
- **Format**: JSON with `servers` root object

## File Format Structure

### Windsurf Native Format
```json
{
  "mcpServers": {
    "server-id": {
      // Server configuration
    }
  }
}
```

### VS Code Compatible Format
```json
{
  "inputs": [
    // Optional user input prompts
  ],
  "servers": {
    "server-id": {
      // Server configuration
    }
  }
}
```

## Server Configuration Fields

### Required Fields (Choose One)

#### STDIO Transport (Local Process)
- **command** (string): Executable to run (e.g., "node", "python", "npx", "docker")
- **args** (string[]): Command-line arguments array

#### Remote Transport (HTTP/SSE)
- **serverUrl** (string): Full HTTPS URL endpoint
- **url** (string): Alternative field name for VS Code compatibility

### Optional Fields
- **env** (object): Environment variables for the server process
- **cwd** (string): Working directory for process execution
- **disabled** (boolean): Skip loading this server (default: false)
- **disabledTools** (string[]): Tools to exclude from server capabilities
- **autoApprove** (string[]): Tools that run without confirmation
- **transport** (string): Transport protocol ("stdio", "sse", "http")
- **headers** (object): HTTP headers for remote servers
- **envFile** (string): Path to environment file (VS Code format)

## Transport Types

### 1. STDIO Transport
Local process communication via stdin/stdout (most common)

**Features**:
- Spawns local executable
- Exchanges JSON-RPC over stdin/stdout
- Full process lifecycle management
- Environment variable injection

**Example**:
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx"
      }
    }
  }
}
```

### 2. SSE Transport (Legacy)
Server-Sent Events over HTTP

**Features**:
- Remote server communication
- Long-lived connection
- Real-time server-to-client events

**Example**:
```json
{
  "mcpServers": {
    "figma": {
      "serverUrl": "https://figma-mcp.yourcompany.com/sse"
    }
  }
}
```

### 3. Streamable HTTP Transport (Recommended)
Modern HTTP-based transport with streaming support

**Features**:
- Single `/mcp` endpoint
- Session management
- Connection resumability
- Better error handling

**Example**:
```json
{
  "mcpServers": {
    "weather": {
      "serverUrl": "https://weather.example.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

## Environment Variable Handling

### Direct Environment Variables
```json
{
  "mcpServers": {
    "postgres": {
      "command": "node",
      "args": ["postgres-server.js"],
      "env": {
        "PGHOST": "localhost",
        "PGPORT": "5432",
        "PGUSER": "app",
        "PGPASSWORD": "secret",
        "PGDATABASE": "mydb"
      }
    }
  }
}
```

### Environment File Reference (VS Code)
```json
{
  "servers": {
    "aws": {
      "command": "uvx",
      "args": ["awslabs.nova-canvas-mcp-server@latest"],
      "envFile": "${workspaceFolder}/.env"
    }
  }
}
```

### Variable Expansion (VS Code)
```json
{
  "inputs": [
    {
      "id": "apiKey",
      "type": "promptString",
      "description": "API Key",
      "password": true
    }
  ],
  "servers": {
    "api": {
      "serverUrl": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${input:apiKey}"
      }
    }
  }
}
```

## Authentication and Security

### API Key Management
```json
{
  "mcpServers": {
    "secure-api": {
      "serverUrl": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN",
        "X-API-Key": "YOUR_API_KEY"
      }
    }
  }
}
```

### Docker Isolation
```json
{
  "mcpServers": {
    "isolated-server": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "--security-opt", "no-new-privileges:true",
        "--user", "1000:1000",
        "your-mcp-server:latest"
      ]
    }
  }
}
```

### Tool-Level Security
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "disabledTools": ["write_file", "create_directory", "delete_file"],
      "autoApprove": ["read_file", "list_directory"]
    }
  }
}
```

## Server Lifecycle Management

### Startup Process
1. Windsurf reads configuration on startup
2. Servers are initialized lazily when first needed
3. Failed servers are logged and marked as unavailable
4. Configuration changes require Windsurf restart

### Health Monitoring
- Connection status visible in Cascade settings
- Error logs available in Help → Open Logs Folder → `mcp-client.log`
- Failed servers automatically marked as disabled

### Restart and Reload
```bash
# Refresh MCP servers without full restart
# Cascade → Settings → "Refresh MCP servers"
```

## Integration with Cascade Agent

### Tool Discovery
- Cascade automatically discovers available tools from all enabled servers
- Tools are presented in natural language interface
- Tool limitations: Maximum 100 tools per session

### Execution Flow
1. User request analyzed by Cascade
2. Relevant tools identified from MCP servers
3. Tools executed with appropriate parameters
4. Results integrated into agent response

### Context Management
- MCP servers can provide context about available capabilities
- Tool descriptions help Cascade understand when to use each tool
- Server resources (files, databases) become available to agent

## Configuration Examples

### Complete Development Setup
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "disabledTools": ["delete_file"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx"
      }
    },
    "postgres": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "PGHOST=host.docker.internal",
        "-e", "PGUSER=app",
        "-e", "PGPASSWORD=secret",
        "ghcr.io/modelcontext/postgres-mcp:latest"
      ]
    },
    "tomtom-maps": {
      "command": "npx",
      "args": ["-y", "@tomtom-org/tomtom-mcp@latest"],
      "env": {
        "TOMTOM_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

### Remote Services Setup
```json
{
  "mcpServers": {
    "company-api": {
      "serverUrl": "https://internal-tools.company.com/mcp",
      "headers": {
        "Authorization": "Bearer INTERNAL_TOKEN"
      }
    },
    "external-service": {
      "serverUrl": "https://api.external.com/sse"
    }
  }
}
```

### Multi-Environment Configuration
```json
{
  "mcpServers": {
    "dev-database": {
      "command": "node",
      "args": ["db-server.js"],
      "env": {
        "NODE_ENV": "development",
        "DB_URL": "postgresql://localhost:5432/dev"
      },
      "disabled": false
    },
    "prod-database": {
      "command": "node", 
      "args": ["db-server.js"],
      "env": {
        "NODE_ENV": "production",
        "DB_URL": "postgresql://prod.company.com:5432/app"
      },
      "disabled": true
    }
  }
}
```

## Error Handling and Troubleshooting

### Common Error Patterns

#### JSON Syntax Errors
**Symptom**: All MCP servers fail to load
**Solution**: Validate JSON syntax with `jq . ~/.codeium/windsurf/mcp_config.json`

#### Command Not Found
**Symptom**: Server fails to start with "command not found"
**Solution**: Use absolute paths or ensure commands are in PATH

#### Connection Refused
**Symptom**: "Cannot call write after a stream was destroyed"
**Solution**: Check server endpoint and network connectivity

#### Authentication Failures
**Symptom**: 401/403 errors in logs
**Solution**: Verify API keys and authentication headers

### Diagnostic Steps

#### 1. Configuration Validation
```bash
# Validate JSON syntax
jq . ~/.codeium/windsurf/mcp_config.json

# Check for common issues
grep -E '"@|serverUrl.*command|disabled.*true' ~/.codeium/windsurf/mcp_config.json
```

#### 2. Server Testing
```bash
# Test STDIO server manually
npx -y @modelcontextprotocol/server-github --version

# Test HTTP/SSE server
curl -v -X POST http://localhost:8000/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"mcp/initialize","id":1}'
```

#### 3. Log Analysis
- **Location**: Help → Open Logs Folder → `mcp-client.log`
- **Look for**: Connection errors, authentication failures, JSON-RPC errors
- **Common patterns**: "couldn't create connection", "stream was destroyed"

#### 4. Progressive Isolation
1. Start with empty configuration: `{ "mcpServers": {} }`
2. Add servers one by one until failure
3. Identify problematic server configuration
4. Fix specific issues and test again

### Error Response Handling

#### STDIO Transport Errors
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Invalid API key"
  },
  "id": 42
}
```

#### HTTP Transport Errors
- Return appropriate HTTP status (400/404/405)
- Include JSON-RPC error in response body
- Use standard error codes for consistency

## Best Practices

### Security Guidelines
1. **Never commit secrets**: Use environment variables and secret managers
2. **Principle of least privilege**: Disable unnecessary tools
3. **Network isolation**: Use Docker for untrusted servers
4. **Regular rotation**: Rotate API keys and tokens regularly
5. **Audit logging**: Monitor tool usage and access patterns

### Performance Optimization
1. **Lazy loading**: Servers start only when needed
2. **Connection pooling**: Reuse connections for HTTP servers
3. **Tool limiting**: Keep total tools under 100
4. **Resource management**: Clean up server processes properly

### Configuration Management
1. **Version control**: Track configuration changes
2. **Environment separation**: Use different configs for dev/prod
3. **Documentation**: Document server purposes and requirements
4. **Testing**: Validate configurations in development first

### Development Workflow
1. **Start simple**: Begin with single server configurations
2. **Test incrementally**: Add servers one at a time
3. **Monitor logs**: Watch for errors during development
4. **Use disabled flag**: Keep experimental servers disabled
5. **Regular cleanup**: Remove unused server configurations

## Migration and Compatibility

### From Other MCP Clients
When migrating from VS Code or other MCP clients:

```javascript
// VS Code format
{
  "servers": {
    "github": { ... }
  }
}

// Convert to Windsurf format
{
  "mcpServers": {
    "github": { ... }
  }
}
```

### Backwards Compatibility
- Windsurf supports both legacy SSE and modern HTTP transports
- Old configuration files continue to work
- Gradual migration path available for existing setups

## Future Considerations

### Upcoming Features
- Enhanced security models
- Improved error reporting
- Better performance monitoring
- Advanced tool orchestration

### Protocol Evolution
- MCP specification updates
- New transport types
- Enhanced authentication methods
- Improved tool discovery

This specification provides comprehensive guidance for configuring MCP servers in Windsurf, enabling powerful AI-assisted development workflows through the Cascade agent system.