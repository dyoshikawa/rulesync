---
root: false
targets: ["windsurf"]
description: "Windsurf MCP (Model Context Protocol) configuration specification"
globs: ["~/.codeium/windsurf/mcp_config.json", ".windsurf/mcp_config.json", "**/*.json"]
---

# Windsurf MCP (Model Context Protocol) Configuration Specification

## Overview
Model Context Protocol (MCP) servers expose tools to Windsurf's Cascade AI assistant, enabling integration with external services, databases, and APIs. MCP configuration allows Windsurf to connect to and utilize these extended capabilities.

## Configuration File Placement

### User-Level Configuration (Global)
- **Location**: `~/.codeium/windsurf/mcp_config.json`
- **Scope**: Available to all workspaces for the current user
- **Use Case**: Personal development tools and commonly used servers

### Workspace-Specific Configuration (Project)
- **Location**: `.windsurf/mcp_config.json` in project root
- **Scope**: Specific to current project
- **Behavior**: Merged on top of user-level configuration at load-time
- **Use Case**: Project-specific tools and team-shared configurations

### Configuration Access
- **Settings UI**: Settings → Cascade → "View raw config"
- **Command Palette**: "Open Windsurf Settings" → search for "mcp_config.json"
- **Direct File Editing**: Edit JSON files directly with text editor

## JSON Configuration Schema

### Top-Level Structure
```json
{
  "mcpServers": {
    "<server-ID>": {
      // Server definition object
    }
  }
}
```

### Transport Types

#### 1. STDIO Transport (Local Process)
```json
{
  "command": "<binary | script-runner>",
  "args": ["<arg1>", "<arg2>", "..."],
  "env": {
    "<VAR>": "<value>",
    "...": "..."
  }
}
```

#### 2. Server-Sent Events (SSE)
```json
{
  "serverUrl": "https://host.tld/path/sse"
}
```

#### 3. Streamable HTTP (Remote Endpoint)
```json
{
  "transport": "streamableHttp",
  "url": "https://host.tld/path/mcp"
}
```

## Configuration Examples

