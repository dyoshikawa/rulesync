---
root: false
targets: ["*"]
description: "Qwen Code built-in commands and MCP-based extensibility specification"
globs: []
---

# Qwen Code Commands Specification

## Overview
Qwen Code provides a comprehensive set of built-in slash commands for chat interaction, context management, and system control. While it doesn't support custom user-defined slash commands like some other AI tools, it offers extensive built-in functionality and extensibility through MCP servers and automated workflows.

## Built-in Slash Commands

### Core Session Commands

#### Basic Session Management
- **`/help`**: Display available commands and usage information
- **`/quit`** / **`/exit`**: Exit the current CLI session
- **`/clear`**: Clear conversation history and start fresh
- **`/status`**: Show account and system status information

#### Advanced Session Operations
- **`/compact [focus]`**: Compact conversation history to save context
- **`/restore`**: Restore previous conversation state (requires checkpointing)
- **`/resume`**: Resume a previous conversation session

### Context and Memory Commands

#### Memory Management
- **`/memory show`**: Display current loaded context from QWEN.md files
- **`/memory refresh`**: Reload context files from disk
- **`/memory add`**: Add content to the AI's instructional context

#### Context Control
- **`/context`**: Manage conversation context
- **`@<file_path>`**: Inject file or directory content into prompts
- **`@` (lone)**: Pass query as-is (useful for discussing @ symbol)

### File and Project Operations

#### File Discovery and Interaction
- **`@<path>`**: Include file or directory content in prompt
  - Examples:
    - `@src/my_project/ Summarize this code`
    - `@README.md Explain this file`
    - `@My\ Documents/file.txt` (escaped spaces)

#### Project Initialization
- **`/init`**: Analyze current directory and create QWEN.md context file
  - Seeds empty file with project-specific instructions
  - Does not modify existing non-empty files

### Development Tools

#### Shell Integration
- **`!<command>`**: Execute shell command and include output in context
- **Built-in sandboxing**: Support for Docker/Podman execution environments

### System and Configuration

#### Account Management
- **`/login`** / **`/logout`**: Account authentication management
- **`/cost`**: View token usage statistics and billing information

#### Configuration and Debugging
- **`/config`**: View or modify configuration settings
- **`/bug`**: Report a bug (configurable URL template)
- **`/doctor`**: Run system health checks and diagnostics

#### Theme and Interface
- **`/theme`**: Change CLI visual theme
- **`/vim`**: Toggle vim input mode for editing

## MCP-Based Command Extension

### MCP Server Management
- **`/mcp`**: Display MCP server status and available tools
- **`/mcp desc`** / **`/mcp descriptions`**: Show detailed tool descriptions
- **`/mcp nodesc`** / **`/mcp nodescriptions`**: Hide tool descriptions
- **`/mcp schema`**: Show JSON schema for tool parameters
- **`/mcp auth [serverName]`**: Manage OAuth authentication for MCP servers

### MCP Prompt Integration
MCP servers can register prompts that appear as slash commands:
```bash
# Example MCP prompt registration
/poem-writer --title="Qwen Code" --mood="optimistic"
/research --query="vector databases" --depth=3
```

### Keyboard Shortcuts
- **`Ctrl+T`**: Toggle tool descriptions on/off
- **`Ctrl+L`**: Equivalent to `/clear` command
- **`Ctrl+C`**: Cancel current operation
- **`Ctrl+D`**: Exit session

## Command Categories

### AI Model Commands
```bash
# Memory and context management
/memory show
/memory refresh
/memory add

# Context loading
@src/ Analyze this codebase
@README.md What does this project do?
```

### Development Workflow Commands
```bash
# Project setup
/init

# Shell integration  
!git status
!npm test
!docker ps
```

### System Management Commands
```bash
# Status and diagnostics
/status
/doctor
/cost

# Configuration
/config
/theme
/vim
```

## MCP Extensibility Architecture

### Server-Side Tool Registration
```typescript
// Example MCP server tool registration
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'qwen-tools',
  version: '1.0.0',
});

server.registerTool(
  'analyze_code',
  {
    description: 'Analyze code for patterns and issues',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to analyze' },
        language: { type: 'string', description: 'Programming language' }
      },
      required: ['file_path']
    }
  },
  async ({ file_path, language }) => {
    // Tool implementation
    return { analysis: 'Code analysis results...' };
  }
);
```

