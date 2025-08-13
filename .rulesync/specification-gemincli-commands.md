---
root: false
targets: ["*"]
description: "Gemini CLI custom slash commands specification"
globs: []
---

# Gemini CLI Custom Slash Commands Specification

## Overview
Gemini CLI supports custom slash commands through TOML configuration files that can be placed in specific directories. These commands become available as reusable prompts that can be invoked with `/command-name` syntax.

## File Placement and Scope

### Global Commands (User-wide)
- **Directory**: `~/.gemini/commands/`
- **Scope**: Available across all projects for current user
- **Persistence**: User-specific configuration

### Local Commands (Project-specific)
- **Directory**: `<project>/.gemini/commands/`
- **Scope**: Specific to current project/repository
- **Version Control**: Can be committed for team sharing
- **Precedence**: Local commands override global commands with same name

### Command Discovery
- Commands are automatically discovered from both directories
- No restart required after adding new command files
- Instant availability in `/help` after file creation

## File Format

### TOML Configuration Structure
Commands are defined using TOML files with `.toml` extension:

```toml
description = "Brief description shown in /help"
prompt = """
Your command prompt content here.
Use {{args}} for argument injection.
"""
```

### Required Fields
- **prompt** (string): The prompt text sent to Gemini model

### Optional Fields
- **description** (string): One-line help text shown in `/help`
  - If omitted, CLI derives description from filename

## Command Naming and Namespacing

### Simple Commands
```
~/.gemini/commands/plan.toml → /plan
<project>/.gemini/commands/review.toml → /review
```

### Namespaced Commands
Commands in subdirectories create namespaces using colon syntax:
```
~/.gemini/commands/git/commit.toml → /git:commit
<project>/.gemini/commands/frontend/component.toml → /frontend:component
```

### Naming Rules
- Relative path with dots removed and slashes converted to colons
- Local commands override globals with same fully-qualified name

## Argument Handling

### Method 1: Explicit Placeholder (`{{args}}`)
When prompt contains `{{args}}`, command arguments are injected at that location:

```toml
description = "Generates a fix for a GitHub issue"
prompt = "Please analyze the staged git diff and fix the issue: {{args}}."
```

Usage: `/git:fix "Button misaligned"`

### Method 2: Implicit Append
When no `{{args}}` placeholder is present, arguments are appended to the prompt with two newlines:

```toml
description = "Creates implementation plan"
prompt = "Create a step-by-step implementation plan for the following requirement:"
```

Usage: `/plan Improve startup performance`

## Shell Command Integration

### Inline Shell Execution
Use `!{ <shell-cmd> }` syntax to execute shell commands and substitute output:

```toml
description = "Review staged changes"
prompt = """
Please review the following staged changes:

!{ git diff --staged }

Provide feedback on:
1. Code quality
2. Potential issues
3. Improvement suggestions
"""
```

### Best Practices for Shell Commands
- Keep commands fast and deterministic
- Use commands that provide consistent output
- Avoid interactive or long-running commands
- Test shell commands independently first

## Example Command Files

### Planning Command
```toml
# ~/.gemini/commands/plan.toml
description = "Creates a step-by-step implementation plan"
prompt = """
Your role is strategist only. Devise a comprehensive plan for: {{args}}
Do NOT write or execute code.
Return a markdown document with:
1. Understanding
2. Investigation  
3. Phased Approach
4. Verification
5. Risks
"""
```

### Git Diff Review
```toml
# <project>/.gemini/commands/git/review.toml  
description = "Review git changes for quality and issues"
prompt = """
Please analyze the following git diff:

!{ git diff {{args}} }

Provide a comprehensive review covering:
1. Code quality and readability
2. Potential bugs or issues
3. Performance considerations
4. Security implications
5. Suggested improvements

Format as markdown with clear sections.
"""
```

### Code Optimization
```toml
# ~/.gemini/commands/optimize.toml
description = "Analyze and suggest optimizations"
prompt = """
Analyze the following code for optimization opportunities: {{args}}

Focus on:
1. Performance bottlenecks
2. Memory usage
3. Algorithm efficiency
4. Code complexity
5. Best practices

Provide specific, actionable recommendations with examples.
"""
```

### API Documentation Generator
```toml
# <project>/.gemini/commands/api/docs.toml
description = "Generate API documentation from code"
prompt = """
Generate comprehensive API documentation for: {{args}}

Include:
1. Endpoint descriptions
2. Request/response schemas
3. Authentication requirements
4. Error codes and handling
5. Usage examples

!{ find {{args}} -name "*.py" -o -name "*.js" -o -name "*.ts" | head -10 | xargs cat }

Format as OpenAPI specification where possible.
"""
```

### Test Generation
```toml
# <project>/.gemini/commands/test.toml
description = "Generate unit tests for specified code"
prompt = """
Create comprehensive unit tests for: {{args}}

Requirements:
1. Test all public methods/functions
2. Cover edge cases and error conditions
3. Use appropriate testing framework
4. Include setup and teardown if needed
5. Add descriptive test names

Current code:
!{ cat {{args}} }

Follow project testing conventions and best practices.
"""
```

