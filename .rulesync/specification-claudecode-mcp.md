---
root: false
targets: ["*"]
description: "Claude Code MCP (Model Context Protocol) configuration specification"
globs: []
---

# Claude Code MCP (Model Context Protocol) Configuration Specification

## Overview
Claude Code supports Model Context Protocol (MCP) servers to extend its capabilities with external tools and services. MCP enables standardized communication between Claude and various development tools, databases, APIs, and other services.

## Configuration Location and Hierarchy

### Configuration Files (Priority Order)
1. **Enterprise-Managed Policy** (Highest Priority, Cannot be Overridden)
   - **macOS**: `/Library/Application Support/ClaudeCode/managed-settings.json`
   - **Linux/WSL**: `/etc/claude-code/managed-settings.json`
   - **Windows**: `C:\ProgramData\ClaudeCode\managed-settings.json`

2. **Per-User Configuration** (Global User Settings)
   - **Location**: `~/.claude/settings.json`
   - **Scope**: Applies to all projects for the current user

3. **Per-Project Configuration** (Repository-Specific)
   - **Shared**: `.claude/settings.json` (committed to version control)
   - **Local**: `.claude/settings.local.json` (developer-only, automatically gitignored)

### Precedence Rules
Enterprise → CLI flags → `.claude/settings.local.json` → `.claude/settings.json` → `~/.claude/settings.json`

## JSON Configuration Format

### Basic Structure
```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "executable-path",
      "args": ["argument1", "argument2"],
      "env": {
        "API_KEY": "your-api-key-here",
        "CONFIG_OPTION": "value"
      }
    }
  }
}
```

### Required Fields
- **type**: Must be `"stdio"` (currently the only supported transport)
- **command**: Path to executable or command name (e.g., `"npx"`, `"python"`, `"/usr/local/bin/server"`)
- **args**: Array of command-line arguments
- **env**: Environment variables object (can be empty `{}`)

## Configuration Examples

