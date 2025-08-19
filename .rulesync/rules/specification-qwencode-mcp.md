---
root: false
targets: ["*"]
description: "Qwen Code MCP (Model Context Protocol) configuration specification"
globs: []
---

# Qwen Code MCP (Model Context Protocol) Configuration Specification

## Overview
Qwen Code supports Model Context Protocol (MCP) servers to extend its capabilities with external tools and services. MCP configuration is managed through JSON files and supports both local STDIO and remote HTTP/SSE server types. The system is based on Gemini CLI's MCP architecture.

## Configuration Location

### Settings File Locations
Configuration files in hierarchical order (highest to lowest priority):

1. **System Settings**
   - Linux: `/etc/gemini-cli/settings.json`
   - Windows: `C:\ProgramData\gemini-cli\settings.json`
   - macOS: `/Library/Application Support/GeminiCli/settings.json`
   - Override: `GEMINI_CLI_SYSTEM_SETTINGS_PATH` environment variable

2. **Project Settings**
   - **File**: `.qwen/settings.json` in project root
   - **Scope**: Project-specific MCP servers
   - **Version Control**: Should be committed for team consistency

3. **User Settings**
   - **File**: `~/.qwen/settings.json`
   - **Scope**: Personal MCP servers across all projects

## JSON Configuration Format

### Basic Structure
```json
{
  "mcpServers": {
    "server-name": {
      // Server configuration
    }
  }
}
```

### Server Configuration Properties

#### Required (choose one)
- **`command`** (string): Executable path for STDIO transport
- **`url`** (string): SSE endpoint URL (e.g., "http://localhost:8080/sse")
- **`httpUrl`** (string): HTTP streaming endpoint URL

#### Optional Properties
- **`args`** (array): Command-line arguments for STDIO servers
- **`env`** (object): Environment variables with `$VAR` or `${VAR}` expansion
- **`cwd`** (string): Working directory for STDIO transport
- **`timeout`** (number): Request timeout in milliseconds (default: 600,000ms)
- **`trust`** (boolean): Bypass all tool call confirmations (default: false)
- **`headers`** (object): Custom HTTP headers for remote servers
- **`includeTools`** (array): Whitelist of tool names to include
- **`excludeTools`** (array): Blacklist of tool names to exclude

## Configuration Examples

### Local STDIO Servers

#### Python MCP Server
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
      "timeout": 15000,
      "includeTools": ["safe_tool", "file_reader", "data_processor"]
    }
  }
}
```

#### Node.js MCP Server
```json
{
  "mcpServers": {
    "nodeServer": {
      "command": "node",
      "args": ["dist/server.js", "--verbose"],
      "cwd": "./mcp-servers/node",
      "trust": true,
      "excludeTools": ["dangerous_tool", "file_deleter"]
    }
  }
}
```

#### Docker-based MCP Server
```json
{
  "mcpServers": {
    "dockerizedServer": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "API_KEY",
        "-v",
        "${PWD}:/workspace",
        "my-mcp-server:latest"
      ],
      "env": {
        "API_KEY": "$EXTERNAL_SERVICE_TOKEN"
      }
    }
  }
}
```

### Remote Servers

#### HTTP MCP Server
```json
{
  "mcpServers": {
    "httpServer": {
      "httpUrl": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer your-api-token",
        "X-Custom-Header": "custom-value",
        "Content-Type": "application/json"
      },
      "timeout": 5000
    }
  }
}
```

#### SSE MCP Server with Authentication
```json
{
  "mcpServers": {
    "sseServer": {
      "url": "https://api.example.com/sse",
      "headers": {
        "Authorization": "Bearer ${API_TOKEN}",
        "X-Client-Version": "1.0.0"
      }
    }
  }
}
```

### GitHub Integration Example
```json
{
  "mcpServers": {
    "github": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
      },
      "trust": false,
      "includeTools": ["create_repository", "list_issues", "search_code"]
    }
  }
}
```

## Environment Variables

### Variable Expansion
Environment variables can be referenced using `$VAR_NAME` or `${VAR_NAME}` syntax:
```json
{
  "env": {
    "API_KEY": "$MY_API_TOKEN",
    "DATABASE_URL": "${DATABASE_CONNECTION_STRING}",
    "DEBUG": "true"
  }
}
```

### Security Best Practices
- Store sensitive data (API keys, tokens) in environment variables
- Never hardcode secrets in configuration files
- Use descriptive environment variable names
- Document required environment variables for team members

## MCP Server Management

### CLI Commands
- **`/mcp`**: Show MCP server status and available tools
- **`/mcp desc`**: Show detailed tool descriptions
- **`/mcp nodesc`**: Hide tool descriptions (show names only)
- **`/mcp schema`**: Show JSON schema for tool parameters
- **`/mcp auth`**: Manage OAuth authentication for MCP servers

### Server Lifecycle
1. **Configuration Loading**: Read settings.json files on startup
2. **Server Discovery**: Identify and validate MCP server configurations
3. **Connection Establishment**: Launch STDIO processes or connect to remote endpoints
4. **Tool Registration**: Discover available tools from each server
5. **Runtime Operations**: Execute tools based on AI requests and user approval

### Auto-Approval and Trust
- **`trust: true`**: Bypasses all confirmation dialogs for this server
- **`includeTools`**: Whitelist specific tools for automatic approval
- **Security Note**: Use trust settings cautiously and only for verified servers

## Tool Management

### Tool Filtering
```json
{
  "mcpServers": {
    "filteredServer": {
      "command": "python",
      "args": ["-m", "my_mcp_server"],
      "includeTools": ["safe_tool", "file_reader", "data_processor"],
      "excludeTools": ["dangerous_tool", "file_deleter"],
      "timeout": 30000
    }
  }
}
```

### Tool Discovery Process
1. Server connects and handshakes with MCP protocol
2. CLI requests available tools via `tools/list`
3. Tools are validated against include/exclude filters
4. Approved tools are registered in global tool registry
5. Tools become available for AI model usage

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
      },
      "trust": false,
      "includeTools": ["read_only_query", "list_tables"]
    }
  }
}
```

