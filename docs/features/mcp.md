# Model Context Protocol (MCP) Integration

## Overview

rulesync provides comprehensive support for Model Context Protocol (MCP) servers across multiple AI development tools. MCP enables standardized communication between AI tools and external services, allowing you to configure language servers, databases, APIs, and other services once and deploy them across multiple AI coding assistants.

## Supported Tools

| Tool | Configuration File | Description |
|------|-------------------|-------------|
| **Claude Code** | `.mcp.json` | Project-scoped MCP servers |
| **GitHub Copilot** | `.vscode/mcp.json` | VS Code MCP integration |
| **Cursor** | `.cursor/mcp.json` | Cursor-specific MCP servers |
| **Cline** | `.cline/mcp.json` | Cline MCP server configuration |
| **OpenAI Codex CLI** | `.codex/mcp-config.json` | Codex CLI MCP integration |
| **Gemini CLI** | `.gemini/settings.json` | Gemini CLI MCP configuration |
| **JetBrains Junie** | `.junie/mcp.json` | JetBrains IDE MCP servers |
| **Kiro IDE** | `.kiro/mcp.json` | Kiro IDE MCP integration |
| **Roo Code** | `.roo/mcp.json` | Roo Code MCP servers |
| **Windsurf** | `.windsurf/mcp.json` | Windsurf MCP configuration |

## MCP Configuration

### Source Configuration
Create a `.rulesync/.mcp.json` file in your project:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxx"
      },
      "targets": ["*"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "env": {
        "LOG_LEVEL": "info"
      },
      "targets": ["claudecode", "cursor", "windsurf"]
    },
    "database": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "PGHOST=localhost",
        "-e", "PGUSER=developer",
        "-e", "PGPASSWORD=secret",
        "ghcr.io/modelcontextprotocol/postgres-mcp:latest"
      ],
      "targets": ["codexcli", "geminicli"]
    },
    "remote-api": {
      "url": "https://api.example.com/mcp/sse",
      "headers": {
        "Authorization": "Bearer your-token-here"
      },
      "targets": ["windsurf", "junie"]
    }
  }
}
```

## Configuration Fields

### Common Fields
- **`command`**: Executable path for STDIO transport (required for STDIO)
- **`args`**: Command line arguments array (optional)
- **`env`**: Environment variables object (optional)
- **`targets`**: Array of tool names to deploy this server to

### Transport Options

#### STDIO Transport (Default)
Local executable communicating via stdin/stdout:
```json
{
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxx"
    }
  }
}
```

#### Remote Transports
For remote servers using HTTP/SSE:
```json
{
  "remote-service": {
    "url": "https://external-service.com/mcp/sse",
    "headers": {
      "X-API-Key": "your-api-key"
    }
  }
}
```

### Target Specification
- **`["*"]`**: Deploy to all supported tools (default)
- **`["claudecode", "cursor"]`**: Deploy only to specific tools
- **Tool-specific targeting**: Customize deployment per server

## Common MCP Servers

### GitHub Integration
```json
{
  "github": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxx",
      "GITHUB_API_URL": "https://api.github.com"
    },
    "targets": ["*"]
  }
}
```

**Features**:
- Repository management
- Issue and PR operations
- Code search and navigation
- Branch and commit operations

### Filesystem Access
```json
{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
    "env": {
      "LOG_LEVEL": "info"
    },
    "targets": ["*"]
  }
}
```

**Features**:
- File system navigation
- File read/write operations
- Directory listing and search
- File metadata access

### Database Integration
```json
{
  "postgres": {
    "command": "docker",
    "args": [
      "run", "--rm", "-i",
      "-e", "PGHOST=host.docker.internal",
      "-e", "PGUSER=app",
      "-e", "PGPASSWORD=secret",
      "-e", "PGDATABASE=myapp",
      "ghcr.io/modelcontextprotocol/postgres-mcp:latest"
    ],
    "targets": ["*"]
  }
}
```

**Features**:
- Database schema introspection
- Query execution (read-only by default)
- Table and column metadata
- Performance monitoring

### Custom Python Server
```json
{
  "custom-tools": {
    "command": "python",
    "args": ["-m", "my_project.mcp_server"],
    "env": {
      "PROJECT_ROOT": "/path/to/project",
      "CONFIG_FILE": "config.json",
      "DEBUG": "true"
    },
    "targets": ["claudecode", "windsurf"]
  }
}
```

## Tool-Specific Features

### Kiro IDE Extensions
Kiro IDE supports additional MCP configuration fields:

```json
{
  "aws-tools": {
    "command": "python",
    "args": ["-m", "aws_mcp_server"],
    "env": {
      "AWS_PROFILE": "dev",
      "AWS_REGION": "us-east-1"
    },
    "kiroAutoApprove": ["describe_instances", "list_buckets"],
    "kiroAutoBlock": ["delete_bucket", "terminate_instances"],
    "targets": ["kiro"]
  }
}
```

**Kiro-specific fields**:
- **`kiroAutoApprove`**: Array of tool names to automatically approve
- **`kiroAutoBlock`**: Array of tool names to automatically block

### Gemini CLI Format
Gemini CLI uses a different configuration structure:

Generated in `.gemini/settings.json`:
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxx"
      }
    }
  }
}
```

### OpenAI Codex CLI
Codex CLI uses `.codex/mcp-config.json` for MCP wrapper servers:

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

## Generation and Deployment

### Generating MCP Configurations

MCP configurations are generated alongside rule files:

```bash
# Generate both rules and MCP configurations
npx rulesync generate

# Generate only for specific tools
npx rulesync generate --claudecode --cursor --windsurf

# Generate in specific directories (monorepo)
npx rulesync generate --base-dir ./packages/frontend
```

