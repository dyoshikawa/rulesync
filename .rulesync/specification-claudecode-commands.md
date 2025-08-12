---
root: false
targets: ["*"]
description: "Claude Code custom slash commands specification"
globs: []
---

# Claude Code Custom Slash Commands Specification

## Overview
Claude Code supports custom slash commands that allow you to create reusable, parameterized prompts. These commands are single Markdown files whose filename becomes the command name, providing a powerful way to automate common development tasks and maintain consistent workflows.

## File Placement and Scopes

### Project-Wide Commands (Shared with Team)
- **Location**: `.claude/commands/your-command.md`
- **Visibility**: Shows "(project)" in `/help`
- **Scope**: Available to all team members who clone the repository
- **Version Control**: Should be committed to repository

### Personal Commands (User-Only)
- **Location**: `~/.claude/commands/your-command.md`
- **Visibility**: Shows "(user)" in `/help`
- **Scope**: Only visible to current user across all projects
- **Version Control**: Not shared with team

## Basic Command Structure

### File Naming Convention
- **Command Name**: Filename without `.md` extension becomes the command name
- **Examples**:
  - `optimize.md` → `/optimize`
  - `fix-issue.md` → `/fix-issue`
  - `create-component.md` → `/create-component`

### Command Invocation Syntax
```
/<command-name> [arguments]
```

Examples:
```
/optimize
/fix-issue 123
/create-component UserProfile
```

## Command File Format

### Basic Markdown Structure
```markdown
This is the prompt content that will be sent to Claude when the command is invoked.

You can include any Markdown content here, including:
- Lists and formatting
- Code examples
- Specific instructions
```

### YAML Front-matter (Optional)
```markdown
---
allowed-tools: [Bash(git:*), Edit, Read]
argument-hint: [issue-number]
description: Fix the specified GitHub issue following coding standards
model: sonnet
---

Fix issue #$ARGUMENTS by following our coding standards and writing appropriate tests.
```

## Dynamic Content Features

### 1. Arguments Substitution
Use `$ARGUMENTS` placeholder to inject user-provided arguments:

```markdown
---
argument-hint: <component-name>
description: Create a new React component with TypeScript
---

Create a new React component called "$ARGUMENTS" with the following requirements:
- Use TypeScript with proper interfaces
- Include unit tests
- Follow our component structure guidelines
```

**Usage**: `/create-component UserProfile` → `$ARGUMENTS` becomes `UserProfile`

### 2. Shell Command Injection
Execute shell commands and inject their output using `!` syntax:

```markdown
---
allowed-tools: [Bash(git:*)]
---

Current git status:
!`git status --short`

Based on the current changes, suggest the next development steps.
```

### 3. File Content Injection
Include file contents using `@` syntax:

```markdown
Review the following code for potential improvements:

@src/components/UserProfile.tsx

Focus on performance optimization and accessibility.
```

### 4. Extended Thinking Keywords
Trigger longer reasoning phases for complex tasks:

```markdown
---
description: Perform architectural analysis with extended thinking
---

<extended-thinking>
Analyze the current architecture and provide comprehensive recommendations.
</extended-thinking>

Review the project structure and suggest architectural improvements.
```

## Front-matter Configuration Options

### Core Fields
- **allowed-tools**: Restrict which tools the command can use
- **argument-hint**: Usage hint shown in autocompleter
- **description**: One-line description (defaults to first line of prompt)
- **model**: Override default model (opus, sonnet, haiku, or exact model string)

### Example Front-matter Configurations

#### Git Workflow Command
```markdown
---
allowed-tools: [Bash(git add:*), Bash(git status:*), Bash(git commit:*)]
argument-hint: [commit-message]
description: Create a git commit with proper formatting
model: haiku
---

Create a commit with the message "$ARGUMENTS":
1. Stage all appropriate changes
2. Create descriptive commit message
3. Ensure no secrets are committed
```

