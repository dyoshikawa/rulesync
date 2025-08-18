---
root: false
targets: ["*"]
description: "AugmentCode MCP (Model Context Protocol) configuration specification"
globs: []
---

# AugmentCode MCP (Model Context Protocol) Configuration Specification

## Overview
AugmentCode (also known as Augment or Claude Code) supports Model Context Protocol (MCP) servers to extend functionality with external tools and services. MCP servers can be configured through multiple methods with different scopes.

## Configuration Scopes

### Scope Priority (highest to lowest)
1. **Local** - Only you, only this project
2. **Project** - Shared via `.mcp.json` in repository
3. **User** - Available in every project on your machine

### Scope Selection Guidelines
- **Local**: Quick experiments and personal testing
- **Project**: Team tools checked into version control
- **User**: Personal "global" utilities available everywhere

## Configuration Methods

### Method 1: GUI Settings Panel (Recommended for Beginners)
1. Click the gear 🛠️ in the Augment side panel → "MCP servers"
2. Press "＋" → fill in required fields:
   - **Name**: Unique identifier (e.g., "sqlite")
   - **Command**: Binary or launch script (e.g., "uvx")
   - **Args**: Optional argument array
3. Save and reload the IDE

### Method 2: JSON Configuration (Power Users)

#### VS Code Settings
Access via Command Palette:
```
Ctrl/Cmd-Shift-P → "Preferences: Open Settings (JSON)"
```

#### JetBrains Settings
Access via Command Palette:
```
Ctrl/Cmd-Shift-A → "Augment: Edit Settings (JSON)"
```

#### Configuration Format
```json
{
  "augment.advanced": {
    "mcpServers": [
      {
        "name": "sqlite",
        "command": "uvx",
        "args": ["mcp-server-sqlite", "--db-path", "/path/to/test.db"]
      }
    ]
  }
}
```

### Method 3: Anthropic CLI
For users preferring command-line management:

```bash
# STDIO (local) server
claude mcp add -s local sqlite uvx mcp-server-sqlite --db-path ~/test.db

# SSE (push) server
claude mcp add --transport sse -s project sse-chat https://api.example.com/mcp

# HTTP (streamable) server
claude mcp add --transport http -s user vector http://localhost:4000/mcp
```

## Transport Types

### 1. STDIO (Standard Input/Output)
- **Usage**: Local process communication
- **Best for**: Local tools and utilities
- **Configuration**:
```json
{
  "command": "uvx",
  "args": ["mcp-server-sqlite", "--db-path", "${workspaceFolder}/db.sqlite"]
}
```

### 2. SSE (Server-Sent Events)
- **Usage**: Real-time streaming from remote servers
- **Best for**: Live data feeds and push notifications
- **Configuration**:
```json
{
  "transport": "sse",
  "url": "https://api.example.com/mcp",
  "headers": { "Authorization": "Bearer TOKEN" }
}
```

### 3. HTTP (Request/Response)
- **Usage**: Standard HTTP endpoints
- **Best for**: REST API integration
- **Configuration**:
```json
{
  "transport": "http",
  "url": "http://localhost:4000/mcp",
  "headers": { "X-API-Key": "secret" }
}
```

## Configuration Examples

### SQLite Database Server
```json
{
  "name": "sqlite",
  "command": "uvx",
  "args": ["mcp-server-sqlite", "--db-path", "${workspaceFolder}/db.sqlite"]
}
```

### Docker-Isolated Server
```json
{
  "name": "isolated-tools",
  "command": "docker",
  "args": [
    "run", "--rm", "-i",
    "-v", "mcp-sqlite:/mcp",
    "mcp/sqlite",
    "--db-path", "/mcp/db.sqlite"
  ]
}
```

### Remote API Server
```json
{
  "name": "external-api",
  "transport": "sse",
  "url": "https://api.company.com/mcp",
  "headers": {
    "Authorization": "Bearer ${API_TOKEN}",
    "X-Client": "augment-code"
  }
}
```

### Windows-Specific Configuration
```bash
claude mcp add my-js-server -- cmd /c npx -y @my/package
```
Note: The extra `cmd /c` prevents "Connection closed" errors on native Windows shells.

## Project-Scoped Configuration

### File Location
- **File**: `.mcp.json` in repository root
- **Version control**: Should be committed for team consistency
- **Security**: Contributors prompted once to approve servers

### File Format
```json
{
  "mcpServers": {
    "project-sqlite": {
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "./data/project.db"]
    },
    "github-integration": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {}
    }
  }
}
```

## Configuration Fields

### Common Fields
- **name**: Unique server identifier (required)
- **command**: Executable path for STDIO transport
- **args**: Command line arguments array
- **env**: Environment variables object
- **timeout**: Request timeout in milliseconds

### Transport-Specific Fields
- **transport**: Transport type ("stdio", "sse", "http")
- **url**: Endpoint URL for remote servers
- **headers**: HTTP headers for authentication

