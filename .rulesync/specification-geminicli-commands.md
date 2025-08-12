---
root: false
targets: ["*"]
description: "Gemini CLI custom slash commands configuration specification"
globs: []
---

# Gemini CLI Custom Slash Commands Configuration Specification

## Overview
Gemini CLI supports custom slash commands that allow developers to create reusable prompts and automation workflows. These commands extend the built-in functionality with project-specific or user-specific shortcuts for common development tasks.

## File Placement and Discovery

### Command File Locations
Custom slash commands are defined in TOML files located in specific directories:

#### 1. Global Commands (User-wide)
- **Location**: `~/.gemini/commands/`
- **Scope**: Available across all projects for the current user
- **Use case**: Personal development workflows and general-purpose commands

#### 2. Project Commands (Project-specific)
- **Location**: `<project-root>/.gemini/commands/`
- **Scope**: Available only within the current project
- **Use case**: Project-specific workflows and team-shared commands

### Auto-Discovery
- All TOML files in command directories are automatically discovered at startup
- Commands are loaded from both global and project directories
- Project commands can override global commands with the same name

## Command Naming and Namespacing

### File-to-Command Mapping
- **File name** (minus `.toml` extension) becomes the command name
- Example: `~/.gemini/commands/plan.toml` → `/plan` command

### Namespace Support
- **Subdirectories** create namespaces using colon (`:`) separator
- Example: `~/.gemini/commands/git/commit.toml` → `/git:commit` command
- Example: `~/.gemini/commands/k8s/deploy.toml` → `/k8s:deploy` command

### Naming Best Practices
- Use descriptive, memorable command names
- Employ namespaces for organizing related commands
- Avoid conflicts with built-in commands (they take precedence)

## TOML Configuration Format

### Schema Version 1
Each command file uses a simple TOML schema with the following fields:

#### Required Fields
- **prompt** (string): The text sent to the AI model when the command is invoked

#### Optional Fields
- **description** (string): One-line summary shown in `/help` output

### Basic Example
```toml
description = "Generate a step-by-step execution plan (no code)."

prompt = """
Your role is 'strategist'. Devise a comprehensive plan to achieve:
{{args}}

Rules:
1. You MUST NOT write or modify code.
2. Use available 'read' and 'search' tools to inspect the repo.
3. Output Markdown with these sections:
   - Understanding the Goal
   - Investigation & Analysis
   - Proposed Strategic Approach
   - Verification Strategy
   - Anticipated Challenges
"""
```

## Argument Handling

### Simple Argument Substitution
- **`{{args}}`**: Placeholder replaced by everything the user types after the command
- Arguments are passed as-is without parsing or validation
- Multiple argument placeholders are supported

### Example Usage
```bash
# Command definition with {{args}}
/plan Optimize the image processing pipeline for 2× speed

# {{args}} is replaced with:
# "Optimize the image processing pipeline for 2× speed"
```

### Shell Command Integration
- **`!{command}`**: Execute shell commands and inline the result into the prompt
- Runs through the integrated Shell tool
- Useful for dynamic context gathering

#### Shell Integration Example
```toml
description = "Analyze recent Git changes and suggest improvements"

prompt = """
Recent Git commits:
!{git log --oneline -10}

Current branch status:
!{git status --porcelain}

Based on the above Git information and these requirements:
{{args}}

Please analyze the changes and suggest improvements.
"""
```

## Built-in Commands Reference

### Memory Commands
- `/memory add <text>` - Store text in the model's hierarchical memory
- `/memory show` - Display current concatenated memory content
- `/memory refresh` - Reload all memory files

### Tool Commands
- `/tools` - List all registered tools
- `/tools desc` - Show tool descriptions
- `/tools nodesc` - Hide tool descriptions

### Help System
- `/help` or `/?` - Show all available commands with descriptions

## Command Examples

### Development Planning Command
```toml
# File: ~/.gemini/commands/plan.toml
description = "Generate a step-by-step execution plan (no code)."

prompt = """
Your role is 'strategist'. Devise a comprehensive plan to achieve:
{{args}}

Rules:
1. You MUST NOT write or modify code.
2. Use available 'read' and 'search' tools to inspect the repo.
3. Output Markdown with these sections:
   - Understanding the Goal
   - Investigation & Analysis
   - Proposed Strategic Approach
   - Verification Strategy
   - Anticipated Challenges
"""
```

### Git Analysis Command
```toml
# File: ~/.gemini/commands/git/analyze.toml
description = "Analyze Git repository history and suggest improvements"

prompt = """
Git Repository Analysis
======================

Recent commits:
!{git log --oneline -20}

Branch information:
!{git branch -v}

Current status:
!{git status}

Please analyze the repository state focusing on:
{{args}}

Provide insights on:
1. Commit patterns and quality
2. Branch management
3. Potential issues or improvements
4. Recommended next steps
"""
```

### Code Review Command
```toml
# File: .gemini/commands/review.toml
description = "Perform code review on recent changes"

prompt = """
Code Review Request
==================

Recent changes:
!{git diff HEAD~1..HEAD}

Files modified:
!{git diff --name-only HEAD~1..HEAD}

Please review these changes focusing on:
{{args}}

Review criteria:
1. Code quality and style
2. Security considerations
3. Performance implications
4. Maintainability
5. Testing coverage
"""
```