### Prompt Registration
```typescript
// Register prompts as slash commands
server.registerPrompt(
  'code-reviewer',
  {
    title: 'Code Reviewer',
    description: 'Perform comprehensive code review',
    argsSchema: { 
      file: z.string(),
      focus: z.string().optional() 
    },
  },
  ({ file, focus }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Review the code in ${file}${focus ? ` focusing on ${focus}` : ''}`
        },
      },
    ],
  }),
);
```

## Advanced Command Features

### Environment Integration
```bash
# Environment variables in commands
export QWEN_API_KEY="your-key"
export QWEN_MODEL="qwen3-coder"
qwen "Analyze the project structure"
```

### Configuration Command Patterns
```json
{
  "contextFileName": "QWEN.md",
  "autoAccept": false,
  "theme": "GitHub",
  "vimMode": true,
  "sandbox": "docker"
}
```

### Multi-line Input Support
- **`Ctrl+J`**: Enable multi-line input mode
- Allows complex prompts spanning multiple lines
- Useful for detailed code analysis requests

## Command Security and Sandboxing

### Sandbox Integration
```bash
# Enable sandboxing
qwen -s -p "analyze the code structure"

# Environment variable
export QWEN_SANDBOX=true
qwen -p "run the test suite"

# Configuration
{
  "sandbox": "docker"
}
```

### Safe Command Execution
- Built-in command filtering and validation
- Sandbox environment support (Docker/Podman)
- User confirmation for potentially destructive operations

## Error Handling and Debugging

### Common Command Issues
- **Command Not Found**: Use `/help` to list available commands
- **Permission Errors**: Check file access and sandbox settings  
- **MCP Tool Issues**: Use `/mcp` to check server status
- **Context Loading Errors**: Use `/memory show` to verify loaded context

### Debugging Commands
```bash
# Enable debug mode
qwen --debug

# Check system status
qwen
> /doctor

# Verify MCP integration
qwen
> /mcp
```

## Integration with Development Workflow

### Git Integration
```bash
# Git-aware file discovery
@src/ # Automatically excludes git-ignored files

# Shell command integration
!git status
!git diff --name-only
```

### IDE Integration
- Terminal-based interface works with any IDE
- Integrates with existing development workflows
- Supports project-specific configuration

### Team Collaboration
- Configuration files can be shared via version control
- MCP servers can provide team-wide tools
- Context files enable shared project knowledge

## Best Practices

### Command Usage
1. **Learn Built-ins**: Master existing slash commands before seeking extensions
2. **Use Context**: Leverage `/memory` and `@` commands for project context
3. **MCP Integration**: Use MCP servers for specialized functionality
4. **Documentation**: Document custom MCP tools and workflows

### Security Practices
1. **Sandbox Usage**: Enable sandboxing for untrusted code execution
2. **Permission Control**: Review and approve tool executions
3. **Credential Management**: Use environment variables for secrets
4. **Regular Audits**: Monitor MCP server configurations and permissions

### Development Efficiency
1. **Context Preparation**: Set up comprehensive QWEN.md files
2. **Workflow Automation**: Use MCP servers for repetitive tasks
3. **Command Chaining**: Combine built-in commands effectively
4. **Environment Setup**: Configure optimal development environment

## Limitations and Future Enhancements

### Current Limitations
- No custom user-defined slash commands (unlike some other AI tools)
- Built-in commands cannot be modified or extended directly
- Limited command scripting capabilities

### Extensibility Through MCP
1. **Tool Creation**: Develop custom MCP servers for specialized needs
2. **Prompt Registration**: Create reusable prompt templates
3. **Workflow Automation**: Build automated development workflows
4. **Integration**: Connect with external services and APIs

## Migration from Other AI Tools

### From Tools with Custom Commands
```bash
# Instead of custom slash commands, use MCP servers
# Example: Convert custom command to MCP tool
# /custom-deploy → MCP tool for deployment automation
```

### Workflow Adaptation
1. **Identify Needs**: Determine which custom commands are essential
2. **MCP Development**: Create MCP servers for critical functionality
3. **Context Setup**: Establish comprehensive project context files
4. **Team Training**: Educate team on MCP-based workflow

This specification provides comprehensive guidance for using Qwen Code's built-in commands and extending functionality through MCP servers, enabling powerful and flexible AI-assisted development workflows optimized for Qwen3-Coder models.