### Custom Extension Configuration
```json
{
  "name": "my-extension",
  "version": "1.0.0",
  "mcpServers": {
    "my-server": {
      "command": "node my-server.js"
    }
  },
  "contextFileName": "QWEN.md",
  "excludeTools": ["run_shell_command"]
}
```

## Transport Types

### STDIO Transport
- **Communication**: Standard input/output
- **Best for**: Local tools and utilities
- **Process Management**: CLI manages server lifecycle
- **Configuration**: Uses `command` and `args` properties

### SSE (Server-Sent Events)
- **Communication**: HTTP-based streaming
- **Best for**: Real-time data feeds
- **Configuration**: Uses `url` property
- **Headers**: Supports custom authentication headers

### HTTP Streaming
- **Communication**: HTTP chunked transfer
- **Best for**: REST API integration
- **Configuration**: Uses `httpUrl` property
- **Protocol**: Standard HTTP request/response

## Security Considerations

### Authentication
- Use OAuth for remote servers when available
- Store credentials in environment variables
- Implement proper token management
- Use secure headers for API authentication

### Network Security
- Use HTTPS for all remote server connections
- Validate SSL certificates
- Configure appropriate firewall rules
- Monitor API key usage and access patterns

### Access Control
- Use tool filtering to limit functionality
- Apply trust settings judiciously
- Regular audits of server configurations
- Monitor tool usage patterns

## Troubleshooting

### Common Issues

#### Server Connection Problems
- **Symptoms**: Server not responding or connection timeouts
- **Solutions**:
  - Verify command paths and executable permissions
  - Check environment variables are properly set
  - Validate network connectivity for remote servers
  - Review server startup logs

#### Tool Discovery Issues
- **Symptoms**: Server connects but no tools available
- **Solutions**:
  - Ensure server implements MCP protocol correctly
  - Verify tool registration in server code
  - Check include/exclude tool filters
  - Review server error logs

#### Performance Problems
- **Symptoms**: Slow responses or timeouts
- **Solutions**:
  - Adjust timeout values appropriately
  - Monitor server resource usage
  - Implement server-side caching
  - Optimize tool execution logic

### Debugging Commands
```bash
# Enable debug mode for verbose output
qwen --debug

# Check MCP server status
qwen
> /mcp

# Test tool execution
qwen
> /mcp schema
```

## Integration with Qwen Code Features

### Context Integration
- MCP tools work alongside context files (`QWEN.md`)
- Tools can access project-specific information
- Combined for comprehensive development assistance

### File Discovery
- MCP tools integrate with @ commands
- Support for file content injection
- Git-aware file filtering compatibility

### Development Workflow
- Seamless integration with Qwen3-Coder models
- Support for agentic coding patterns
- Enhanced code understanding capabilities

## Best Practices

### Configuration Management
1. **Version Control**: Commit project MCP configurations to repository
2. **Documentation**: Document server purposes and requirements
3. **Environment Setup**: Use `.env` files for local development
4. **Testing**: Validate configurations in development environments

### Server Development
1. **Error Handling**: Implement robust error handling and logging
2. **Resource Management**: Proper cleanup and connection management
3. **Protocol Compliance**: Follow MCP specification guidelines
4. **Security**: Input validation and secure coding practices

### Team Collaboration
1. **Shared Standards**: Establish team conventions for MCP usage
2. **Tool Documentation**: Document custom tool capabilities
3. **Access Policies**: Define appropriate trust and filtering policies
4. **Regular Reviews**: Audit MCP configurations in code reviews

This specification provides comprehensive guidance for configuring MCP servers in Qwen Code, enabling powerful extensions that enhance AI-assisted development workflows with external tools and services.