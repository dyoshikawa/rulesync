---
root: false
targets: ["*"]
description: "Amazon Q Developer CLI custom slash commands specification"
globs: []
---

# Amazon Q Developer CLI Custom Slash Commands Specification

## Overview
Amazon Q Developer CLI provides a comprehensive set of built-in slash commands for chat interaction, context management, and system control. While it doesn't currently support custom user-defined slash commands like some other AI tools, it offers extensive built-in command functionality and extensibility through MCP servers and agents.

## Built-in Slash Commands

### Core Chat Commands

#### Session Management
- **`/help`**: Show available commands and usage information
- **`/quit`**: Exit the current chat session
- **`/clear`**: Clear current session chat history
- **`/reset`**: Reset conversation context and start fresh

#### File and Context Operations
- **`/load`**: Import conversation state from JSON file
- **`/save`**: Export conversation state to JSON file
- **`/editor`**: Use configured editor to compose prompts
- **`/usage`**: Display context window usage estimate

#### Advanced Features
- **`/prompts`**: List available prompts and templates
- **`ctrl-j`**: Enable multi-line input mode
- **`ctrl-k`**: Perform fuzzy search within chat
- **`!`**: Execute shell command within CLI session

### Context Management Commands

#### Context Control
- **`/context add`**: Add context files or directories
- **`/context show`**: View current context configuration
- **`/context rm`**: Remove specific context files
- **`/context clear`**: Remove all session context

#### Context Examples
```bash
# Add global context
/context add --global .amazonq/rules/security-standards.md

# Add project-specific context
/context add file://docs/architecture.md

# Show current context
/context show

# Clear all context
/context clear
```

### Agent Management Commands

#### Agent Operations
- **`/agent list`**: Show available agents
- **`/agent schema`**: Display agent configuration JSON schema
- **`/agent create [name]`**: Create new agent configuration
- **`/agent use [name]`**: Switch to specific agent
- **`/agent edit [name]`**: Open agent configuration file for editing

#### Agent Configuration
Agents are configured through JSON files with resource and tool specifications:

```json
{
   "name": "my-agent",
   "description": "Custom development agent",
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

### Profile Management Commands

#### Profile Control
- **`/profile`**: Manage Q Developer profiles
- **`/profile list`**: Show available profiles
- **`/profile switch [name]`**: Change to different profile
- **`/profile create [name]`**: Create new profile

#### Profile Features
- Switch between different context sets
- Enable unique interaction patterns for different projects
- Maintain separate configurations for different workflows

### Tool Management Commands

#### Tool Control
- **`/tools`**: Manage tool permissions and access
- **`/tools list`**: Show available tools from MCP servers
- **`/tools enable [name]`**: Enable specific tools
- **`/tools disable [name]`**: Disable specific tools

#### Tool Integration
- Tools provided by MCP servers
- Granular permission control
- Runtime tool management

## Command Categories

### Development Commands
Commands specifically designed for development workflows:

```bash
# Create new agent for development
/agent create dev-agent

# Add development context
/context add file://src/**/*.ts

# Switch to development profile
/profile switch development

# Enable development tools
/tools enable file_operations code_analysis
```

### Project Management Commands
Commands for managing project-specific configurations:

```bash
# Load project context
/context add file://.amazonq/rules/**/*.md

# Use project-specific agent
/agent use project-agent

# Show current project context
/context show

# Save project conversation
/save project-session.json
```

### System Commands
Commands for system interaction and management:

```bash
# Execute shell commands
!ls -la
!git status
!npm test

# Check usage statistics
/usage

# Reset system state
/reset