### Import Existing Configurations

```bash
# Import MCP configurations from existing tools
npx rulesync import --cursor        # Imports .cursor/mcp.json
npx rulesync import --claudecode    # Imports .mcp.json
npx rulesync import --geminicli     # Imports .gemini/settings.json
```

## Docker Integration

### Docker-based MCP Servers
```json
{
  "docker-postgres": {
    "command": "docker",
    "args": [
      "run", "-i", "--rm",
      "-v", "/workspace:/workspace",
      "-e", "WORKSPACE=/workspace",
      "-e", "PGHOST=host.docker.internal",
      "-e", "PGPORT=5432",
      "custom/postgres-mcp:latest"
    ],
    "targets": ["*"]
  }
}
```

### Docker Compose Integration
```json
{
  "compose-services": {
    "command": "docker-compose",
    "args": ["run", "--rm", "mcp-server"],
    "env": {
      "COMPOSE_FILE": "docker-compose.mcp.yml"
    },
    "targets": ["*"]
  }
}
```

## Security Considerations

### Environment Variables
- Store sensitive data (API keys, tokens) in environment variables
- Never hardcode secrets in configuration files
- Use secure environment variable management
- Implement key rotation policies

### Network Security
- Use HTTPS for remote server communications
- Implement proper authentication and authorization
- Configure appropriate firewall rules
- Validate SSL certificates for secure connections

### Access Control
- Implement least privilege access patterns
- Use tool-specific security features (like Kiro's auto-approve/block)
- Monitor MCP server usage and access patterns
- Regular security audits of MCP configurations

## Advanced Configuration

### Multi-Environment Setup
```json
{
  "mcpServers": {
    "dev-database": {
      "command": "python",
      "args": ["-m", "db_mcp_server"],
      "env": {
        "ENVIRONMENT": "development",
        "DB_HOST": "dev-db.example.com"
      },
      "targets": ["*"]
    },
    "prod-database": {
      "command": "python", 
      "args": ["-m", "db_mcp_server"],
      "env": {
        "ENVIRONMENT": "production",
        "DB_HOST": "prod-db.example.com"
      },
      "targets": ["windsurf"]
    }
  }
}
```

### Custom Server Development
Example Python MCP server:

```python
from mcp import Server
import asyncio

server = Server("custom-tools")

@server.tool("analyze_code")
async def analyze_code(file_path: str) -> str:
    """Analyze code quality and suggest improvements."""
    # Custom analysis logic here
    return f"Analysis results for {file_path}"

@server.tool("project_stats")
async def project_stats() -> str:
    """Generate project statistics."""
    # Statistics collection logic
    return "Project statistics data"

async def main():
    await server.serve_stdio()

if __name__ == "__main__":
    asyncio.run(main())
```

### Load Balancing and High Availability
```json
{
  "ha-service": {
    "command": "node",
    "args": ["load-balancer.js"],
    "env": {
      "UPSTREAM_SERVERS": "server1:8080,server2:8081,server3:8082",
      "LOAD_BALANCE_STRATEGY": "round_robin",
      "HEALTH_CHECK_INTERVAL": "30000"
    },
    "targets": ["*"]
  }
}
```

## Monitoring and Debugging

### Logging Configuration
```json
{
  "debug-server": {
    "command": "python",
    "args": ["-m", "my_mcp_server", "--verbose"],
    "env": {
      "LOG_LEVEL": "debug",
      "LOG_FORMAT": "json",
      "LOG_FILE": "/tmp/mcp-server.log"
    },
    "targets": ["claudecode"]
  }
}
```

### Health Checks
- Implement server health check endpoints
- Monitor server startup and connection status
- Log MCP communication for debugging
- Set up alerting for server failures

### Performance Monitoring
- Track request/response latency
- Monitor memory usage of MCP servers
- Implement connection pooling where appropriate
- Optimize server startup times

## Best Practices

### Configuration Management
1. **Version Control**: Store MCP configurations in version control
2. **Environment Separation**: Use different configs for dev/staging/prod
3. **Documentation**: Document server purposes and requirements
4. **Testing**: Validate configurations in development environments

### Server Development
1. **Error Handling**: Implement robust error handling and recovery
2. **Resource Management**: Proper cleanup of resources and connections
3. **Security**: Validate all inputs and implement proper authentication
4. **Performance**: Optimize for common use cases and expected load

### Team Collaboration
1. **Shared Configurations**: Use version control for team consistency
2. **Server Documentation**: Document available tools and their purposes
3. **Access Policies**: Establish clear policies for MCP server access
4. **Training**: Educate team members on MCP server capabilities

## Troubleshooting

### Common Issues
1. **Server Connection Failures**: Check network connectivity and server status
2. **Authentication Errors**: Verify API keys and authentication tokens
3. **Permission Denied**: Review access controls and file permissions
4. **Performance Issues**: Optimize server configurations and resources

### Debugging Steps
1. **Check Server Logs**: Review MCP server logs for error messages
2. **Test Connectivity**: Verify network connections and endpoints
3. **Validate Configuration**: Check JSON syntax and required fields
4. **Environment Variables**: Ensure all required environment variables are set

### Tool-Specific Debugging
- **Claude Code**: Check `.mcp.json` loading in project settings
- **Cursor**: Verify MCP server status in Cursor's MCP panel
- **Gemini CLI**: Use `/mcp` command to list available tools
- **JetBrains**: Check MCP server status in IDE settings

## See Also

- [Configuration](../configuration.md) - General configuration options
- [Tool Integrations](../tools/) - Tool-specific MCP features
- [Best Practices](../guides/best-practices.md) - MCP organization strategies