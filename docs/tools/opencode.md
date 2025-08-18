# SST OpenCode Integration

## Overview

SST OpenCode is an AI coding agent built for the terminal that uses a rule-based system to provide persistent context and project-specific instructions. OpenCode supports permission-based configuration, MCP (Model Context Protocol) integration, and hierarchical rules management.

## What rulesync Generates

rulesync generates OpenCode configurations based on your unified rule files:

### Rules Files
- **Primary**: `AGENTS.md` in repository root
- **Global**: `~/.config/opencode/AGENTS.md` for user-wide rules
- **Permission Control**: `opencode.json` for access permissions

### Permission Configuration
- **File**: `opencode.json` with granular permission controls
- **Scope**: Controls read/write/execute permissions for AI operations
- **Security**: Permission-based access instead of traditional ignore files

### MCP Configuration
- **File**: `opencode.json` (includes MCP server definitions)
- **Transports**: STDIO (local) and HTTP/WebSocket (remote) servers
- **Integration**: Extends AI capabilities with external tools and services

## Configuration Examples

### Basic OpenCode Rules

**Input** (`.rulesync/rules/overview.md`):
```yaml
---
root: true
targets: ["opencode"]
description: "Project overview and development standards"
globs: ["**/*"]
---

# E-commerce Platform

## Tech Stack
- Frontend: React 18 with TypeScript
- Backend: Node.js + Express + PostgreSQL
- Testing: Jest + Testing Library

## Development Standards
1. Use TypeScript strict mode
2. Write comprehensive tests
3. Follow security best practices
4. Implement proper error handling
```

**Generated** (`AGENTS.md`):
```markdown
# E-commerce Platform

## Tech Stack
- Frontend: React 18 with TypeScript
- Backend: Node.js + Express + PostgreSQL
- Testing: Jest + Testing Library

## Development Standards
1. Use TypeScript strict mode
2. Write comprehensive tests
3. Follow security best practices
4. Implement proper error handling
```

### Permission-Based Configuration

**Input** (MCP configuration in `.rulesync/.mcp.json`):
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxx"
      },
      "targets": ["opencode"]
    }
  }
}
```

**Generated** (`opencode.json`):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "write": "ask",
    "run": "ask",
    "read": "allow"
  },
  "mcp": {
    "github": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
      "enabled": true,
      "environment": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxx"
      }
    }
  }
}
```

## OpenCode Features

### Permission-Based Security
Unlike traditional ignore files, OpenCode uses granular permissions:
- **read**: Control file read access (allow/ask/deny)
- **write**: Control file write operations (allow/ask/deny) 
- **run**: Control command execution (allow/ask/deny)
- **Pattern-based**: Apply permissions to specific file patterns

### Hierarchical Rules System
OpenCode discovers rules in this order:
1. Global user rules (`~/.config/opencode/AGENTS.md`)
2. Project-level rules (`AGENTS.md` in repository root)
3. Additional instruction files (via `instructions` array)

### MCP Integration
OpenCode supports Model Context Protocol for external integrations:
- **Local servers**: Via STDIO transport with command execution
- **Remote servers**: Via HTTP/WebSocket endpoints
- **Environment variables**: Secure credential management
- **Tool discovery**: Automatic detection of available MCP tools

## Generated File Structure

When targeting OpenCode, rulesync creates:

```
your-project/
├── AGENTS.md                    # Primary rules file
├── opencode.json               # Configuration and permissions
├── ~/.config/opencode/
│   └── AGENTS.md               # Global user rules (optional)
└── .rulesync/
    ├── rules/                   # Your source rules
    └── .mcp.json               # MCP server definitions (optional)
```

## Advanced Configuration

### Environment-Specific Permissions

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "write": {
      "default": "ask",
      "patterns": {
        "*.md": "allow",
        "src/**/*.ts": "allow",
        ".env*": "deny",
        "package.json": "ask"
      }
    },
    "read": {
      "default": "allow",
      "patterns": {
        ".env*": "deny",
        "secrets/**": "deny",
        "*.key": "deny"
      }
    }
  }
}
```

### Multiple MCP Servers

```json
{
  "mcp": {
    "github": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
      "enabled": true,
      "environment": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxx"
      }
    },
    "filesystem": {
      "type": "local", 
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
      "enabled": true
    },
    "remote-api": {
      "type": "remote",
      "url": "https://api.example.com/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer ${API_TOKEN}"
      }
    }
  }
}
```

## Usage Tips

### Security Best Practices
1. **Use Permission Patterns**: Define granular access controls for different file types
2. **Environment Variables**: Store sensitive data in environment variables, not configuration
3. **Command Restrictions**: Use "ask" or "deny" for potentially dangerous operations
4. **Review Access**: Regularly audit permission configurations

### Team Collaboration
1. **Commit AGENTS.md**: Include in version control for team consistency
2. **Document Permissions**: Explain permission choices in project documentation
3. **Environment Setup**: Document required environment variables for MCP servers
4. **Access Patterns**: Establish team conventions for permission levels

### Performance Optimization
1. **Focused Rules**: Keep AGENTS.md concise and project-focused
2. **MCP Efficiency**: Only enable necessary MCP servers
3. **Permission Granularity**: Use specific patterns rather than broad permissions
4. **Environment Variables**: Use variable expansion for dynamic configuration

## Tool-Specific Features

### CLI Integration
- **Interactive prompts**: OpenCode asks for confirmation on restricted operations
- **Command history**: Tracks executed commands and their outcomes  
- **Project context**: Automatically loads rules from repository root
- **Environment awareness**: Respects environment variables and shell configuration

### Security Model
- **Permission-first**: Explicit permission required for sensitive operations
- **Pattern matching**: Fine-grained control over file and command access
- **Environment isolation**: Secure handling of credentials and API keys
- **Audit trail**: Track and log AI actions for security review

### MCP Ecosystem
- **Tool discovery**: Automatic detection and registration of MCP tools
- **Transport flexibility**: Support for both local and remote MCP servers
- **Error handling**: Graceful degradation when MCP servers are unavailable
- **Performance**: Efficient tool loading and execution

## Import Support

rulesync can import existing OpenCode configurations:

```bash
# Import existing OpenCode rules
npx rulesync import --opencode

# Import with verbose output
npx rulesync import --opencode --verbose
```

This imports:
- Existing `AGENTS.md` files
- Permission configurations from `opencode.json`
- MCP server definitions
- Environment-specific settings

## Best Practices

### Rule Organization
1. **Single AGENTS.md**: Use one comprehensive rules file per project
2. **Clear Structure**: Organize rules with clear headings and sections
3. **Specific Examples**: Include code examples and specific guidelines
4. **Regular Updates**: Keep rules current with project evolution

### Permission Management
1. **Start Restrictive**: Begin with "ask" permissions and relax as needed
2. **Pattern Specificity**: Use specific file patterns rather than broad wildcards
3. **Environment Separation**: Different permission levels for dev/staging/prod
4. **Documentation**: Document permission rationale for team members

### MCP Server Management
1. **Server Purpose**: Clearly document what each MCP server provides
2. **Environment Variables**: Use secure credential management
3. **Server Health**: Monitor MCP server availability and performance
4. **Tool Inventory**: Maintain list of available MCP tools and their purposes

OpenCode's permission-based approach and MCP integration make it a powerful choice for teams requiring fine-grained control over AI assistance while maintaining security and extensibility.