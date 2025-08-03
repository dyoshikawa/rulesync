---
root: false
targets: ["*"]
description: "Windsurf AI code editor MCP (Model Context Protocol) configuration specification"
globs: []
---

# Windsurf AI Code Editor MCP (Model Context Protocol) Configuration Specification

## Overview
Windsurf's Cascade AI supports Model Context Protocol (MCP) servers to extend its capabilities with external tools and services. MCP allows integration with various language servers, APIs, and development tools to enhance AI-assisted coding workflows.

## Configuration Location

### Primary Configuration File
- **File**: `mcp_config.json`
- **macOS/Linux**: `~/.codeium/windsurf/mcp_config.json`
- **Windows**: `C:\Users\<username>\.codeium\windsurf\mcp_config.json`

### Access Methods
1. **Via UI**: Windsurf → Settings → Cascade → Plugins → "View raw config"
2. **Direct File Editing**: Edit the JSON file manually

## Configuration Methods

### 1. GUI Configuration (Recommended)
- **Path**: Windsurf → Settings → Cascade → Plugins
- **Options**:
  - "Add Server" - Configure new MCP server
  - Plugin Store - Browse and install available servers
- **Workflow**: 
  1. Add server via UI
  2. Press "Refresh" button to load changes
  3. Verify server appears in tools list

### 2. Manual JSON Configuration
Direct editing of the `mcp_config.json` file for advanced configurations.

## JSON Schema and Format

### Basic Structure
```json
{
  "mcpServers": {
    "server-id": {
      // Configuration options
    }
  }
}
```

### Transport Types

#### 1. STDIO Transport
For local executable servers communicating via stdin/stdout:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

#### 2. SSE/HTTP Transport
For remote servers using Server-Sent Events:

```json
{
  "mcpServers": {
    "figma": {
      "serverUrl": "https://my-figma-server.example.com/sse"
    }
  }
}
```

### Configuration Fields

#### Required Fields (Transport-Specific)

##### STDIO Transport
- **command**: Path to executable or command name
- **args**: (Optional) Array of command-line arguments
- **env**: (Optional) Environment variables object

##### SSE/HTTP Transport
- **serverUrl**: Full URL to the SSE endpoint (must end with `/sse`)

#### Optional Fields
- **env**: Environment variables passed to the server process
- Custom server-specific configuration fields

## Configuration Examples

### GitHub Integration
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

### Database Integration
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
      ]
    }
  }
}
```

### File System Access
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"]
    }
  }
}
```

### Custom Python Server
```json
{
  "mcpServers": {
    "custom-tools": {
      "command": "python",
      "args": ["-m", "my_mcp_server", "--config", "config.json"],
      "env": {
        "API_KEY": "your-api-key",
        "DEBUG": "true"
      }
    }
  }
}
```

### Remote SSE Server
```json
{
  "mcpServers": {
    "remote-api": {
      "serverUrl": "https://api.example.com/mcp/sse"
    }
  }
}
```

### Multiple Servers Configuration
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxxxxxxxxx"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
    },
    "database": {
      "command": "python",
      "args": ["-m", "database_mcp_server"],
      "env": {
        "DB_CONNECTION_STRING": "postgresql://user:pass@localhost/db"
      }
    },
    "remote-service": {
      "serverUrl": "https://external-service.com/mcp/sse"
    }
  }
}
```

## Management and Operations

### Server Lifecycle
1. **Configuration**: Add server to `mcp_config.json`
2. **Loading**: Refresh Cascade or restart Windsurf
3. **Verification**: Check Plugins/Tools UI for available tools
4. **Usage**: Tools become available in Cascade chat interface

### Refresh and Reload
- **UI Method**: Click the circular refresh button in Cascade
- **Alternative**: Restart Windsurf application
- **Requirement**: Must refresh after any configuration changes

### Tool Verification
- **Location**: Windsurf → Settings → Cascade → Plugins
- **Display**: Shows loaded servers and available tools
- **Status**: Indicates server connection status

## Limitations and Constraints

### Current Limitations
- **Tool Limit**: Up to 100 MCP tools can be exposed simultaneously
- **Supported Features**: Only tools are supported (not prompts/resources)
- **Image Support**: Image-returning tools are currently unsupported

### Enterprise Considerations
- **Admin Controls**: Enterprise/team admins can disable or whitelist servers
- **Whitelist Compliance**: If whitelisted, JSON configuration must match admin regex rules exactly
- **Security**: Environment variables can contain sensitive data

## Security Best Practices

### Environment Variables
- Store sensitive data (API keys, tokens) in environment variables
- Never hardcode secrets in configuration files
- Use secure environment variable management

### Command Execution
- Validate command paths and arguments
- Use absolute paths when possible
- Restrict access to sensitive directories

### Network Security
- Use HTTPS for remote server connections
- Validate SSL certificates
- Configure appropriate firewall rules

## Troubleshooting

### Common Issues

#### 1. Server Not Loading
**Symptoms**: Server doesn't appear in tools list
**Solutions**:
- Verify JSON syntax is valid
- Check file path and permissions
- Restart Windsurf after configuration changes
- Review server logs for errors

#### 2. Command Not Found
**Symptoms**: STDIO server fails to start
**Solutions**:
- Verify command is in PATH or use absolute path
- Check command arguments are correct
- Ensure dependencies are installed

#### 3. Network Connection Issues
**Symptoms**: SSE server fails to connect
**Solutions**:
- Verify server URL is accessible
- Check network connectivity
- Validate SSL certificates
- Review firewall settings

#### 4. Environment Variable Issues
**Symptoms**: Server starts but lacks access to resources
**Solutions**:
- Verify environment variables are set correctly
- Check variable names match server requirements
- Ensure sensitive data is properly configured

### Debugging Steps
1. **Check Configuration**: Verify JSON syntax and required fields
2. **Test Manually**: Try running commands manually from terminal
3. **Review Logs**: Check Windsurf logs for error messages
4. **Verify Network**: Test network connectivity for remote servers
5. **Validate Tools**: Confirm tools appear in Plugins UI after refresh

## Advanced Configuration

### Docker Integration
```json
{
  "mcpServers": {
    "docker-server": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/workspace:/app",
        "-e", "WORKSPACE=/app",
        "custom/mcp-server:latest"
      ]
    }
  }
}
```

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

### Custom Server Development
For developing custom MCP servers, follow the Model Context Protocol specification and ensure compatibility with Windsurf's tool invocation patterns.

## Best Practices

### Configuration Management
1. **Version Control**: Consider versioning MCP configurations for team consistency
2. **Documentation**: Document server purposes and requirements
3. **Testing**: Validate configurations in development environments
4. **Monitoring**: Regular health checks for production servers

### Server Selection
1. **Official Servers**: Prefer official MCP servers when available
2. **Community Servers**: Evaluate community servers for security and maintenance
3. **Custom Development**: Develop custom servers only when necessary
4. **Performance**: Consider server response times and resource usage

### Integration Strategy
1. **Start Simple**: Begin with basic file system or GitHub integration
2. **Incremental Addition**: Add servers gradually to understand impact
3. **Tool Organization**: Group related tools from the same server
4. **User Training**: Educate team members on available tools

This specification provides comprehensive guidance for configuring MCP servers in Windsurf, enabling powerful integrations that extend Cascade AI's capabilities with external tools and services.