### Advanced Fields
- **scope**: Configuration scope ("local", "project", "user")
- **enabled**: Boolean to enable/disable server
- **retries**: Number of connection retry attempts

## Environment Variables

### Variable Substitution
Use standard environment variable syntax:
```json
{
  "args": ["--db-path", "${WORKSPACE_ROOT}/data.db"],
  "env": {
    "API_KEY": "${MCP_API_KEY}",
    "DEBUG": "true"
  }
}
```

### Common Variables
- `${workspaceFolder}`: Current workspace root
- `${userHome}`: User home directory
- `${env:VAR_NAME}`: System environment variable

## Management Commands

### Validation Commands
```bash
# List all configured servers
claude mcp list

# Check specific server status
claude mcp get <server-name>

# Test server connection
/mcp
```

### In-Application Commands
- **Chat command**: `/mcp` - Lists servers and status
- **Status check**: View MCP section in Augment side panel
- **Re-index**: Reload servers after configuration changes

## Security Considerations

### Server Trust
- Treat third-party MCP servers like browser extensions
- Read server code before deployment
- Use Docker containers for isolation when possible
- Prefer read-only flags unless write access is essential

### Authentication
- Store API keys in environment variables
- Use secure headers for remote servers
- Avoid hardcoded credentials in configuration files
- Implement proper CORS restrictions for HTTP servers

### Network Security
- Require API keys for LAN-exposed servers
- Use HTTPS/TLS for remote connections
- Monitor for prompt injection vectors
- Restrict server network access when possible

## Troubleshooting

### Common Issues and Solutions

| Issue | Likely Cause | Fix |
|-------|--------------|-----|
| "Server timed out" | Slow server boot | Increase `MCP_TIMEOUT` environment variable or optimize startup |
| "Connection closed" | Windows + npx issue | Wrap command with `cmd /c` |
| "No such name" | Scope conflicts | Use `claude mcp get <name>` to check scope hierarchy |
| "Unknown tool" | Outdated schema | Update server; MCP spec changed in Feb 2025 |

### Debugging Steps
1. Test server manually outside of Augment
2. Check server logs and error output
3. Verify environment variables are set correctly
4. Confirm network connectivity for remote servers
5. Review Augment extension logs for detailed errors

### Performance Optimization
- Use local servers for frequently accessed tools
- Implement caching in custom servers
- Minimize server startup time
- Monitor resource usage of running servers

## Version Compatibility

### MCP Specification
- Current version: MCP v0.9+ (May 2025)
- Breaking changes introduced in v0.9
- Keep Augment and servers in sync for compatibility

### Augment Version Requirements
- Minimum: Augment ≥ v0.17.0
- User/project scope support: v0.17.0+
- Enhanced security features: v0.20.0+

## Best Practices

### Configuration Management
1. Use project scope for team-shared servers
2. Document server purposes and capabilities
3. Version control `.mcp.json` files
4. Regular security audits of server configurations

### Development Workflow
1. Test servers locally before team deployment
2. Use meaningful server names
3. Implement proper error handling
4. Monitor server performance and logs

### Team Collaboration
1. Establish team conventions for server naming
2. Document custom server setup procedures
3. Include MCP configurations in code reviews
4. Maintain up-to-date server documentation

## Popular Community Servers

### Database Tools
- `mcp-server-sqlite`: SQLite database operations
- `mcp-postgres`: PostgreSQL integration
- `mcp-mongodb`: MongoDB operations

### Web and API Tools
- `mcp-browser-playwright`: Web automation
- `mcp-github`: GitHub API integration
- `mcp-stripe`: Stripe API operations

### Development Tools
- `mcp-filesystem`: File system operations
- `mcp-git`: Git repository management
- `mcp-docker`: Container management

## Creating Custom Servers

### Basic Server Structure
Follow the MCP specification at modelcontextprotocol.io for creating custom servers.

### Recommended Frameworks
- **Python**: `mcp` package
- **TypeScript/JavaScript**: `@modelcontextprotocol/sdk`
- **Go**: Community MCP libraries
- **Rust**: Community MCP libraries

### Testing Custom Servers
1. Test standalone functionality
2. Validate MCP protocol compliance
3. Test with Augment integration
4. Performance and security testing

## Summary

AugmentCode's MCP system provides powerful extensibility through:

- **Multiple Configuration Methods**: GUI, JSON, and CLI options
- **Flexible Scoping**: Local, project, and user-level configurations
- **Transport Variety**: STDIO, SSE, and HTTP protocols
- **Security Features**: Sandboxing and authentication support
- **Team Collaboration**: Version-controlled project configurations
- **Rich Ecosystem**: Growing library of community servers

The system balances ease of use with powerful customization options, enabling teams to extend Augment's capabilities while maintaining security and consistency.