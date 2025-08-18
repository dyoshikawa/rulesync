---
root: false
targets: ["*"]
description: "Amazon Q Developer CLI MCP (Model Context Protocol) configuration specification"
globs: []
---

# Amazon Q Developer CLI MCP (Model Context Protocol) Configuration Specification

## Overview
Amazon Q Developer CLI supports Model Context Protocol (MCP) to extend its capabilities with external tools and services. MCP configuration is managed through JSON files that define server connections, resource access, and tool integration.

## Configuration File Locations

### Two-Level Configuration System
Amazon Q Developer CLI supports two levels of MCP configuration:

#### 1. Global Configuration
- **File**: `~/.aws/amazonq/mcp.json`
- **Scope**: Applies to all workspaces and projects
- **Usage**: Personal development tools and commonly used servers
- **Persistence**: User-level settings

#### 2. Workspace Configuration
- **File**: `.amazonq/mcp.json` 
- **Location**: Project root directory
- **Scope**: Specific to the current workspace/project
- **Usage**: Project-specific MCP servers and tools
- **Version Control**: Should be committed for team consistency

### Configuration Precedence
- Both files are optional (neither, one, or both can exist)
- If both exist, configurations are merged (union of contents)
- Workspace configuration takes precedence over global for conflicting entries
- Warning displayed for conflicting server definitions

## JSON Configuration Format

### Basic Structure
```json
{
  "mcpServers": {
    "server-name": {
      "command": "command-to-run",
      "args": ["arg1", "arg2"],
      "env": {
        "ENV_VAR1": "value1",
        "ENV_VAR2": "value2"
      },
      "timeout": 30000,
      "disabled": false,
      "autoApprove": ["tool1", "tool2"]
    }
  }
}
```

### Configuration Fields

#### Required Fields
- **command** (string): The shell command used to launch the MCP server

#### Optional Fields
- **args** (array): Command-line arguments passed to the server in exact order
- **env** (object): Environment variables set when launching the server
- **timeout** (number): Maximum wait time in milliseconds for server responses (default: 30000)
- **disabled** (boolean): Temporarily disable server without removing configuration
- **autoApprove** (array): List of tool names that don't require user confirmation

## Configuration Examples

### Basic Python MCP Server
```json
{
  "mcpServers": {
    "python-tools": {
      "command": "python",
      "args": ["-m", "my_mcp_server", "--port", "8080"],
      "env": {
        "PYTHONPATH": "/path/to/modules",
        "DEBUG": "true"
      }
    }
  }
}
```

### AWS Documentation MCP Server
```json
{
  "mcpServers": {
    "awslabs.aws-documentation-mcp-server": {
      "command": "uvx",
      "args": ["awslabs.aws-documentation-mcp-server@latest"],
      "env": {
        "FASTMCP_LOG_LEVEL": "ERROR"
      },
      "disabled": false,
      "autoApprove": ["search_documentation", "get_service_info"]
    }
  }
}
```

### Node.js MCP Server with NPX
```json
{
  "mcpServers": {
    "filesystem-tools": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "timeout": 60000,
      "autoApprove": ["read_file", "list_directory"]
    }
  }
}
```

### Database Integration Server
```json
{
  "mcpServers": {
    "database-server": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "DB_HOST=localhost",
        "-e", "DB_USER=developer",
        "-e", "DB_PASSWORD=secret",
        "my-db-mcp-server:latest"
      ],
      "env": {
        "DATABASE_URL": "postgresql://user:pass@localhost/db"
      }
    }
  }
}
```

