---
root: false
targets: ["*"]
description: "Roo Code custom slash commands specification"
globs: []
---

# Roo Code Custom Slash Commands Specification

## Overview
Roo Code supports custom slash commands through Markdown files that can be placed in specific directories. These commands become available as reusable prompts that can be invoked with `/command-name` syntax.

## File Placement and Scope

### Project-Scoped Commands
- **Directory**: `.roo/commands/`
- **Location**: Project root directory
- **Visibility**: Committed to repository, shared with team
- **Version Control**: Checked into VCS for team consistency

### User-Scoped Commands
- **Directory**: `~/.roo/commands/`
- **Location**: User's home directory
- **Visibility**: Available across all projects for current user
- **Personal Use**: User-specific commands and preferences

### Command Discovery
- Commands are automatically discovered from both directories
- Project files override global commands with same name
- No restart required after adding new command files

## File Format

### Basic Structure
- **Format**: Markdown files (`.md` extension)
- **Naming**: Filename (minus `.md`) becomes command name
- **Content**: Markdown content becomes the prompt sent to the AI

### YAML Front Matter (Optional)
Commands can include YAML configuration at the top of the file:

```yaml
---
description: One-line summary shown in the "/" menu
argument-hint: <arg1> <arg2>      # optional; shown as grey hint
---
```

#### Front Matter Fields
- **description**: Help text shown in command picker (required for good UX)
- **argument-hint**: Autocomplete guidance for command arguments (optional)

## Command Naming and Slugification

### Filename to Command Mapping
```
<name>.md → /<name>
```

### Slugification Rules
Roo Code automatically transforms filenames:
- Convert to lowercase
- Replace spaces with dashes
- Remove special characters
- Trim leading/trailing dashes

### Examples
```
"Deploy Check!.md" → /deploy-check
"Code Review.md" → /code-review
"Generate README.md" → /generate-readme
```

## Command Invocation

### Basic Syntax
```
/command-name [arguments]
```

### Argument Handling
- If `argument-hint` is present, hint appears in command picker
- Selecting command inserts `/command ` (with trailing space)
- User types actual arguments after the command
- Arguments are passed to LLM exactly after the prompt body

### Discovery and Execution
- Press `/` to open unified picker (custom + mode-switch commands)
- Fuzzy search and autocomplete supported
- Description shown under each entry
- Mode commands have special icon

## Example Command Files

### Basic Code Review Command
```markdown
---
description: Comprehensive security + performance code review
argument-hint: <file-or-directory>
---

# Security-First Code Review

Please perform a thorough review of the selected target focusing on:

1. **Authentication & Authorization**
   - Proper access controls
   - Token validation
2. **Input Validation**
   - Injection points
   - Data sanitization
3. **Performance**
   - N² or worse algorithms
   - Unnecessary DB queries
   - Memory leaks
4. **Other Issues**
   - Hard-coded secrets
   - Error-message leakage
```

### Documentation Generator
```markdown
---
description: Generate comprehensive README documentation
argument-hint: <project-directory>
---

# README Generator

Create a comprehensive README.md file for the specified project including:

## Required Sections
1. **Project Overview**: Clear description of purpose and functionality
2. **Installation Instructions**: Step-by-step setup guide
3. **Usage Examples**: Code examples and common use cases
4. **API Documentation**: If applicable, document all endpoints/methods
5. **Contributing Guidelines**: How others can contribute
6. **License Information**: Appropriate license details

## Format Requirements
- Use clear markdown formatting
- Include code examples with syntax highlighting
- Add badges for build status, version, etc.
- Ensure all links are functional
```

### Performance Analysis Command
```markdown
---
description: Analyze code for performance bottlenecks
argument-hint: <file-or-function>
---

# Performance Analysis

Analyze the specified code for performance issues:

## Analysis Areas
1. **Algorithm Complexity**
   - Time complexity analysis
   - Space complexity review
   - Identify inefficient loops or recursion

2. **Database Operations**
   - Query optimization opportunities
   - N+1 query problems
   - Index usage analysis

3. **Memory Usage**
   - Memory leak detection
   - Unnecessary object allocation
   - Garbage collection impact

4. **Recommendations**
   - Specific optimization suggestions
   - Alternative algorithms or approaches
   - Profiling recommendations
```

