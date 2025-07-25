---
root: false
targets: ["*"]
description: "JetBrains Junie Model Context Protocol (MCP) server configuration specification"
globs: "**/*"
---

# JetBrains Junie MCP (Model Context Protocol) Configuration Specification

## Overview
JetBrains Junie supports Model Context Protocol (MCP) servers to extend its capabilities with external tools and services. MCP servers are shared between AI Assistant and Junie within JetBrains IDEs, requiring only a single configuration setup.

## Prerequisites
- **IDE Version**: JetBrains IDE 2025.1 or newer
- **AI Assistant Plugin**: Version 251.* or newer
- **Junie Plugin**: 
  - 2024.3.2+ IDEs: Install from JetBrains Marketplace
  - 2025.1+ IDEs: Bundled automatically with JetBrains AI
- **Runtime**: Node.js 18+ or Docker (depending on MCP server requirements)

## Configuration Location

### IDE Settings Path
**Settings/Preferences** → **Tools** → **AI Assistant** → **Model Context Protocol (MCP)**

Alternative access through Junie settings shows the same configuration interface.

## Server Configuration Levels

### Global Level
- **Scope**: Available to all projects
- **Use Case**: Personal development tools, commonly used servers
- **Persistence**: Settings stored in IDE global configuration

### Project Level  
- **Scope**: Specific to current project
- **Use Case**: Project-specific tools, team-shared configurations
- **Persistence**: Settings stored in project configuration files

## Configuration Methods

### Method 1: GUI Form Configuration
1. Click **"+"** → **New MCP Server**
2. Fill required fields:
   - **Name**: Descriptive server identifier
   - **Command**: Executable path to launch the server
   - **Arguments**: Command-line arguments array
   - **Environment Variables**: API keys, configuration variables
   - **Working Directory**: Execution directory path
3. Select **Level**: Global or Project
4. Click **Apply/OK**

### Method 2: JSON Configuration
1. In New Server dialog, click **Command** → **"As JSON"**
2. Paste complete JSON configuration
3. Apply changes

## JSON Configuration Format

### Basic Structure
```json
{
  "name": "server-identifier",
  "command": "executable-path",
  "args": ["argument1", "argument2"],
  "env": {
    "ENV_VAR": "value",
    "API_KEY": "secret-key"
  },
  "workingDirectory": "/path/to/working/dir",
  "transport": "stdio"
}
```

### Configuration Fields
- **name** (required): Unique server identifier
- **command** (required): Executable command to start the server
- **args** (optional): Array of command-line arguments
- **env** (optional): Environment variables object
- **workingDirectory** (optional): Working directory for server execution
- **transport** (optional): Communication protocol (default: "stdio")

## Transport Types
- **stdio**: Standard input/output communication (default)
- **http**: HTTP endpoint communication (future support)
- **sse**: Server-Sent Events (future support)

## Example Configurations

### 1. JetBrains IDE Proxy Server
Enables Claude/Junie to run IDE refactorings and operations:

```json
{
  "name": "jetbrains-ide",
  "command": "npx",
  "args": ["-y", "@jetbrains/mcp-proxy"],
  "env": {
    "IDE_PORT": "63342",
    "LOG_ENABLED": "true"
  },
  "transport": "stdio"
}
```

**Additional Setup Required**:
1. Install "MCP Server" IDE plugin when prompted
2. Enable **Settings** → **Build** → **Debugger** → **"Can accept external connections"**

### 2. PostgreSQL Database Server
Read-only database introspection:

```json
{
  "name": "postgres-mcp",
  "command": "docker",
  "args": [
    "run", "--rm",
    "-e", "PGHOST=host.docker.internal",
    "-e", "PGUSER=app", 
    "-e", "PGPASSWORD=secret",
    "ghcr.io/modelcontext/postgres-mcp:latest"
  ],
  "transport": "stdio"
}
```

### 3. Filesystem Access Server
File system operations and navigation:

```json
{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/project/root"],
  "env": {
    "LOG_LEVEL": "info"
  },
  "transport": "stdio"
}
```

### 4. GitHub Integration Server
GitHub API operations:

```json
{
  "name": "github-mcp",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxx",
    "GITHUB_API_URL": "https://api.github.com"
  },
  "transport": "stdio"
}
```

### 5. Custom Python MCP Server
Project-specific Python server:

```json
{
  "name": "custom-tools",
  "command": "python",
  "args": ["-m", "my_project.mcp_server"],
  "env": {
    "PROJECT_ROOT": "/path/to/project",
    "CONFIG_FILE": "config.json"
  },
  "workingDirectory": "/path/to/project",
  "transport": "stdio"
}
```

## Server Status and Management

### Status Indicators
- **Green**: Server running successfully
- **Red**: Server failed to start or crashed
- **Yellow**: Server starting or unstable connection

### Status Details
Click status icon to view:
- Available tools exposed by server
- Server connection information
- Error messages and logs

