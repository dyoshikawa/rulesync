---
root: false
targets: ["*"]
description: "SST OpenCode MCP (Model Context Protocol) server configuration and integration specification"
globs: []
---

# SST OpenCode MCP (Model Context Protocol) Configuration Specification

## Overview
SST OpenCode supports Model Context Protocol (MCP) servers to extend its capabilities with external tools and services. MCP configuration is managed through the `opencode.json` file and supports both local and remote server types.

## Configuration Location

### Primary Configuration File
- **File**: `opencode.json`
- **Locations**:
  - **Global**: `~/.config/opencode/opencode.json`
  - **Per Project**: `opencode.json` in project root
  - **Custom Path**: Set via `OPENCODE_CONFIG` environment variable

### Configuration Precedence
- Project-level configuration overrides global settings
- Environment variables can override configuration values
- Custom config path takes highest precedence

## JSON Configuration Format

### Basic Structure
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "server-id": {
      // Server configuration
    }
  }
}
```

### Schema Validation
- Uses JSON schema for validation: `https://opencode.ai/config.json`
- Supports JSONC (JSON with Comments) format
- Configuration is validated on startup

## Server Types and Configuration

### 1. Local MCP Servers (STDIO Transport)

#### Configuration Format
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "my-local-mcp-server": {
      "type": "local",
      "command": ["bun", "x", "my-mcp-command"],
      "enabled": true,
      "environment": {
        "MY_ENV_VAR": "value"
      },
      "cwd": "/absolute/path"
    }
  }
}
```

#### Configuration Fields
- **type**: Must be `"local"` for STDIO servers
- **command**: Array of command and arguments to execute
- **enabled**: Boolean to enable/disable server (default: true)
- **environment**: Key-value pairs for environment variables
- **cwd**: Optional working directory for server process

#### Examples

##### Node.js Server
```json
{
  "fs-server": {
    "type": "local",
    "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
    "enabled": true
  }
}
```

##### Python Server with Environment
```json
{
  "postgres-introspection": {
    "type": "local",
    "command": ["python", "-m", "mycompany.pg_mcp", "--dsn", "postgres://..."],
    "enabled": true,
    "environment": {
      "PGSSLROOTCERT": "/etc/ssl/certs/ca.pem"
    }
  }
}
```

##### Bun/Deno Server
```json
{
  "custom-tools": {
    "type": "local",
    "command": ["bun", "run", "mcp-server.ts"],
    "enabled": true,
    "environment": {
      "NODE_ENV": "development"
    }
  }
}
```

### 2. Remote MCP Servers (HTTP/WebSocket Transport)

#### Configuration Format
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "jira-cloud": {
      "type": "remote",
      "url": "https://mcp.jira.my-company.com",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer ${JIRA_MCP_TOKEN}"
      }
    }
  }
}
```

#### Configuration Fields
- **type**: Must be `"remote"` for HTTP/WebSocket servers
- **url**: Full base URL of the MCP service
- **enabled**: Boolean to enable/disable server
- **headers**: HTTP headers for authentication and custom metadata

#### Examples

##### API Service with Authentication
```json
{
  "sentry-prod": {
    "type": "remote",
    "url": "https://mcp.sentry.io",
    "enabled": true,
    "headers": {
      "Authorization": "Bearer ${SENTRY_MCP_TOKEN}",
      "X-Client-Version": "1.0.0"
    }
  }
}
```

##### Internal Service
```json
{
  "company-api": {
    "type": "remote",
    "url": "https://internal-mcp.company.com/v1",
    "enabled": true,
    "headers": {
      "X-API-Key": "${COMPANY_API_KEY}",
      "X-Environment": "production"
    }
  }
}
```

## Environment Variable Support

### Variable Substitution
```json
{
  "environment": {
    "API_KEY": "${MY_API_KEY}",
    "DATABASE_URL": "${DATABASE_URL}",
    "DEBUG": "true"
  },
  "headers": {
    "Authorization": "Bearer ${TOKEN}",
    "X-Custom-Header": "${CUSTOM_VALUE}"
  }
}
```

### Security Best Practices
- Store sensitive data in environment variables
- Never hardcode secrets in configuration files
- Use descriptive environment variable names
- Document required environment variables

## Complete Configuration Examples

### Mixed Local and Remote Servers
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "fs-server": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
      "enabled": true
    },
    "postgres-introspection": {
      "type": "local",
      "command": ["python", "-m", "mycompany.pg_mcp", "--dsn", "postgres://..."],
      "enabled": true,
      "environment": {
        "PGSSLROOTCERT": "/etc/ssl/certs/ca.pem"
      }
    },
    "sentry-prod": {
      "type": "remote",
      "url": "https://mcp.sentry.io",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer ${SENTRY_MCP_TOKEN}"
      }
    }
  }
}
```

### Development vs Production Configuration
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "database-dev": {
      "type": "local",
      "command": ["python", "-m", "db_mcp_server"],
      "enabled": true,
      "environment": {
        "ENVIRONMENT": "development",
        "DB_HOST": "localhost",
        "DB_NAME": "app_dev"
      }
    },
    "database-prod": {
      "type": "remote",
      "url": "https://prod-mcp.company.com/db",
      "enabled": false,
      "headers": {
        "Authorization": "Bearer ${PROD_DB_TOKEN}",
        "X-Environment": "production"
      }
    }
  }
}
```

