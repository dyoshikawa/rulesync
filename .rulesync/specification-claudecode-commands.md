# Claude Code Custom Slash Commands Specification

## Overview
Claude Code supports custom slash commands through Markdown files that can be placed in specific directories. These commands become available as reusable prompts that can be invoked with `/command-name` syntax.

## File Placement and Scope

### Project-Scoped Commands
- **Directory**: `.claude/commands/`
- **Location**: Project root directory
- **Visibility**: Committed to repository, shared with team
- **Display**: Shows "(project)" tag in `/help`

### User-Scoped Commands
- **Directory**: `~/.claude/commands/`
- **Location**: User's home directory
- **Visibility**: Available across all projects for current user
- **Display**: Shows "(user)" tag in `/help`

### Command Discovery
- Commands are automatically discovered from both directories
- No restart required after adding new command files
- Both user and project commands with same name can coexist

## File Format

### Basic Structure
- **Format**: Markdown files (`.md` extension)
- **Naming**: Filename (minus `.md`) becomes command name
- **Content**: Markdown content becomes the prompt sent to Claude

### YAML Front Matter (Optional)
Commands can include YAML configuration at the top of the file:

```yaml
---
description: Brief description shown in /help
argument-hint: add [tagId] | remove [tagId]
allowed-tools: Bash(git status:*), Read(**)
model: claude-3-opus-2025-06-15
---
```

#### Front Matter Fields
- **description**: Help text shown in `/help` (defaults to first line of prompt)
- **argument-hint**: Autocomplete guidance for command arguments
- **allowed-tools**: Restrict which tools the command can use
- **model**: Override the default model for this command

## Command Naming and Namespacing

### Simple Commands
```
.claude/commands/optimize.md → /optimize
.claude/commands/review.md → /review
```

### Namespaced Commands
```
.claude/commands/frontend/component.md → /frontend:component
.claude/commands/git/commit.md → /git:commit
.claude/commands/api/test.md → /api:test
```

## Command Invocation

### Basic Syntax
```
/command-name [arguments]
```

### Argument Injection
- Arguments typed after command name are available as `$ARGUMENTS`
- Arguments are injected into the prompt where `$ARGUMENTS` appears

### Examples
```bash
# Simple command
/optimize

# Command with arguments
/review src/components/Button.tsx

# Namespaced command with arguments
/frontend:component UserProfile --typescript
```

## Special Markup in Prompts

### Shell Command Execution
```markdown
!<bash command>
```
- Executes bash command before sending prompt
- Command stdout is included in conversation context

### File Content Injection
```markdown
@<filepath>
```
- Inlines file contents into the prompt
- Supports relative and absolute paths

### Extended Thinking
- Include extended-thinking keywords to trigger longer reasoning cycles
- Enables more thorough analysis for complex tasks

## Example Command Files

### Basic Optimization Command
```markdown
---
description: Analyze and optimize performance hot-spots
allowed-tools: Bash(git diff:*), Bash(du -h:*)
argument-hint: [file-or-dir]
model: claude-3-opus-2025-06-15
---

Please profile $ARGUMENTS and suggest the top three optimizations.

Consider:
1. Performance bottlenecks
2. Memory usage patterns
3. Code complexity

Provide specific, actionable recommendations with code examples.
```

### Git Commit Helper
```markdown
---
description: Generate conventional commit message from staged changes
allowed-tools: Bash(git:*)
---

Based on the staged git changes, generate a conventional commit message:

!git diff --staged

Format: type(scope): description

Types: feat, fix, docs, style, refactor, test, chore
```

### Code Review Command
```markdown
---
description: Perform comprehensive code review
argument-hint: [file-or-directory]
---

Please review $ARGUMENTS for:

1. **Code Quality**
   - Readability and maintainability
   - Adherence to best practices
   - Performance considerations

2. **Security**
   - Potential vulnerabilities
   - Input validation
   - Authentication/authorization issues

3. **Testing**
   - Test coverage assessment
   - Edge case handling
   - Test quality evaluation

Provide specific suggestions with code examples where applicable.

@$ARGUMENTS
```

