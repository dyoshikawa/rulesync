# Kiro MCP (Model Context Protocol) Configuration Specification

## Overview
Kiro IDE, released by AWS, supports Model Context Protocol (MCP) servers to extend its capabilities with external tools and services. The configuration follows the standard MCP specification with some Kiro-specific enhancements.

## File Placement

### Global Configuration
- **macOS**: `~/Library/Application Support/Kiro/mcp.json`
- **Windows**: `%APPDATA%\Kiro\mcp.json`
- **Linux**: `~/.config/Kiro/mcp.json`

### Workspace/Project Configuration
- **Primary location**: `<project-root>/.kiro/mcp.json`
- **Alternative**: `<project-root>/mcp.json` (at repository root)

### Precedence
- Local/workspace configuration overrides global entries with the same server name
- The file is hot-reloaded; edits take effect without restarting Kiro

## File Format

### Top-Level Structure
```json
{
  "mcpServers": {
    // Server configurations
  }
}
```

The file must be valid JSON with `mcpServers` as the primary key. Additional top-level keys are ignored but do not cause errors.

## Server Configuration Fields

### Required Fields (choose exactly one)
- **command** (string): Executable path for local stdio MCP server
- **url** (string): HTTP/HTTPS endpoint for remote server

### Optional Fields

#### Basic Configuration
- **args** (array of strings): Command-line arguments for the executable
- **env** (object): Environment variables as key-value pairs
- **timeout** (integer): Request timeout in milliseconds (default: 60000)
- **disabled** (boolean): Skip starting this server but keep configuration (default: false)

#### Transport Configuration
- **transport** (string): Explicitly specify transport type
  - `"stdio"` (default for command-based servers)
  - `"sse"` (Server-Sent Events)
  - `"streamable-http"` (future support)

#### Security Configuration
- **autoApprove** (array of strings): Tool names to automatically approve without user prompt
- **autoBlock** (array of strings): Tool names to always block
- **autoapprove**/**autoblock**: Alternative spellings also accepted

## Configuration Examples

### 1. Local stdio Server
```json
{
  "mcpServers": {
    "git-tools": {
      "command": "npx",
      "args": ["-y", "@example/git-mcp"],
      "env": {
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### 2. AWS Documentation Server with Auto-Approval
```json
{
  "mcpServers": {
    "aws-docs": {
      "command": "uvx",
      "args": ["awslabs.aws-documentation-mcp-server@latest"],
      "env": {
        "FASTMCP_LOG_LEVEL": "ERROR"
      },
      "autoApprove": ["search_documentation", "list_services"],
      "disabled": false
    }
  }
}
```

### 3. Remote Server (HTTP/SSE)
```json
{
  "mcpServers": {
    "inventory-service": {
      "url": "https://inventory.example.com/mcp",
      "timeout": 120000,
      "transport": "sse"
    }
  }
}
```

### 4. AWS-Integrated Server
```json
{
  "mcpServers": {
    "aws-tools": {
      "command": "python",
      "args": ["-m", "aws_mcp_server"],
      "env": {
        "AWS_PROFILE": "dev",
        "AWS_REGION": "us-east-1",
        "AWS_SDK_LOAD_CONFIG": "1"
      },
      "timeout": 180000,
      "autoApprove": ["describe_instances", "list_buckets"],
      "autoBlock": ["delete_bucket", "terminate_instances"]
    }
  }
}
```

## AWS-Specific Configuration

### Credential Passing
Always use the `env` block for AWS credentials and configuration:

```json
{
  "env": {
    "AWS_PROFILE": "development",
    "AWS_REGION": "us-east-1",
    "AWS_ACCESS_KEY_ID": "${AWS_ACCESS_KEY_ID}",
    "AWS_SECRET_ACCESS_KEY": "${AWS_SECRET_ACCESS_KEY}",
    "AWS_SESSION_TOKEN": "${AWS_SESSION_TOKEN}"
  }
}
```

### Best Practices for AWS
- Inherit credentials from AWS SDK default provider chain
- Use IAM roles and profiles instead of hardcoded credentials
- Set appropriate timeouts for long-running AWS operations (CloudFormation, etc.)
- Only auto-approve read-only AWS operations

## Security Considerations

### Credential Management
- **Never** commit `mcp.json` with sensitive credentials to version control
- Use environment variable references: `"${VAR_NAME}"`
- Store secrets in AWS Secrets Manager or parameter store
- Add `mcp.json` to `.gitignore` if it contains any sensitive data

### Tool Approval
- Use `autoApprove` sparingly and only for safe, read-only tools
- Always require manual approval for:
  - Tools that modify AWS resources
  - Tools that access sensitive data
  - Tools that execute arbitrary commands
- Use `autoBlock` to prevent accidental use of dangerous tools

### Example .gitignore Entry
```
# Kiro MCP configuration (may contain secrets)
.kiro/mcp.json
mcp.json
```

## Validation and Testing

### JSON Schema (Simplified)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["mcpServers"],
  "properties": {
    "mcpServers": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "oneOf": [
          { "required": ["command"] },
          { "required": ["url"] }
        ],
        "properties": {
          "command": { "type": "string" },
          "url": { "type": "string", "format": "uri" },
          "args": { "type": "array", "items": { "type": "string" } },
          "env": { "type": "object" },
          "timeout": { "type": "integer", "minimum": 1 },
          "disabled": { "type": "boolean" },
          "transport": { "type": "string" },
          "autoApprove": { "type": "array", "items": { "type": "string" } },
          "autoBlock": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  }
}
```

## Common MCP Servers for Kiro

### AWS-Related
- `awslabs.aws-documentation-mcp-server`: Search AWS documentation
- AWS SDK-based custom servers for resource management
- CloudFormation/CDK integration servers

### Development Tools
- Git operations
- GitHub/GitLab API integration
- Package management (npm, pip, cargo)
- Database clients

### Documentation and Knowledge
- API documentation search
- Internal knowledge base access
- Confluence/wiki integration

## Best Practices

### Organization
1. Use workspace-level configuration for project-specific servers
2. Use global configuration for personal development tools
3. Name servers descriptively (becomes tool prefix in Kiro)
4. Group related servers logically

### Performance
1. Set appropriate timeouts based on operation complexity
2. Use `disabled: true` for debugging instead of removing entries
3. Minimize the number of active servers to reduce resource usage

### Team Collaboration
1. Share non-sensitive configurations via version control
2. Document server purposes and tool capabilities
3. Establish team conventions for auto-approval policies
4. Regular review of MCP configurations in code reviews

## Troubleshooting

### Common Issues
1. **Server not starting**: Check command path and permissions
2. **Timeout errors**: Increase timeout value for slow operations
3. **Authentication failures**: Verify environment variables are set
4. **Tool not found**: Ensure server is running and tools are exposed

### Debugging Steps
1. Check Kiro logs for MCP server startup messages
2. Temporarily set higher log levels in server environment
3. Test servers standalone before configuring in Kiro
4. Use `disabled: true` to isolate problematic servers

## Integration with Kiro Features

### Spec-Driven Development
MCP tools can be referenced in spec documents for external integrations

### Agent Hooks
Hooks can trigger MCP tool usage based on file events

### Autopilot Mode
MCP tools respect autopilot settings and approval requirements

## Summary

Kiro's MCP configuration follows the standard Model Context Protocol with AWS-oriented enhancements. Key features include:
- Standard JSON configuration format
- Support for local (stdio) and remote (HTTP/SSE) servers
- Flexible security controls with auto-approve/block
- Hot-reload capability for rapid iteration
- Deep integration with AWS services and credentials
- Workspace and global configuration hierarchy