### 1. GitHub Integration Server
```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

### 2. Filesystem Access Server
```json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/project/root",
        "/additional/allowed/path"
      ],
      "env": {}
    }
  }
}
```

### 3. Database Integration (PostgreSQL)
```json
{
  "mcpServers": {
    "postgres": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "PGHOST=localhost",
        "-e", "PGUSER=developer", 
        "-e", "PGPASSWORD=secret",
        "-e", "PGDATABASE=myapp",
        "ghcr.io/modelcontextprotocol/postgres-mcp:latest"
      ],
      "env": {}
    }
  }
}
```

### 4. Custom Python MCP Server
```json
{
  "mcpServers": {
    "custom-tools": {
      "type": "stdio",
      "command": "python",
      "args": ["-m", "my_mcp_server", "--config", "production.json"],
      "env": {
        "API_KEY": "your-api-key",
        "DEBUG": "false",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### 5. Web Search/Fetch Server
```json
{
  "mcpServers": {
    "fetch": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@kazuph/mcp-fetch"],
      "env": {}
    }
  }
}
```

### 6. Multiple Servers Configuration
```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxxxxxxxxx"
      }
    },
    "filesystem": {
      "type": "stdio", 
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "env": {}
    },
    "database": {
      "type": "stdio",
      "command": "python", 
      "args": ["-m", "database_mcp_server"],
      "env": {
        "DB_CONNECTION_STRING": "postgresql://user:pass@localhost/db"
      }
    }
  }
}
```

## CLI Management Commands

### Add MCP Servers
```bash
# Add STDIO server
claude mcp add server-name /path/to/server [arg1 arg2]

# Add server from JSON configuration
claude mcp add-json server-name '{"type":"stdio","command":"executable","args":["--flag"]}'
```

### Management Commands
```bash
# List all configured servers
claude mcp list

# Show specific server configuration  
claude mcp get server-name

# Remove server configuration
claude mcp remove server-name
```

### Configuration Scopes
```bash
# Add to local scope (default) - .claude/settings.local.json
claude mcp add --scope local server-name /path/to/server

# Add to project scope - .claude/settings.json
claude mcp add --scope project server-name /path/to/server

# Add to user scope - ~/.claude/settings.json  
claude mcp add --scope user server-name /path/to/server
```

### Custom Configuration File
```bash
# Use custom configuration file at runtime
claude --mcp-config /path/to/custom-mcp-config.json
```

## Security Considerations

### Environment Variables
- Store sensitive data (API keys, tokens, passwords) in environment variables
- Never hardcode secrets in configuration files
- Use secure environment variable management systems

### Access Control
- MCP servers have significant access to system resources
- Review server code and permissions before deployment
- Use principle of least privilege for server access

### Network Security
- Validate server sources and integrity
- Use secure communication channels
- Configure firewall rules appropriately

### Example Security-Focused Configuration
```json
{
  "mcpServers": {
    "secure-github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}",
        "GITHUB_API_URL": "https://api.github.com"
      }
    },
    "restricted-filesystem": {
      "type": "stdio",
      "command": "npx", 
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/workspace/src",
        "/workspace/docs"
      ],
      "env": {}
    }
  }
}
```

## Common MCP Server Types

### Official ModelContextProtocol Servers
- **GitHub**: `@modelcontextprotocol/server-github`
- **Filesystem**: `@modelcontextprotocol/server-filesystem`
- **SQLite**: `@modelcontextprotocol/server-sqlite`
- **PostgreSQL**: Docker-based PostgreSQL server
- **Brave Search**: `@modelcontextprotocol/server-brave-search`

### Community Servers
- **Fetch**: `@kazuph/mcp-fetch` - Web content fetching
- **AWS**: Various AWS service integrations
- **Docker**: Container management servers
- **Kubernetes**: Cluster management tools

### Custom Servers
- Python-based servers using the MCP SDK
- Node.js servers with MCP protocol implementation
- Language-specific implementations

## Usage in Claude Code Sessions

### Automatic Tool Discovery
Claude automatically discovers available tools from configured MCP servers and uses them when appropriate.

### Manual Tool Invocation
```bash
# List available MCP tools
/mcp

# Check server status and available tools
/mcp status

# Restart MCP servers
/mcp restart
```

### Tool Naming Convention
MCP tools follow the naming pattern: `mcp__<serverName>__<toolName>`

Example:
- `mcp__github__create_issue`
- `mcp__filesystem__read_file`
- `mcp__database__execute_query`

## Troubleshooting

### Common Issues

#### 1. Server Not Starting
**Symptoms**: Server fails to load or tools not available
**Solutions**:
- Check command path and arguments
- Verify dependencies are installed
- Review server logs in Claude output
- Test server manually from command line

#### 2. Permission Errors
**Symptoms**: Access denied or authentication failures
**Solutions**:
- Check environment variables are set correctly
- Verify API keys and tokens are valid
- Review server permissions and access rights
- Check file system permissions

#### 3. Network Connectivity Issues
**Symptoms**: API calls fail or timeouts occur
**Solutions**:
- Test network connectivity manually
- Check firewall settings
- Verify API endpoints are accessible
- Review proxy configurations

#### 4. Configuration Not Loading
**Symptoms**: MCP servers not recognized
**Solutions**:
- Validate JSON syntax with `jq . .claude/settings.json`
- Check file location and naming
- Restart Claude Code
- Review configuration hierarchy

### Debugging Steps
1. **Validate Configuration**: Check JSON syntax and required fields
2. **Test Dependencies**: Ensure server executables are available
3. **Check Logs**: Review Claude Code output for error messages
4. **Manual Testing**: Test server commands manually from terminal
5. **Environment Validation**: Verify environment variables are set

### Debug Commands
```bash
# Show current MCP configuration
/mcp list

# Test server connectivity
/mcp test server-name

# View server logs
/mcp logs server-name
```

## Best Practices

### Configuration Management
1. **Version Control**: Commit `.claude/settings.json` for team sharing
2. **Secret Management**: Use environment variables for sensitive data
3. **Documentation**: Document server purposes and requirements
4. **Testing**: Validate configurations in development environments

### Server Selection and Setup
1. **Official First**: Prefer official MCP servers when available
2. **Security Review**: Audit third-party servers before deployment
3. **Resource Management**: Monitor server resource usage
4. **Update Management**: Keep servers updated to latest versions

### Team Collaboration
1. **Shared Standards**: Establish team conventions for MCP usage
2. **Server Inventory**: Maintain documentation of available servers
3. **Access Management**: Control server access based on roles
4. **Training**: Educate team on MCP capabilities and usage

### Performance Optimization
1. **Selective Loading**: Only load necessary servers
2. **Resource Monitoring**: Track server performance impact
3. **Connection Pooling**: Use efficient connection management
4. **Caching**: Implement appropriate caching strategies

## Advanced Configuration

### Environment-Specific Configuration
```json
{
  "mcpServers": {
    "dev-database": {
      "type": "stdio",
      "command": "python",
      "args": ["-m", "db_server", "--env", "development"],
      "env": {
        "DB_HOST": "dev-db.example.com",
        "DB_NAME": "myapp_dev"
      }
    },
    "prod-database": {
      "type": "stdio", 
      "command": "python",
      "args": ["-m", "db_server", "--env", "production"],
      "env": {
        "DB_HOST": "prod-db.example.com",
        "DB_NAME": "myapp_prod"
      }
    }
  }
}
```

### Conditional Server Loading
```json
{
  "mcpServers": {
    "dev-tools": {
      "type": "stdio",
      "command": "sh",
      "args": ["-c", "if [ \"$NODE_ENV\" = \"development\" ]; then exec npx dev-mcp-server; else exec npx prod-mcp-server; fi"],
      "env": {
        "NODE_ENV": "development"
      }
    }
  }
}
```

This specification provides comprehensive guidance for configuring MCP servers in Claude Code, enabling powerful integrations that extend Claude's capabilities with external tools and services while maintaining security and performance.