### Testing Command
```toml
# File: .gemini/commands/test/strategy.toml
description = "Generate testing strategy for specified components"

prompt = """
Testing Strategy Generation
===========================

Project structure:
!{find . -name "*.ts" -o -name "*.js" -o -name "*.py" | head -20}

Test files found:
!{find . -name "*test*" -o -name "*spec*" | head -10}

Generate a comprehensive testing strategy for:
{{args}}

Include:
1. Unit test recommendations
2. Integration test scenarios
3. End-to-end test cases
4. Performance test considerations
5. Mock/stub strategies
"""
```

### Documentation Command
```toml
# File: .gemini/commands/docs/generate.toml
description = "Generate documentation for specified code"

prompt = """
Documentation Generation
=======================

Target code or component: {{args}}

Please generate comprehensive documentation including:

1. Overview and purpose
2. API documentation (if applicable)
3. Usage examples
4. Configuration options
5. Troubleshooting guide

Format the output as clear, well-structured Markdown suitable for inclusion in project documentation.
"""
```

## Advanced Features

### Multi-line Prompts
Use triple quotes for complex, multi-line prompts:

```toml
prompt = """
This is a multi-line prompt
that can span several lines
and include {{args}} substitution.

It preserves formatting and
can include shell commands: !{date}
"""
```

### Environment-Specific Commands
Create commands that adapt to different environments:

```toml
# File: .gemini/commands/deploy/staging.toml
description = "Deploy to staging environment"

prompt = """
Staging Deployment
==================

Current branch:
!{git branch --show-current}

Last commit:
!{git log -1 --oneline}

Deployment target: {{args}}

Please generate deployment commands for staging environment:
1. Pre-deployment checks
2. Build commands
3. Deployment steps
4. Post-deployment verification
5. Rollback procedures if needed
"""
```

### Context-Aware Commands
Commands that gather context automatically:

```toml
# File: .gemini/commands/debug.toml
description = "Debug analysis with automatic context gathering"

prompt = """
Debug Analysis
==============

Current directory: !{pwd}
Modified files: !{git diff --name-only}
Recent errors: !{tail -20 *.log 2>/dev/null || echo "No log files found"}

Debug target: {{args}}

Please analyze and provide debugging assistance:
1. Identify potential issues
2. Suggest investigation steps
3. Recommend fixes
4. Provide monitoring commands
"""
```

## Management and Discovery

### Command Discovery
- Use `/help` to list all available commands
- Commands are automatically categorized by namespace
- Global and project commands are merged in the help display

### Conflict Resolution
- Built-in commands take precedence over custom commands
- Project commands override global commands with the same name
- Use unique names to avoid conflicts

### Reload Commands
- Restart Gemini CLI to reload command definitions
- Changes to TOML files require CLI restart
- Use version control to track command changes

## Best Practices

### Command Design
1. **Single Purpose**: Each command should focus on one specific task
2. **Clear Names**: Use descriptive, memorable command names
3. **Good Documentation**: Always include meaningful descriptions
4. **Argument Usage**: Make effective use of `{{args}}` for flexibility

### Prompt Engineering
1. **Clear Instructions**: Provide specific, unambiguous instructions
2. **Context Integration**: Use shell commands to gather relevant context
3. **Output Format**: Specify desired output format (Markdown, JSON, etc.)
4. **Error Handling**: Include guidance for edge cases

### Team Collaboration
1. **Version Control**: Commit project commands to repository
2. **Documentation**: Document command purposes and usage
3. **Naming Conventions**: Establish team standards for command naming
4. **Testing**: Test commands with various argument types

### Security Considerations
1. **Shell Commands**: Be cautious with shell command execution
2. **Sensitive Data**: Avoid exposing sensitive information in prompts
3. **Validation**: Consider argument validation in prompt instructions
4. **Permissions**: Ensure commands don't expose restricted information

## Integration with Development Workflow

### CI/CD Integration
Create commands for continuous integration tasks:

```toml
# File: .gemini/commands/ci/check.toml
description = "Pre-commit checks and validation"

prompt = """
Pre-commit Validation
====================

Modified files: !{git diff --cached --name-only}
Lint status: !{npm run lint 2>&1 || echo "Lint check failed"}
Test status: !{npm test 2>&1 | tail -10 || echo "Tests failed"}

Please review the changes for: {{args}}

Provide:
1. Code quality assessment
2. Test coverage analysis
3. Deployment readiness
4. Risk assessment
"""
```

### Code Quality Commands
```toml
# File: .gemini/commands/quality/analyze.toml
description = "Analyze code quality and suggest improvements"

prompt = """
Code Quality Analysis
====================

File analysis target: {{args}}

Current metrics:
!{find . -name "*.ts" -o -name "*.js" | xargs wc -l | tail -1}

Please analyze code quality focusing on:
1. Maintainability
2. Readability
3. Performance patterns
4. Security considerations
5. Technical debt identification
"""
```

## Troubleshooting

### Common Issues
1. **Command Not Found**: Check file placement and naming
2. **Arguments Not Working**: Verify `{{args}}` placeholder usage
3. **Shell Commands Failing**: Test shell commands independently
4. **Conflicts**: Ensure unique command names

### Debugging Commands
- Use `/help` to verify command registration
- Test shell commands with `!{command}` syntax separately
- Check TOML syntax for parsing errors
- Verify file permissions in command directories

This specification provides comprehensive guidance for creating and managing custom slash commands in Gemini CLI, enabling powerful automation and workflow customization for development teams.