### Database Migration Helper
```markdown
---
description: Generate database migration scripts
argument-hint: <migration-description>
---

# Database Migration Generator

Create a database migration script for the specified changes:

## Requirements
1. **Migration Structure**
   - Up migration (apply changes)
   - Down migration (rollback changes)
   - Proper error handling

2. **Best Practices**
   - Use transactions where appropriate
   - Include data validation
   - Handle edge cases and constraints

3. **Documentation**
   - Clear comments explaining changes
   - Rollback instructions
   - Testing recommendations

Please specify the database type and migration framework being used.
```

## Recommended Directory Structure

### Team Projects
```
.roo/
└── commands/
    ├── code-quality/
    │   ├── review.md
    │   ├── performance-analyze.md
    │   └── security-audit.md
    ├── docs/
    │   ├── readme-generator.md
    │   ├── api-docs.md
    │   └── changelog.md
    ├── database/
    │   ├── migration.md
    │   └── schema-review.md
    └── deploy/
        ├── deploy-check.md
        └── rollback-plan.md
```

### Personal Commands
```
~/.roo/commands/
├── personal-templates/
│   ├── commit-message.md
│   └── branch-naming.md
├── learning/
│   ├── explain-concept.md
│   └── code-examples.md
└── utilities/
    ├── file-organizer.md
    └── dependency-updater.md
```

## Best Practices

### Command Design
1. **Clear Names**: Use action-oriented verbs (`generate-readme`, `migrate-db`)
2. **Single Focus**: Keep each command focused on one task
3. **Structured Prompts**: Use lists or sections for clarity
4. **Team Sharing**: Store shared commands in repository

### Content Guidelines
1. **Specific Instructions**: Provide clear, actionable prompts
2. **Examples**: Include code examples where helpful
3. **Context**: Add relevant context and constraints
4. **Format**: Use markdown formatting for readability

### Version Control
1. **Team Commands**: Commit `.roo/commands/` to repository
2. **Personal Commands**: Keep `~/.roo/commands/` in personal dotfiles
3. **Documentation**: Document command usage in project README
4. **Change Management**: Review command changes in pull requests

## Troubleshooting

### Common Issues
1. **Command Not Found**: Check file location and naming
2. **No Description**: Commands appear better with description in front matter
3. **Naming Conflicts**: Project commands override global commands
4. **Cache Issues**: Reload VS Code or run "Reload Commands" if new files don't appear

### Debugging Steps
1. **File Location**: Verify files are in correct directories
2. **File Extension**: Ensure files have `.md` extension
3. **Syntax Check**: Validate YAML front matter syntax
4. **Reload**: Restart VS Code or reload commands

### Performance Optimization
1. **Command Count**: Limit number of commands for better picker performance
2. **File Size**: Keep command files reasonably sized
3. **Organization**: Use subdirectories to organize related commands
4. **Naming**: Use clear, searchable command names

## Integration with Development Workflow

### Code Review Process
```markdown
---
description: Pre-commit code review checklist
---

# Pre-Commit Review

Before committing, verify:

1. ✅ Code follows project style guidelines
2. ✅ All tests pass
3. ✅ No sensitive data committed
4. ✅ Documentation updated if needed
5. ✅ Performance impact considered
```

### CI/CD Integration
```markdown
---
description: Generate CI/CD pipeline configuration
argument-hint: <project-type>
---

# CI/CD Pipeline Generator

Create a CI/CD configuration for the specified project type:

## Pipeline Stages
1. **Build**: Compilation and dependency installation
2. **Test**: Unit tests, integration tests, linting
3. **Security**: Vulnerability scanning, secret detection
4. **Deploy**: Staging and production deployment
5. **Monitor**: Health checks and alerting

Include environment-specific configurations and rollback strategies.
```

This specification provides comprehensive guidance for creating and managing custom slash commands in Roo Code, enabling powerful automation and workflow enhancement capabilities.