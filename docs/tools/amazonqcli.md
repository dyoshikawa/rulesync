# Amazon Q Developer CLI

Amazon Q Developer CLI is AWS's AI-powered coding assistant that provides comprehensive chat interface, context management, and tool integration through MCP (Model Context Protocol).

## What rulesync generates

- **Rules**: `.amazonq/rules/main.md` - Project-specific rules and context
- **MCP Configuration**: `.amazonq/mcp.json` - Model Context Protocol server configuration
- **Built-in Commands Documentation**: Comprehensive documentation of Amazon Q's extensive command system

## Features

### Rules Generation

Amazon Q Developer CLI uses a simple, unified rule format stored in `.amazonq/rules/main.md`:

```markdown
# Project Rules

## Tech Stack
- Framework: Next.js 14
- Language: TypeScript
- Database: PostgreSQL

## Coding Standards
- Use TypeScript strict mode
- Prefer functional components
- Write comprehensive tests

## Security Guidelines
- Never commit secrets
- Validate all inputs
- Use environment variables for config
```

### MCP Server Configuration

rulesync generates comprehensive MCP configurations supporting:

- **Local STDIO servers** for development tools
- **Remote SSE/HTTP servers** for cloud services  
- **Environment variable expansion** for secure credential management
- **Auto-approval lists** for trusted tools

Example generated configuration:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "env": {
        "LOG_LEVEL": "info"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      },
      "autoApprove": ["search_repositories", "list_issues"]
    }
  }
}
```

### Built-in Commands Documentation

Amazon Q CLI provides extensive built-in slash commands:

#### Core Commands
- `/help` - Show available commands
- `/clear` - Clear conversation history  
- `/context add/show/rm/clear` - Context management
- `/agent list/create/use/edit` - Agent operations
- `/profile list/switch/create` - Profile management

#### Development Commands
- `/editor` - Use external editor for prompts
- `/tools list/enable/disable` - Tool management
- Shell command execution with `!` prefix

## Project Configuration

### Agent Configuration (Recommended)

For persistent context, use agent configuration files:

```json
{
   "name": "project-agent",
   "description": "Project-specific development agent",
   "resources": [
     "file://README.md",
     "file://.amazonq/rules/**/*.md",
     "file://docs/**/*.md"
   ],
   "tools": [
     "file_operations",
     "code_analysis"
   ]
}
```

### Session Context (Temporary)

Add temporary context during chat sessions:
```bash
/context add --global .amazonq/rules/main.md
/context show
/context clear
```

## Integration with rulesync

### Import Existing Configuration

```bash
# Import from existing Amazon Q rules
npx rulesync import --amazonqcli

# Import to legacy structure
npx rulesync import --amazonqcli --legacy
```

### Generate Configuration

```bash
# Generate all configurations
npx rulesync generate

# Generate only Amazon Q CLI files
npx rulesync generate --target amazonqcli
```

## Best Practices

### Rule Organization

1. **Keep rules concise** - Focus on essential project context
2. **Use clear structure** - Organize with headings and bullet points
3. **Include examples** - Show preferred code patterns
4. **Security first** - Emphasize security practices

### MCP Integration

1. **Environment variables** - Store sensitive data securely
2. **Auto-approval** - Use judiciously for trusted tools only
3. **Tool validation** - Test MCP servers before deployment
4. **Performance** - Monitor server response times

### Team Collaboration

1. **Version control** - Commit `.amazonq/rules/` for team sharing
2. **Documentation** - Document rule purposes and MCP server requirements
3. **Standards** - Establish team conventions for rule formats
4. **Training** - Educate team on Amazon Q CLI capabilities

## Advanced Features

### Global vs Project Context

- **Global context**: Apply rules across all projects
- **Project context**: Rules specific to current project  
- **Precedence**: Project context takes precedence over global

### Profile Management

Create specialized profiles for different workflows:
```bash
/profile create development
/profile create code-review
/profile switch development
```

### Memory System Integration

Amazon Q automatically stores important facts and allows manual memory creation:
- Auto-generated memories for project insights
- Manual memory creation via chat commands
- Scoped to current workspace

## Troubleshooting

### Common Issues

1. **Rules not applied**: Check file location and agent configuration
2. **MCP servers not connecting**: Verify command paths and environment variables
3. **Context not loading**: Review agent resource patterns
4. **Performance issues**: Reduce rule file size or optimize MCP servers

### Debugging

- Use `/context show` to verify loaded context
- Check MCP server status in Amazon Q interface  
- Validate agent configuration files
- Monitor server logs for connection issues

## Resources

- [Amazon Q Developer CLI Documentation](https://docs.aws.amazon.com/amazonq/)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [Agent Configuration Guide](https://docs.aws.amazon.com/amazonq/latest/user-guide/agents.html)
- [MCP Server Examples](https://github.com/modelcontextprotocol/servers)