### Complete Multi-Transport Configuration
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { 
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx" 
      }
    },
    "figma-dev-mode": {
      "serverUrl": "http://127.0.0.1:3845/sse"
    },
    "zapier-actions": {
      "serverUrl": "https://actions.zapier.com/mcp/ABC123/sse"
    }
  }
}
```

### STDIO Server Examples

#### Node.js Package Server
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/project/root"],
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

#### Python MCP Server
```json
{
  "mcpServers": {
    "postgresql": {
      "command": "python",
      "args": ["-m", "postgresql_mcp_server"],
      "env": {
        "DATABASE_URL": "postgresql://user:pass@localhost/db",
        "DEBUG": "true"
      }
    }
  }
}
```

#### Docker-Based Server
```json
{
  "mcpServers": {
    "database-tools": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "DATABASE_URL",
        "-e", "API_KEY",
        "ghcr.io/org/database-mcp-server"
      ]
    }
  }
}
```

### Remote Server Examples

#### Figma Dev Mode Integration
```json
{
  "mcpServers": {
    "figma-dev-mode": {
      "serverUrl": "http://127.0.0.1:3845/sse"
    }
  }
}
```

#### Zapier Actions Integration
```json
{
  "mcpServers": {
    "zapier-actions": {
      "serverUrl": "https://actions.zapier.com/mcp/YOUR_TOKEN/sse"
    }
  }
}
```

#### Custom API Server
```json
{
  "mcpServers": {
    "internal-api": {
      "transport": "streamableHttp",
      "url": "https://internal-api.company.com/mcp"
    }
  }
}
```

## Server Management Methods

### Method 1: Plugin Store Installation
1. Open Cascade → Plugins icon
2. Browse or search for server
3. Click Install → enter API key/token → Save
4. Press Refresh (⟳) button to load server

### Method 2: Settings UI Configuration
1. Settings → Cascade → "Add Server"
2. Choose from pre-populated list or "Add custom server +"
3. Fill configuration form or use JSON editor
4. Save configuration

### Method 3: Manual JSON Editing
1. Open `~/.codeium/windsurf/mcp_config.json` in text editor
2. Add server configuration to `mcpServers` object
3. Save file
4. Refresh Cascade panel or restart Windsurf

## Server Setup and Deployment

### STDIO Server Requirements
- **Executable**: Must be available in PATH or use absolute path
- **Arguments**: Pass required configuration through `args` array
- **Environment**: Use `env` object for API keys and configuration
- **Startup**: Server launched on-demand when Windsurf starts

### Docker Server Deployment
```json
{
  "mcpServers": {
    "docker-server": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/project:/workspace",
        "-e", "WORKSPACE=/workspace",
        "-e", "API_KEY",
        "custom/mcp-server:latest"
      ]
    }
  }
}
```

### Remote Server Setup
- **SSE Servers**: No local setup required, just provide endpoint URL
- **Hosted Services**: Use provider-issued URLs and authentication
- **Internal Services**: Ensure network connectivity and CORS configuration

## Cascade Integration

### Enabling MCP in Cascade
1. Open Windsurf
2. Cmd/Ctrl + Shift + P → "Open Windsurf Settings"
3. Advanced → Cascade → toggle "Model Context Protocol (MCP)"
4. Add servers via plugin store or JSON configuration
5. Refresh Cascade panel

### Tool Management
- **Tool Limit**: Hard cap of 100 total tools across all servers
- **Tool Selection**: Enable/disable individual tools per server
- **Tool Discovery**: Available tools listed in Cascade sidebar after server connection

### Usage Patterns
```
# Natural language prompts that trigger MCP tools:
"Analyze my PostgreSQL database"
"Get the latest GitHub issues for this repository"
"Fetch design tokens from Figma"
```

## Security and Best Practices

### Security Guidelines
- **Secret Management**: Keep API keys and tokens out of JSON files
- **Environment Variables**: Reference secrets through environment variables
- **Principle of Least Privilege**: Use read-only tokens when possible
- **Token Rotation**: Regularly rotate API keys and access tokens

### Configuration Management
- **Version Control**: Commit workspace `.windsurf/mcp_config.json` for team sharing
- **Documentation**: Document server purposes and configuration requirements
- **Testing**: Verify server connectivity before team deployment
- **Monitoring**: Regular health checks for production servers

### Performance Optimization
- **Selective Servers**: Only configure servers needed for current project
- **Resource Limits**: Monitor memory and CPU usage of stdio servers
- **Caching**: Implement server-side caching for frequently accessed data
- **Connection Pooling**: Use connection pooling for database servers

## Enterprise and Team Controls

### Administrative Controls
- **Access Toggle**: Admins can enable/disable MCP access entirely
- **Server Allowlists**: Whitelist specific server IDs for security
- **Command Validation**: Regex-match command/args patterns for approval
- **Security Policy**: Once allowlist exists, non-listed servers are blocked

### Team Collaboration
- **Shared Configuration**: Use workspace-specific `mcp_config.json` for team consistency
- **Onboarding**: Include MCP server setup in developer onboarding documentation
- **Standards**: Establish team standards for server configuration and usage
- **Review Process**: Include MCP configuration changes in code reviews

## Advanced Configuration Patterns

### Multi-Environment Servers
```json
{
  "mcpServers": {
    "api-dev": {
      "serverUrl": "https://dev-api.company.com/mcp"
    },
    "api-staging": {
      "serverUrl": "https://staging-api.company.com/mcp"
    },
    "api-prod": {
      "serverUrl": "https://api.company.com/mcp"
    }
  }
}
```

### Development vs Production Configuration
```json
{
  "mcpServers": {
    "database": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "DATABASE_URL=${DB_URL_DEV}",
        "postgres-mcp:dev"
      ],
      "env": {
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

### Conditional Server Loading
- Use environment variables to control which servers are active
- Implement feature flags through environment configuration
- Support different server configurations per deployment environment

## Troubleshooting and Debugging

### Common Issues
- **Server Connection Failures**: Verify command paths and network connectivity
- **Authentication Errors**: Check API keys and token validity
- **Tool Limit Exceeded**: Disable unused tools or servers
- **Performance Issues**: Monitor server resource usage and optimize configuration

### Debugging Steps
1. **Server Status**: Check server connection status in Cascade panel
2. **Log Review**: Examine server startup logs and error messages
3. **Manual Testing**: Test server commands and endpoints manually
4. **Configuration Validation**: Verify JSON syntax and structure
5. **Network Connectivity**: Test network access to remote servers

### Tool Refresh Process
- Save configuration changes
- Press Refresh (⟳) button in Cascade panel
- Restart Windsurf if issues persist
- Check server status indicators for connection health

## Migration and Maintenance

### Server Updates
- **Regular Updates**: Keep server packages and Docker images updated
- **Version Pinning**: Pin specific versions for production stability
- **Testing**: Test server updates in development before production deployment
- **Rollback**: Maintain previous working configurations for quick rollback

### Configuration Migration
- **Backup**: Regular backups of working configurations
- **Version Control**: Track configuration changes through Git
- **Documentation**: Maintain change logs for server configurations
- **Team Communication**: Notify team of configuration changes

This comprehensive specification enables effective implementation of Windsurf MCP configuration management in rulesync, supporting both individual and team development workflows with external tool integration.