#### Code Review Command
```markdown
---
allowed-tools: [Read, Glob, Grep]
description: Perform comprehensive code review
model: opus
---

Perform a thorough code review focusing on:
- Code quality and best practices
- Security vulnerabilities
- Performance implications
- Test coverage
```

#### Database Migration Command
```markdown
---
allowed-tools: [Bash(npm run:*), Edit, Read]
argument-hint: [migration-name]
description: Create and run database migration
---

Create a database migration named "$ARGUMENTS":
1. Generate migration file with proper naming
2. Write up and down migration scripts
3. Update schema documentation
4. Run migration in development environment
```

## Advanced Features

### Namespacing with Subdirectories
Organize commands in subdirectories to create namespaced commands:

```
.claude/commands/
├── frontend/
│   ├── component.md     → /frontend:component
│   └── test.md          → /frontend:test
├── backend/
│   ├── api.md           → /backend:api
│   └── migration.md     → /backend:migration
└── deploy.md            → /deploy
```

### Multiple Argument Handling
Commands can accept multiple words and complex arguments:

```markdown
---
argument-hint: <feature-description>
description: Create feature with full test coverage
---

Implement the following feature: "$ARGUMENTS"

Requirements:
- Write comprehensive tests first (TDD approach)
- Follow existing code patterns
- Update documentation
- Add appropriate error handling
```

**Usage**: `/create-feature user authentication with JWT tokens`

### Conditional Logic in Commands
Use argument content for conditional behavior:

```markdown
---
argument-hint: [environment]
description: Deploy to specified environment
---

Deploy to the "$ARGUMENTS" environment:

!`if [ "$ARGUMENTS" = "production" ]; then echo "⚠️  PRODUCTION DEPLOYMENT"; else echo "Development deployment"; fi`

Follow the deployment checklist for this environment.
```

## Security Considerations

### Tool Restrictions
Use `allowed-tools` to limit command capabilities:

```markdown
---
allowed-tools: [Read, Glob, Grep]  # Read-only operations
description: Safe code analysis command
---

Analyze the codebase for potential issues (read-only analysis).
```

### Sensitive Operations
For commands that perform sensitive operations:

```markdown
---
allowed-tools: [Bash(git push:*), Bash(npm publish:*)]
description: Deploy to production (requires confirmation)
---

⚠️  **PRODUCTION DEPLOYMENT** ⚠️

This command will deploy to production. Confirm you want to proceed.

Steps:
1. Run full test suite
2. Build production assets
3. Deploy to production servers
4. Verify deployment success
```

## Common Command Patterns

### Development Workflow Commands

#### Feature Creation
```markdown
---
argument-hint: <feature-name>
description: Create new feature with full scaffolding
allowed-tools: [Edit, Bash(mkdir:*), Bash(npm:*)]
---

Create a new feature: "$ARGUMENTS"

1. Create feature directory structure
2. Generate component files with TypeScript
3. Create test files with proper setup
4. Update routing configuration
5. Add to documentation index
```

#### Bug Fix Workflow
```markdown
---
argument-hint: <issue-number>
description: Structured approach to fixing GitHub issues
allowed-tools: [Bash(git:*), Read, Edit, Bash(npm run test:*)]
---

Fix GitHub issue #$ARGUMENTS:

1. Create feature branch: `git checkout -b fix-issue-$ARGUMENTS`
2. Analyze the issue and reproduce the problem
3. Write failing tests that demonstrate the issue
4. Implement the fix
5. Ensure all tests pass
6. Update documentation if needed
7. Create pull request with proper description
```

### Code Quality Commands

#### Code Review Automation
```markdown
---
description: Comprehensive automated code review
allowed-tools: [Read, Glob, Grep, Bash(npm run lint:*)]
model: opus
---

Perform comprehensive code review:

1. Check code style and formatting
2. Analyze for security vulnerabilities
3. Review test coverage
4. Check for performance issues
5. Validate documentation completeness
6. Suggest improvements and refactoring opportunities
```