## Built-in Interactive Commands

### Core Session Commands
- `/help` - List all available commands (built-in and custom)
- `/clear` - Clear conversation history
- `/quit` / `/exit` - Exit CLI session
- `/editor` - Open external editor for input
- `/copy` - Copy last response to clipboard

### Configuration Commands
- `/config` - View/modify configuration settings
- `/theme` - Change CLI theme
- `/auth` - Authentication management
- `/about` - Show CLI version and info

### Memory and Context Commands
- `/memory add` - Add content to memory
- `/memory show` - Display current memory
- `/memory refresh` - Reload memory files
- `/compress` - Compress conversation history

### Development Commands
- `/stats` - Show usage statistics
- `/bug` - Report a bug
- `/tools desc` - Show tool descriptions
- `/privacy` - Privacy settings

### Advanced Commands
- `/chat save|resume|list` - Manage chat sessions
- `/restore` - Restore previous session
- `/vim` - Enable Vim input mode
- `/extensions` - Manage extensions
- `/mcp desc|schema` - MCP server management

### Interactive Prefixes
- `@` - Inject file or directory content (git-aware filtering)
- `!` - Run shell command and include output in prompt
- `/` - Invoke slash commands

### Keyboard Shortcuts
- `Ctrl+L` - Equivalent to `/clear`
- `Ctrl+T` - Toggle MCP tool descriptions
- `Ctrl+C` - Cancel current operation
- `Ctrl+D` - Exit session

## MCP Integration

### MCP-backed Commands
When MCP servers are connected, their prompts automatically appear as slash commands:

```bash
# MCP server prompt becomes slash command
/research --query="vector databases" --depth=3
```

### Command Mapping
- MCP prompt arguments map to command-line flags
- Schema validation handled automatically
- Named parameters supported with `--flag=value` syntax

## Best Practices

### Command Design
1. **Single Purpose**: Each command should have one clear responsibility
2. **Descriptive Names**: Use intuitive command names
3. **Consistent Arguments**: Design predictable argument patterns
4. **Namespace Organization**: Group related commands in subdirectories

### Prompt Engineering
1. **Clear Instructions**: Provide specific, actionable prompts
2. **Context Integration**: Use shell commands to gather relevant context
3. **Output Format**: Specify desired output format (markdown, JSON, etc.)
4. **Role Definition**: Define AI role and constraints clearly

### Project Organization
```
<project>/.gemini/commands/
├── README.md                    # Command documentation
├── plan.toml                   # Project planning
├── review.toml                 # Code review
├── git/
│   ├── commit.toml            # Commit message generation
│   ├── branch.toml            # Branch management
│   └── review.toml            # Change review
├── frontend/
│   ├── component.toml         # Component generation
│   ├── test.toml              # Frontend testing
│   └── docs.toml              # Component documentation
└── api/
    ├── endpoint.toml          # API endpoint creation
    ├── docs.toml              # API documentation
    └── test.toml              # API testing
```

### Version Control Strategy
1. **Global Commands**: Keep in personal dotfiles
2. **Project Commands**: Commit to repository for team sharing
3. **Documentation**: Include command usage in project README
4. **Change Review**: Review command changes in pull requests

## Troubleshooting

### Common Issues
1. **Command Not Found**: Check file naming and directory structure
2. **TOML Syntax Error**: Validate TOML syntax, especially multiline strings
3. **Shell Command Failure**: Test shell commands independently
4. **Argument Issues**: Verify `{{args}}` placement and escaping

### Debugging Steps
1. **Syntax Validation**: Use TOML validator for configuration files
2. **Shell Testing**: Test shell commands in terminal first
3. **Help Verification**: Use `/help` to confirm command registration
4. **Incremental Testing**: Start with simple commands and add complexity

### Performance Optimization
1. **Fast Shell Commands**: Keep shell execution time minimal
2. **Deterministic Output**: Ensure shell commands produce consistent results
3. **Command Caching**: Consider caching expensive operations
4. **Prompt Length**: Keep prompts concise but comprehensive

## Migration and Compatibility

### Version Requirements
- Gemini CLI v0.13+ (July 2025 release or later)
- Use `npm install -g @google/gemini-cli@latest` to upgrade

### Backward Compatibility
- New custom command system introduced in v0.13
- Built-in commands remain consistent across versions
- Legacy prompts can be migrated to TOML format

### Team Adoption
1. **Gradual Migration**: Introduce commands incrementally
2. **Team Training**: Educate team on command usage and creation
3. **Standard Library**: Establish team-wide command standards
4. **Feedback Loop**: Collect usage feedback and iterate on commands

This specification provides comprehensive guidance for creating and managing custom slash commands in Gemini CLI, enabling powerful automation and workflow enhancement capabilities.