### Multi-Environment Configuration
```json
{
  "mcpServers": {
    "dev-database": {
      "command": "python",
      "args": ["-m", "db_mcp_server"],
      "env": {
        "ENVIRONMENT": "development",
        "DB_HOST": "dev-db.example.com",
        "DB_NAME": "app_dev"
      }
    },
    "staging-database": {
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

## MCP Server Management

### CLI Commands
Amazon Q provides dedicated MCP management through the `q mcp` subcommand:
- **`q mcp`**: View current MCP server configuration
- **`q mcp list`**: List all configured MCP servers
- **`q mcp status`**: Show server connection status

### Server Lifecycle
1. **Configuration Loading**: JSON files read on CLI startup
2. **Server Spawning**: Processes launched based on configuration
3. **Tool Discovery**: Available tools enumerated from servers
4. **Runtime Operations**: Tools invoked during chat sessions

### Auto-Approval System
- Tools in `autoApprove` array run without user confirmation
- Other tools require explicit user approval
- Enhances security while streamlining common operations

## Transport Support

### Current Limitations
- **STDIO Only**: Only stdio transport is currently supported
- **Chat Interface**: MCP servers only work in chat interface
- **Future Support**: HTTP and WebSocket transports planned

### STDIO Transport
- Communication through stdin/stdout
- Process spawned for each configured server
- Suitable for local development tools and utilities

## Best Practices

### Security Considerations
1. **Environment Variables**: Store sensitive data in environment variables
2. **No Hardcoded Secrets**: Never include API keys or passwords in JSON
3. **Tool Approval**: Use `autoApprove` judiciously for trusted tools only
4. **Regular Audits**: Review server configurations and tool permissions

### Configuration Management
1. **Version Control**: Commit workspace configurations to repository
2. **Documentation**: Document server purposes and requirements
3. **Team Standards**: Establish consistent naming and structure
4. **Environment Separation**: Use different configurations for dev/prod

### Performance Optimization
1. **Timeout Tuning**: Adjust timeouts based on server response times
2. **Resource Management**: Monitor server resource usage
3. **Selective Enabling**: Disable unused servers to reduce overhead
4. **Tool Scoping**: Limit tool access to necessary operations

## Integration with Amazon Q Features

### Context Integration
- MCP tools work alongside context rules in `.amazonq/rules/`
- Servers provide external capabilities
- Context provides project-specific guidance
- Combined for comprehensive development assistance

### Custom Agents
- MCP servers integrate with custom agent configurations
- Agents can be configured to use specific MCP tools
- Tool access control through agent definitions
- Resource allocation and permission management

### Chat Commands
- MCP tools accessible through chat interface
- `/tools` command for granular permission control
- Tool invocation through natural language requests
- Integration with conversation history and context

## Troubleshooting

### Common Issues

#### Server Connection Problems
- Verify command paths and executable permissions
- Check environment variable configuration
- Validate command-line arguments
- Review server logs for startup errors

#### Tool Discovery Issues
- Confirm server implements MCP protocol correctly
- Verify tool registration in server code
- Check for protocol version compatibility
- Validate JSON configuration syntax

#### Performance Problems
- Monitor server response times
- Adjust timeout values appropriately
- Check resource usage and memory consumption
- Optimize server implementations

### Debugging Steps
1. **Configuration Validation**: Verify JSON syntax and structure
2. **Manual Testing**: Test server commands manually
3. **Log Analysis**: Review server startup and runtime logs
4. **Tool Verification**: Confirm expected tools are available

## Advanced Configuration

### Docker-Based Servers
```json
{
  "mcpServers": {
    "containerized-tools": {
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

### Development vs Production
```json
{
  "mcpServers": {
    "dev-tools": {
      "command": "python",
      "args": ["-m", "dev_server"],
      "env": {
        "DEBUG": "true",
        "LOG_LEVEL": "debug"
      }
    },
    "prod-tools": {
      "command": "python",
      "args": ["-m", "prod_server"],
      "env": {
        "DEBUG": "false",
        "LOG_LEVEL": "error"
      },
      "disabled": true
    }
  }
}
```

## Future Enhancements

### Planned Features
- HTTP and WebSocket transport support
- Enhanced tool discovery mechanisms
- Improved error handling and diagnostics
- Advanced security and permission models

### Community Integration
- Support for community MCP servers
- Server marketplace and registry
- Standardized server templates
- Enhanced documentation and examples

## Summary

Amazon Q Developer CLI's MCP integration provides:

- **Extensible Architecture**: Connect external tools and services
- **Flexible Configuration**: Global and workspace-specific settings
- **Security Controls**: Auto-approval and permission management
- **Development Integration**: Seamless chat interface integration
- **Team Collaboration**: Version-controlled workspace configurations
- **Performance Optimization**: Configurable timeouts and resource management

The MCP system enables Amazon Q to integrate with a wide variety of external tools while maintaining security and performance, creating a powerful and extensible development environment.