#### Dependency Audit
```markdown
---
description: Audit project dependencies for security and updates
allowed-tools: [Bash(npm audit:*), Read]
---

Audit project dependencies:

Current package.json:
@package.json

!`npm audit --audit-level=moderate`

Review audit results and provide recommendations for:
- Security vulnerability fixes
- Package updates
- Dependency optimization
```

### Testing Commands

#### Test Generation
```markdown
---
argument-hint: <component-path>
description: Generate comprehensive tests for component
allowed-tools: [Read, Edit, Bash(npm run test:*)]
---

Generate tests for component: $ARGUMENTS

Component code:
@$ARGUMENTS

Create comprehensive tests covering:
- Unit tests for all functions
- Integration tests for component interactions
- Edge cases and error handling
- Accessibility testing
```

#### Test Coverage Analysis
```markdown
---
description: Analyze test coverage and suggest improvements
allowed-tools: [Bash(npm run test:*), Read]
---

Analyze test coverage:

!`npm run test:coverage`

Based on coverage report, suggest:
- Areas needing additional test coverage
- Types of tests to add (unit, integration, e2e)
- Critical paths that must be tested
- Testing best practices for this codebase
```

## Command Discovery and Management

### Listing Available Commands
```bash
/help    # Shows all built-in and custom commands
```

### Testing Commands
Create and test commands iteratively:

```bash
# 1. Create command file
echo 'Analyze code quality and suggest improvements' > .claude/commands/analyze.md

# 2. Test the command
/analyze

# 3. Refine based on results
```

### Command Documentation
Document complex commands within the command file:

```markdown
---
description: Complex deployment workflow
---

<!-- 
This command handles production deployment with the following steps:
1. Runs full test suite
2. Builds production assets  
3. Deploys to staging for verification
4. Promotes to production after confirmation
5. Runs post-deployment health checks

Usage: /deploy [environment]
Examples: 
  /deploy staging
  /deploy production
-->

Deploy to $ARGUMENTS environment with full verification workflow.
```

## Best Practices

### Command Design
1. **Single Responsibility**: Each command should have one clear purpose
2. **Descriptive Names**: Use clear, action-oriented command names
3. **Argument Validation**: Consider argument validation in command logic
4. **Error Handling**: Include appropriate error handling instructions

### Security
1. **Minimal Permissions**: Use `allowed-tools` to restrict command capabilities
2. **Sensitive Operations**: Add confirmation steps for dangerous operations
3. **Secret Management**: Never include secrets in command files
4. **Tool Restrictions**: Be specific about which tools commands can access

### Team Collaboration
1. **Documentation**: Include clear descriptions and usage examples
2. **Consistency**: Follow team conventions for command naming and structure
3. **Version Control**: Commit project commands for team sharing
4. **Regular Review**: Periodically review and update command effectiveness

### Maintenance
1. **Regular Updates**: Keep commands current with project evolution
2. **Performance**: Monitor command execution time and optimize as needed
3. **Tool Evolution**: Update commands when new Claude Code features become available
4. **Feedback Loop**: Collect team feedback on command usefulness and accuracy

## Troubleshooting

### Common Issues

#### Command Not Found
- Check filename and location
- Ensure `.md` extension is present
- Verify command appears in `/help`

#### Arguments Not Substituting
- Verify `$ARGUMENTS` placeholder is correct
- Check for typos in variable name
- Ensure arguments are provided when invoking command

#### Permission Errors
- Review `allowed-tools` configuration
- Check if required tools are permitted by project settings
- Verify tool syntax matches Claude Code conventions

#### Front-matter Parsing Issues
- Validate YAML syntax
- Ensure proper `---` delimiters
- Check for indentation issues

### Debugging Commands
```bash
/help                    # List all available commands
/config                  # View current configuration
/doctor                  # Diagnose configuration issues
```

This specification provides comprehensive guidance for creating and managing custom slash commands in Claude Code, enabling teams to automate workflows, maintain consistency, and improve development efficiency through reusable, parameterized prompts.