# Exit session
/quit
```

## Extensibility Through MCP

### MCP-Based Commands
While Amazon Q doesn't support custom slash commands, MCP servers provide extensibility:

#### Tool Integration
- MCP servers expose tools as commands
- Tools invoked through natural language
- Integration with existing command system

#### Example MCP Integration
```json
{
  "mcpServers": {
    "custom-tools": {
      "command": "python",
      "args": ["-m", "my_tools_server"],
      "autoApprove": ["safe_tool", "read_only_tool"]
    }
  }
}
```

### Custom Workflows
Create custom workflows through agent configuration:

```json
{
   "name": "code-review-agent",
   "description": "Specialized agent for code reviews",
   "resources": [
     "file://.amazonq/rules/review-guidelines.md",
     "file://CONTRIBUTING.md"
   ],
   "tools": [
     "file_analysis",
     "code_quality_check"
   ]
}
```

## Advanced Command Usage

### Multi-line Input
Use `ctrl-j` to enable multi-line input for complex prompts:

```bash
# Enable multi-line mode
ctrl-j

# Type multi-line prompt
Please review this code for:
1. Security vulnerabilities
2. Performance issues  
3. Code quality concerns

# Submit with Enter
```

### Command Chaining
Combine commands for complex workflows:

```bash
# Load context and switch agent
/context add file://docs/api.md
/agent use api-agent
/context show

# Execute and save
!npm test
/save test-results.json
```

### Shell Integration
Execute shell commands with full integration:

```bash
# Direct shell execution
!git status
!docker ps
!npm run build

# Combine with AI interaction
!git diff
# Amazon Q can analyze the diff output automatically
```

## Configuration and Customization

### Editor Configuration
Configure external editor for prompt composition:

```bash
# Use configured editor
/editor

# Set editor (if configurable)
export EDITOR=code  # or vim, nano, etc.
```

### Context Persistence
Manage persistent context across sessions:

```bash
# Save conversation state
/save my-session.json

# Load previous session
/load my-session.json

# Resume previous conversation (built-in)
q chat --resume
```

### Profile Customization
Create specialized profiles for different use cases:

```bash
# Create development profile
/profile create development

# Create review profile  
/profile create code-review

# Switch between profiles
/profile switch development
```

## Limitations and Considerations

### Current Limitations
- No custom user-defined slash commands
- Built-in commands cannot be modified
- Limited command extensibility compared to some tools

### Alternative Approaches
1. **MCP Server Development**: Create custom tools through MCP
2. **Agent Configuration**: Define specialized agents for common workflows
3. **Context Templates**: Use context files as command-like templates
4. **Profile Management**: Create profiles for different command sets

## Future Enhancements

### Potential Features
Based on community feedback and tool evolution:
- Custom slash command definition
- User-defined command aliases
- Command scripting capabilities
- Enhanced workflow automation

### Community Requests
- Custom command creation interface
- Command sharing between team members
- Integration with external command systems
- Enhanced automation capabilities

## Best Practices

### Command Usage
1. **Learn Built-in Commands**: Master existing slash commands first
2. **Use Context Effectively**: Leverage context management for workflows
3. **Agent Specialization**: Create specialized agents for different tasks
4. **Profile Organization**: Use profiles to organize different work contexts

### Workflow Integration
1. **Session Management**: Use save/load for important conversations
2. **Context Preparation**: Set up context before complex tasks
3. **Tool Coordination**: Coordinate MCP tools with built-in commands
4. **Shell Integration**: Combine shell commands with AI assistance

### Team Collaboration
1. **Shared Agents**: Create team-wide agent configurations
2. **Context Standards**: Establish common context patterns
3. **Profile Conventions**: Use consistent profile naming
4. **Documentation**: Document custom workflows and configurations

## Summary

Amazon Q Developer CLI command system provides:

- **Comprehensive Built-in Commands**: Extensive set of slash commands for various operations
- **Context Management**: Sophisticated context control and manipulation
- **Agent Integration**: Specialized agents for different workflows
- **Profile System**: Multiple configurations for different use cases
- **MCP Extensibility**: Tool integration through Model Context Protocol
- **Shell Integration**: Direct shell command execution within chat
- **Session Persistence**: Save and resume conversations across sessions

While Amazon Q doesn't currently support custom user-defined slash commands, its extensive built-in command system, agent configuration, and MCP integration provide powerful extensibility and customization options for development workflows.