### Frontend Component Generator
```markdown
---
description: Generate React component with TypeScript
argument-hint: <ComponentName> [--props prop1,prop2]
---

Create a React component named $ARGUMENTS with:

1. TypeScript interface for props
2. Functional component using hooks
3. Proper JSDoc documentation
4. Basic styling structure
5. Unit test template

Follow project conventions:
- Use functional components
- Implement proper TypeScript types
- Include accessibility attributes
- Add error boundaries where appropriate
```

## MCP Integration

### MCP Server Commands
- MCP servers expose prompts as slash commands
- Format: `/mcp__<server>__<prompt> [args]`
- Names are lowercase with spaces converted to underscores

### Built-in MCP Command
- `/mcp` - Manage MCP servers, list tools, handle OAuth

## Built-in Interactive Commands

### Core Commands
- `/help` - List all available commands
- `/clear` - Clear conversation history
- `/model` - Change the active model
- `/config` - View/modify configuration
- `/memory` - Edit memory files
- `/init` - Create CLAUDE.md in project

### Development Commands
- `/review` - Request code review
- `/doctor` - Run health checks
- `/bug` - Report a bug
- `/terminal-setup` - Install Shift+Enter binding
- `/vim` - Enter Vim mode

### Account & System Commands
- `/login` / `/logout` - Account management
- `/status` - Account and system status
- `/cost` - View token usage statistics
- `/permissions` - View/update permissions

### Advanced Commands
- `/add-dir` - Add additional working directories
- `/agents` - Manage sub-agents
- `/compact [focus]` - Compact conversation history
- `/pr_comments` - Work with GitHub PR comments
- `/mcp` - Manage MCP servers

## Best Practices

### Command Design
1. **Clear Purpose**: Each command should have a single, well-defined purpose
2. **Descriptive Names**: Use clear, descriptive command names
3. **Namespace Organization**: Group related commands using subdirectories
4. **Argument Design**: Design intuitive argument patterns

### Content Guidelines
1. **Specific Instructions**: Provide clear, actionable prompts
2. **Context Inclusion**: Use `@` and `!` markup to include relevant context
3. **Tool Restrictions**: Use `allowed-tools` to limit command scope
4. **Model Selection**: Choose appropriate models for command complexity

### Project Organization
```
.claude/commands/
├── README.md                    # Command documentation
├── code-review.md              # General code review
├── optimize.md                 # Performance optimization
├── frontend/
│   ├── component.md           # React component generation
│   ├── test.md                # Frontend testing
│   └── accessibility.md       # A11y review
├── backend/
│   ├── api.md                 # API design review
│   ├── database.md            # Database optimization
│   └── security.md            # Security analysis
└── git/
    ├── commit.md              # Commit message generation
    ├── branch.md              # Branch management
    └── merge.md               # Merge conflict resolution
```

### Version Control
1. **Commit Commands**: Include `.claude/commands/` in version control
2. **Team Consistency**: Ensure all team members use same commands
3. **Documentation**: Document command usage in project README
4. **Change Management**: Review command changes in pull requests

## Security Considerations

### Tool Restrictions
- Use `allowed-tools` to limit command capabilities
- Restrict file access patterns when possible
- Avoid overly permissive tool access

### Sensitive Data
- Never hardcode secrets or API keys in commands
- Use environment variables for sensitive configuration
- Be cautious with shell command execution

### Team Commands
- Review team-shared commands for security implications
- Establish approval process for new project commands
- Regularly audit existing commands

## Troubleshooting

### Common Issues
1. **Command Not Found**: Check file naming and directory structure
2. **Arguments Not Working**: Verify `$ARGUMENTS` placement in prompt
3. **Tool Access Denied**: Review `allowed-tools` configuration
4. **Model Errors**: Check model availability and permissions

### Debugging
- Use `/help` to verify command registration
- Test commands with simple arguments first
- Check Claude Code logs for detailed error messages
- Validate YAML front matter syntax

This specification provides comprehensive guidance for creating and managing custom slash commands in Claude Code, enabling powerful automation and workflow enhancement capabilities.