## Server Management and Operations

### Server Lifecycle
1. **Configuration Loading**: OpenCode reads `opencode.json` on startup
2. **Server Discovery**: Identifies enabled MCP servers
3. **Process Spawning**: Launches local servers or connects to remote endpoints
4. **Tool Registration**: Discovers available tools from each server
5. **Runtime Operations**: AI can invoke tools as needed

### Hot Reloading
- Restart OpenCode CLI to reload configuration changes
- Changes to `opencode.json` require application restart
- Environment variable changes are picked up on restart

### Server Status and Debugging
- Local servers: Monitor stdout/stderr in terminal
- Remote servers: Check network connectivity and HTTP status
- Tool discovery: Verify tools appear in AI context
- Error handling: Review OpenCode logs for connection issues

## Command Line Integration

### CLI Commands
```bash
# Start with debug logging to see MCP server status
opencode -d

# Start with specific working directory
opencode -c /path/to/project

# Use environment variables
SENTRY_MCP_TOKEN=xyz123 opencode
```

### Server Verification
- Local servers: Output appears in OpenCode terminal
- Tool availability: AI will reference available tools
- Error messages: Connection failures logged to console

## Security Considerations

### Authentication and Authorization
- Use environment variables for API keys and tokens
- Implement proper authentication headers for remote servers
- Validate SSL certificates for HTTPS connections
- Use least-privilege access for server credentials

### Network Security
- Configure appropriate firewall rules
- Use HTTPS for all remote server connections
- Implement rate limiting and monitoring
- Validate server certificates and endpoints

### Local Server Security
- Validate command paths and arguments
- Use absolute paths when possible
- Restrict working directory access
- Monitor server process behavior

## Best Practices

### Configuration Management
1. **Version Control**: Commit `opencode.json` without secrets
2. **Environment Variables**: Use `.env` files for local development
3. **Documentation**: Document required environment variables
4. **Testing**: Validate configurations in development environments

### Server Selection
1. **Official Servers**: Prefer well-maintained MCP servers
2. **Community Servers**: Evaluate security and maintenance status
3. **Custom Development**: Follow MCP specification guidelines
4. **Performance**: Consider server response times and resource usage

### Operational Excellence
1. **Monitoring**: Implement health checks for production servers
2. **Logging**: Enable appropriate logging levels
3. **Error Handling**: Graceful degradation when servers unavailable
4. **Updates**: Keep servers and dependencies updated

## Troubleshooting

### Common Issues

#### 1. Local Server Startup Failures
**Symptoms**: Server doesn't start or crashes immediately
**Solutions**:
- Verify command path and arguments
- Check executable permissions
- Validate environment variables
- Review server logs and error output

#### 2. Remote Server Connection Issues
**Symptoms**: Cannot connect to remote MCP server
**Solutions**:
- Verify URL accessibility and network connectivity
- Check authentication headers and credentials
- Validate SSL certificates
- Review firewall and proxy settings

#### 3. Tool Discovery Problems
**Symptoms**: Server connects but tools not available
**Solutions**:
- Verify server implements MCP protocol correctly
- Check server tool registration
- Review OpenCode logs for protocol errors
- Test server independently

#### 4. Environment Variable Issues
**Symptoms**: Authentication failures or missing configuration
**Solutions**:
- Verify environment variables are set
- Check variable name spelling and case sensitivity
- Test variable expansion manually
- Use absolute paths instead of relative variables

### Debugging Steps
1. **Configuration Validation**: Verify JSON syntax and schema compliance
2. **Manual Testing**: Test commands and URLs manually
3. **Log Analysis**: Review OpenCode debug output
4. **Network Testing**: Verify connectivity to remote servers
5. **Process Monitoring**: Check local server process status

## MCP Protocol Compliance

### Supported Features
- Tool discovery and invocation
- Local STDIO transport
- Remote HTTP/WebSocket transport
- Environment variable substitution
- Server lifecycle management

### Protocol Requirements
- JSON-RPC 2.0 message format
- Proper handshake and capability negotiation
- Tool schema validation
- Error handling and reporting

## Summary

SST OpenCode's MCP integration provides powerful extensibility through:

- **Dual Transport Support**: Both local STDIO and remote HTTP/WebSocket servers
- **Flexible Configuration**: Project and global configuration files
- **Environment Integration**: Secure credential management via environment variables
- **Hot Configuration**: Runtime server management and control
- **Security Features**: Authentication, authorization, and secure communication
- **Development Workflow**: Seamless integration with coding tasks

The system enables OpenCode to interact with external services, databases, APIs, and tools while maintaining security and performance standards.