### Server Operations
- **Start/Stop**: Manual server control
- **Restart**: Reload server configuration
- **Remove**: Delete server configuration
- **Duplicate**: Create copy for modification

## Usage in AI Assistant and Junie

### AI Assistant Integration
- Tools automatically invoked when AI response requires external data
- Tool usage displayed in chat with server/tool name
- Natural language requests trigger appropriate MCP tools

### Junie Integration
- MCP tools available in multi-step task planning
- Tools integrated into action graph execution
- Autonomous tool selection based on task requirements

### Manual Tool Invocation
- Type **"/"** in chat to list available commands
- Direct tool calls: `/query SELECT * FROM users;`
- Tab completion for tool names and parameters

## Docker Integration

### Docker-based Servers
```json
{
  "name": "docker-server",
  "command": "docker",
  "args": [
    "run", "-i", "--rm",
    "-v", "/project:/workspace",
    "-e", "WORKSPACE=/workspace",
    "custom/mcp-server:latest"
  ],
  "transport": "stdio"
}
```

### Docker Networking Considerations
- Use `host.docker.internal` for host access from containers
- Map volumes for file system access
- Configure environment variables for container communication

## Security Considerations

### Environment Variables
- Store sensitive data (API keys, tokens) in environment variables
- Avoid hardcoding secrets in configuration files
- Use IDE's secure storage when available

### Command Execution
- Validate command paths and arguments
- Use absolute paths for executables when possible
- Restrict working directory access appropriately

### Network Access
- Configure firewall rules for external connections
- Use HTTPS for remote server communication
- Validate SSL certificates for secure connections

## Troubleshooting

### Common Issues

#### 1. Node.js Version Error
**Error**: "Cannot find module 'node:path'"
**Solution**: Upgrade to Node.js 18 or newer

#### 2. IDE Connection Issues
**Error**: 404 from `/api/mcp/*`
**Solutions**:
- Enable "Can accept external connections" in Debugger settings
- For Docker environments: Use LAN IP + IDE_PORT
- Verify IDE_PORT matches running IDE instance

#### 3. Multiple IDEs Running
**Issue**: MCP proxy targets wrong IDE instance
**Solution**: Specify correct IDE_PORT environment variable

#### 4. Server Startup Failures
**Debugging Steps**:
1. Check command path and arguments
2. Verify environment variables
3. Test server execution manually
4. Review IDE logs in Help → Show Log in Explorer → "mcp" folder

### Log Files and Debugging
- **Location**: IDE log directory → "mcp" subfolder
- **Content**: Server startup logs, communication traces, error messages
- **Access**: Help → Show Log in Explorer

### Performance Optimization
- Limit concurrent server connections
- Use connection pooling for database servers
- Implement server-side caching when appropriate
- Monitor memory usage of long-running servers

## Best Practices

### Configuration Management
1. **Version Control**: Store project-level configurations in VCS
2. **Documentation**: Document server purposes and requirements
3. **Testing**: Validate server configurations in development environments
4. **Monitoring**: Regular health checks for production servers

### Server Development
1. **Error Handling**: Implement robust error handling and logging
2. **Resource Management**: Proper cleanup of resources and connections
3. **API Design**: Clear, consistent tool interfaces
4. **Documentation**: Comprehensive tool documentation and examples

### Security
1. **Secrets Management**: Use secure environment variable storage
2. **Access Control**: Implement appropriate authentication and authorization
3. **Input Validation**: Validate all inputs from AI Assistant/Junie
4. **Audit Logging**: Log all tool invocations for security monitoring

## Advanced Configuration

### Custom Server Implementation
```python
# Example Python MCP server
from mcp import Server
import asyncio

server = Server("custom-tools")

@server.tool("analyze_code")
async def analyze_code(file_path: str) -> str:
    # Custom code analysis logic
    return f"Analysis results for {file_path}"

async def main():
    await server.serve_stdio()

if __name__ == "__main__":
    asyncio.run(main())
```

### Multi-Server Orchestration
```json
{
  "name": "orchestrator",
  "command": "node",
  "args": ["orchestrator.js"],
  "env": {
    "UPSTREAM_SERVERS": "server1:8080,server2:8081",
    "LOAD_BALANCE": "round_robin"
  },
  "transport": "stdio"
}
```

## Integration with JetBrains Ecosystem

### Plugin Development
- Use JetBrains Platform SDK for plugin integration
- Implement MCP server communication protocols
- Follow JetBrains UI/UX guidelines

### IDE API Integration
- Access project structure through IDE APIs
- Integrate with version control systems
- Utilize built-in code analysis tools

### Team Collaboration
- Share server configurations through version control
- Document team-specific server requirements
- Establish server maintenance responsibilities

This specification provides comprehensive guidance for configuring and managing MCP servers in JetBrains Junie environments, enabling powerful AI-assisted development workflows.