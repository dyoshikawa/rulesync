# Gemini CLI Integration

## Overview

Gemini CLI supports a memory system and custom slash commands similar to Claude Code. rulesync provides comprehensive integration with Gemini CLI's project-specific configuration and command system.

## Generated Files

| File Type | Output Path | Description |
|-----------|-------------|-------------|
| **Main Memory** | `GEMINI.md` | Primary project memory (root rules) |
| **Memory Details** | `.gemini/memories/*.md` | Detail memory files (non-root rules) |
| **Custom Commands** | `.gemini/commands/*.md` | Custom slash commands |
| **MCP Configuration** | `.gemini/settings.json` | Model Context Protocol servers |
| **Ignore Rules** | `.aiexclude` | File exclusion patterns |

## Memory System

### Hierarchical Structure

Gemini CLI uses a hierarchical memory approach:

- **Global Memory** (`~/.gemini/GEMINI.md`): Personal settings across projects
- **Project Memory** (`GEMINI.md`): Project-specific rules and context
- **Detail Memory** (`.gemini/memories/*.md`): Specific implementation guidelines

### Memory Features

- **Auto-Loading**: Memory files loaded automatically when CLI starts
- **Import System**: GEMINI.md includes `@filename` references to detail files
- **File Discovery**: CLI walks directory tree to find memory files
- **Token Optimization**: Keep under few thousand tokens for performance

## Custom Slash Commands

### Command Generation

rulesync generates custom slash commands from `.rulesync/commands/` directory:

```bash
# Generate commands for Gemini CLI
npx rulesync generate --geminicli
```

### Command Format

Commands use plain Markdown format:

```
.gemini/commands/
├── plan.md              # /plan command  
├── test-all.md          # /test-all command
└── git/
    └── commit.md        # /git:commit command (namespaced)
```

### Command File Structure

Commands use simplified frontmatter and Markdown content:

```markdown
---
description: "Creates a step-by-step implementation plan"
---

# Initialize Project

Analyze this project's codebase and set up the initial configuration.

## Steps:
1. Scan project structure
2. Identify technology stack  
3. Create configuration files
4. Set up development environment
```

## Rule Processing

### Root Rules
- **Target**: Main `GEMINI.md` file
- **Content**: Project overview and high-level guidelines
- **Import References**: Automatically includes `@filename` references to detail files

### Non-Root Rules
- **Target**: `.gemini/memories/*.md` files
- **Content**: Specific implementation rules and detailed guidelines
- **Organization**: One file per rule category

## Usage Examples

### Generate Gemini CLI Configuration

```bash
# Generate only for Gemini CLI
npx rulesync generate --geminicli

# Generate with verbose output
npx rulesync generate --geminicli --verbose

# Generate in specific directory
npx rulesync generate --geminicli --base-dir ./packages/frontend
```

### Import Existing Configuration

```bash
# Import from existing Gemini CLI setup
npx rulesync import --geminicli

# This imports from:
# - GEMINI.md (main memory)
# - .gemini/memories/*.md (detail memories)
# - .gemini/commands/*.md (custom commands)
```

## File Organization

### Standard Structure
```
project-root/
├── GEMINI.md                    # Main project memory
├── .gemini/
│   ├── memories/
│   │   ├── typescript-rules.md
│   │   ├── testing-standards.md
│   │   └── security-guidelines.md
│   ├── commands/
│   │   ├── plan.md
│   │   ├── review.md
│   │   └── git/
│   │       └── commit.md
│   └── settings.json            # MCP configuration
└── .aiexclude                   # Ignore patterns
```

### Content Examples

**Main Memory** (`GEMINI.md`):
```markdown
# Project: E-commerce Platform

Modern e-commerce platform built with React and TypeScript.

## Tech Stack
- React 18 with TypeScript
- Node.js backend with Express
- PostgreSQL database
- Tailwind CSS styling

## Development Standards
Follow clean code principles and maintain consistency.

@typescript-rules
@testing-standards
@security-guidelines
```

**Detail Memory** (`.gemini/memories/typescript-rules.md`):
```markdown
# TypeScript Development Rules

## Coding Standards
- Use strict TypeScript configuration
- Prefer interfaces over types for object shapes
- Use meaningful variable names
- Always write unit tests for business logic

## Architecture Patterns
- Follow clean architecture principles
- Separate concerns with clear module boundaries
- Use dependency injection for external services
```

## Custom Command Examples

### Planning Command
**`.gemini/commands/plan.md`**:
```markdown
---
description: "Creates a step-by-step implementation plan"
---

Your role is strategist only. Devise a comprehensive plan for: {{args}}

Do NOT write or execute code.

Return a markdown document with:
1. Understanding
2. Investigation  
3. Phased Approach
4. Verification
5. Risks
```

