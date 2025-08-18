---
root: false
targets: ["*"]
description: "OpenCode AI assistant rules and memory configuration using AGENTS.md and opencode.json files"
globs: []
---

# OpenCode Rules and Memory Configuration Specification

## Overview
OpenCode is an AI coding agent built for the terminal that uses a rule-based system to provide persistent context and project-specific instructions. The configuration system is based on markdown files and JSON configuration files.

## File Placement and Hierarchy

### 1. Project-Level Rules (AGENTS.md)

#### Primary Location
- **File**: `AGENTS.md` 
- **Location**: Repository root or any parent directory
- **Scope**: Project-specific rules applied to all AI interactions
- **Version Control**: Should be committed for team consistency

#### Discovery Mechanism
- OpenCode searches upward from current working directory
- Uses the first `AGENTS.md` file found in directory traversal
- Stops at repository root or filesystem root

### 2. Global Rules (User-Level)

#### Location
- **File**: `~/.config/opencode/AGENTS.md`
- **Scope**: Personal preferences applied across all projects
- **Usage**: User-specific conventions not committed to repositories

### 3. Additional Instruction Files

#### Configuration via opencode.json
Additional instruction files can be referenced through the `instructions` array:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": [
    "CONTRIBUTING.md",
    "docs/*-guidelines.md",
    ".cursor/rules/*.md"
  ]
}
```

#### Processing Order
1. Project `AGENTS.md` (if found)
2. Global `~/.config/opencode/AGENTS.md` (if exists)
3. Files specified in `instructions` array (concatenated)

## File Format

### AGENTS.md Structure
- **Format**: Plain Markdown
- **Size Recommendation**: Keep under 4-5 KB to preserve LLM context
- **Content**: Entire file becomes part of AI context

### Content Organization
```markdown
# Project Name Rules

## Project Overview
Brief elevator pitch of what this repo does and the tech stack.

## Coding Conventions
* TypeScript strict mode, ES2022 syntax
* Prefer zod for schema validation
* Run `pnpm format` before every commit

## Directory Glossary
- `apps/…` — front-end Next.js apps
- `packages/…` — shared libs (import as `@my-app/<pkg>`)

## AI Guard-rails
* Never change code under `packages/generated/**`
* Ask before running shell commands that modify prod data
```

## Configuration File (opencode.json)

### File Locations
1. **Global**: `~/.config/opencode/opencode.json`
2. **Per Project**: `opencode.json` in project root
3. **Custom Path**: Set via `OPENCODE_CONFIG` environment variable

### Configuration Schema
```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": [
    "CONTRIBUTING.md",
    "docs/*-guidelines.md"
  ],
  "provider": "openai",
  "model": "gpt-4",
  "small_model": "gpt-3.5-turbo",
  "theme": "default",
  "permission": {
    "write": "ask",
    "run": "ask"
  }
}
```

### Configuration Fields
- **instructions**: Array of file patterns to include as context
- **provider**: AI provider configuration
- **model**: Primary model for complex tasks
- **small_model**: Lightweight model for simple operations
- **theme**: UI theme settings
- **permission**: Operation approval controls

### Variable Substitution
- **Environment Variables**: `{env:VARIABLE_NAME}`
- **File Contents**: `{file:path/to/file}`

## Built-in Commands

### Initialization
- **`/init`**: Auto-generate starter `AGENTS.md` file
- **`/edit-agents`**: Open current rules in `$EDITOR`
- **`/where-rules`**: Show which rules are active and merge order

### Management Commands
- **`/new`**: Start new session (alias: `/clear`)
- **`/sessions`**: List and switch between sessions
- **`/compact`**: Compact current session (alias: `/summarize`)

## Advanced Features

### Lazy Loading Pattern
```markdown
## External File Loading
CRITICAL: When you see a reference like @rules/api-standards.md,
use the Read tool to load it only if it's relevant to the current task.
```

This pattern keeps context small and speeds up responses.

### Glob Pattern Support
The `instructions` array supports glob patterns for automatic file discovery:

```json
{
  "instructions": [
    "docs/**/*.md",
    ".cursor/rules/*.md",
    "packages/*/README.md"
  ]
}
```

## Best Practices

### Content Guidelines
1. **Be Concise**: Keep rules under 4-5 KB total
2. **Specific Examples**: Include concrete code patterns
3. **Security First**: Define guard-rails for sensitive operations
4. **Clear Structure**: Use headers and bullet points

### File Organization
1. **Project Rules**: Commit `AGENTS.md` for team consistency
2. **Global Rules**: Use for personal preferences only
3. **Modular Rules**: Use `instructions` array for large rule sets
4. **Version Control**: Include rule changes in PR reviews

### Performance Optimization
1. **Context Management**: Monitor total context size
2. **Lazy Loading**: Load additional files only when needed
3. **Focused Rules**: Keep rules relevant to current project
4. **Regular Review**: Update rules as project evolves

## Integration with Development Workflow

### Team Collaboration
1. **Shared Standards**: Commit `AGENTS.md` to repository
2. **Documentation**: Document rule purposes and exceptions
3. **Review Process**: Include rule changes in code reviews
4. **Onboarding**: Use rules to onboard new team members

### Project Lifecycle
1. **Project Setup**: Create `AGENTS.md` early in development
2. **Evolution**: Update rules as project grows
3. **Maintenance**: Regular review and cleanup
4. **Migration**: Use `instructions` array for gradual migration

## CLI Integration

### Command-Line Usage
```bash
# Start in current directory
opencode

# Start in specific directory
opencode -c /path/to/project

# Generate rules file
opencode
> /init

# Edit current rules
opencode
> /edit-agents
```

### Non-Interactive Mode
```bash
# Direct prompt execution
opencode "Analyze the codebase structure"

# Scripting support
echo "Review security patterns" | opencode
```

## Troubleshooting

### Common Issues
1. **Rules Not Applied**: Check file location and name
2. **Context Overflow**: Reduce total rule size
3. **Conflicting Rules**: Review merge order and precedence
4. **Performance Issues**: Optimize rule content length

### Debugging Steps
1. **Check Discovery**: Use `/where-rules` to verify active rules
2. **Validate Syntax**: Ensure proper Markdown formatting
3. **Test Incrementally**: Add rules gradually
4. **Monitor Context**: Watch for context size warnings

## Security Considerations

### Best Practices
1. **No Secrets**: Never include API keys or passwords in rules
2. **Guard-rails**: Define clear boundaries for AI operations
3. **File Access**: Specify allowed/forbidden file patterns
4. **Command Restrictions**: Define safe command patterns

### Example Security Rules
```markdown
## Security Guard-rails
* Never modify files in `secrets/` or `.env*`
* Ask before running `rm`, `mv`, or destructive commands
* Don't commit API keys or credentials
* Validate all user inputs in generated code
```

## Summary

OpenCode's rule system provides comprehensive project context through:

- **Hierarchical Configuration**: Project and global rules with clear precedence
- **Flexible File Inclusion**: Support for additional instruction files
- **CLI Integration**: Built-in commands for rule management
- **Performance Optimization**: Context-aware loading and lazy evaluation
- **Team Collaboration**: Version-controlled project rules
- **Security Features**: Guard-rails and permission controls

The system balances flexibility with simplicity, enabling effective AI-assisted development workflows while maintaining security and performance.