### Git Review Command
**`.gemini/commands/git/review.md`**:
```markdown
---
description: "Review git changes for quality and issues"
---

Please analyze the following git diff:

!{ git diff {{args}} }

Provide a comprehensive review covering:
1. Code quality and readability
2. Potential bugs or issues
3. Performance considerations
4. Security implications
5. Suggested improvements
```

## Built-in Commands

Gemini CLI includes comprehensive built-in commands:

### Core Session Commands
- `/help` - List all available commands
- `/clear` - Clear conversation history  
- `/quit` / `/exit` - Exit CLI session
- `/config` - View/modify configuration settings

### Memory Management
- `/memory add` - Add content to memory
- `/memory show` - Display current memory
- `/memory refresh` - Reload memory files

### Development Commands
- `/editor` - Open external editor for input
- `/copy` - Copy last response to clipboard
- `/bug` - Report a bug
- `/about` - Show CLI version info

## MCP Integration

### MCP Configuration
Gemini CLI uses `.gemini/settings.json` for MCP server configuration:

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
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxx"
      }
    }
  }
}
```

### MCP Server Types
- **STDIO Transport**: Local process communication
- **SSE Transport**: Server-Sent Events over HTTP  
- **HTTP Transport**: Plain HTTP endpoint communication

## Best Practices

### Memory Organization
1. **Single Root Rule**: Only one file should have `root: true`
2. **Focused Detail Rules**: Each memory file covers specific topics
3. **Clear References**: Use descriptive filenames for `@imports`
4. **Regular Maintenance**: Update memory as project evolves

### Command Design  
1. **Clear Purpose**: Each command should have single responsibility
2. **Descriptive Names**: Use intuitive command names
3. **Namespace Organization**: Group related commands in subdirectories
4. **Detailed Instructions**: Provide step-by-step guidance

### Content Guidelines
1. **Concise Memory**: Keep memory files focused and readable
2. **Actionable Commands**: Commands should provide clear outcomes
3. **Context Integration**: Use shell commands (`!{}`) for dynamic content
4. **Template Variables**: Use `{{args}}` for argument injection

## Advanced Features

### Shell Command Integration
Commands can execute shell commands and include output:

```markdown
---
description: "Review staged changes"
---

Please review the following staged changes:

!{ git diff --staged }

Provide feedback on:
1. Code quality
2. Potential issues  
3. Improvement suggestions
```

### Argument Injection
Commands support argument injection with `{{args}}`:

```markdown
---
description: "Generate unit tests for specified code"
---

Create comprehensive unit tests for: {{args}}

Current code:
!{ cat {{args}} }

Follow project testing conventions.
```

### Namespaced Commands
Organize commands using subdirectories:

```
.gemini/commands/
├── frontend/
│   ├── component.md     # /frontend:component
│   └── test.md          # /frontend:test
└── git/
    ├── commit.md        # /git:commit
    └── branch.md        # /git:branch
```

## Integration Benefits

### Development Workflow
- **Consistent Context**: Persistent project understanding
- **Custom Automation**: Project-specific command shortcuts
- **Team Standardization**: Shared memory and commands
- **Efficient Iteration**: Quick access to common tasks

### AI Enhancement
- **Project Awareness**: AI understands project conventions
- **Command Consistency**: Standardized task execution
- **Context Preservation**: Memory provides ongoing project context
- **Workflow Optimization**: Custom commands streamline development

## Troubleshooting

### Common Issues
1. **Memory Not Loaded**: Check file location and `@import` references
2. **Commands Not Available**: Verify command file format and naming
3. **Performance Issues**: Optimize memory file size and content
4. **Import Errors**: Check `@filename` references in main memory

### Debugging Steps
1. **Check Memory**: Use `/memory show` to verify loaded content
2. **List Commands**: Use `/help` to see available commands
3. **Refresh Memory**: Use `/memory refresh` to reload files
4. **Review Configuration**: Check `.gemini/settings.json` for errors

## Migration Strategies

### From Claude Code
1. **Import Existing**: Use rulesync import to convert Claude Code configuration
2. **Adapt Memory**: Convert CLAUDE.md format to GEMINI.md
3. **Update Commands**: Adapt slash commands for Gemini CLI syntax
4. **Test Integration**: Verify memory and commands work correctly

### From Other Tools
1. **Multi-Tool Import**: Import rules from various AI tools
2. **Memory Consolidation**: Combine rules into organized memory files
3. **Command Creation**: Create Gemini-specific custom commands
4. **Team Training**: Educate team on new workflow

## See Also

- [Custom Commands](../features/custom-commands.md) - Detailed command creation guide
- [MCP Integration](../features/mcp.md) - Model Context Protocol configuration
- [Configuration](../configuration.md) - General configuration options