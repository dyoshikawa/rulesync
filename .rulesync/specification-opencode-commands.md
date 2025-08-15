---
root: false
targets: ["*"]
description: "SST OpenCode custom slash commands and CLI command specifications for creating reusable prompts and automation"
globs: []
---

# SST OpenCode Custom Commands and CLI Specification

## Overview
SST OpenCode supports custom slash commands that allow users to create reusable prompts and automate common tasks. The system includes both built-in slash commands and user-defined custom commands stored as Markdown files.

## Custom Command System

### 1. Command Storage Locations

#### Directory Structure
Custom commands are stored as Markdown files in three possible locations:

1. **Project-Specific Commands**
   - **Location**: `.opencode/commands/`
   - **Scope**: Available only within the current project
   - **Version Control**: Should be committed for team sharing

2. **Global User Commands**
   - **Location**: `~/.config/opencode/commands/`
   - **Scope**: Available across all projects for the current user
   - **Usage**: Personal commands and preferences

3. **Additional Location**
   - **Location**: Custom path as configured in CLI documentation
   - **Scope**: Flexible command organization

#### File Naming Convention
- **Format**: Each `.md` file becomes a custom command
- **Command ID**: Filename without extension becomes the command identifier
- **Example**: `deploy-check.md` → `/deploy-check` command

### 2. Command File Format

#### Basic Structure
```markdown
# Command Name

Command description and instructions for the AI.

## Usage
Explain how to use this command.

## Examples
Provide examples of expected usage.
```

#### Named Arguments Support
OpenCode supports named arguments using placeholder syntax:

```markdown
# Fetch Context for Issue $ISSUE_NUMBER

RUN gh issue view $ISSUE_NUMBER --json title,body,comments
RUN git grep --author="$AUTHOR_NAME" -n .
RUN grep -R "$SEARCH_PATTERN" $DIRECTORY
```

#### Argument Format
- **Syntax**: `$NAME` where NAME consists of uppercase letters, numbers, and underscores
- **Requirements**: Must start with a letter
- **Behavior**: OpenCode prompts user for values when command is executed
- **Examples**: `$ISSUE_NUMBER`, `$AUTHOR_NAME`, `$SEARCH_PATTERN`

### 3. Command Examples

#### Simple Command Without Arguments
```markdown
# Code Review Checklist

Perform a comprehensive code review focusing on:

1. **Code Quality**
   - Readability and maintainability
   - Adherence to project standards
   - Performance considerations

2. **Security**
   - Input validation
   - Authentication/authorization
   - Potential vulnerabilities

3. **Testing**
   - Test coverage
   - Edge case handling
   - Test quality assessment

Provide specific suggestions with code examples.
```

#### Command With Named Arguments
```markdown
# Generate Documentation for $MODULE_NAME

Create comprehensive documentation for the $MODULE_NAME module:

## Requirements
1. **API Documentation**
   - Function signatures and parameters
   - Return values and types
   - Usage examples

2. **Architecture Overview**
   - Module purpose and responsibilities
   - Dependencies and relationships
   - Integration points

3. **Usage Guide**
   - Installation instructions
   - Configuration options
   - Common use cases

Focus on module: $MODULE_NAME
Documentation style: $DOC_STYLE
```

#### Multi-Step Command
```markdown
# Deploy Preparation for $ENVIRONMENT

Prepare deployment for $ENVIRONMENT environment:

## Pre-deployment Checks
1. Run tests: `npm test`
2. Build application: `npm run build`
3. Check environment variables for $ENVIRONMENT
4. Verify database migrations

## Security Validation
1. Scan for secrets in codebase
2. Check dependency vulnerabilities
3. Validate SSL certificates
4. Review access controls

## Deployment Steps
1. Create deployment branch
2. Update version numbers
3. Generate deployment artifacts
4. Prepare rollback plan

Target environment: $ENVIRONMENT
Deployment type: $DEPLOYMENT_TYPE
```

## Built-in Slash Commands

### 1. Session Management Commands

#### Basic Session Operations
- **`/help`**: Show help dialog with available commands
- **`/new`**: Start a new session (alias: `/clear`)
- **`/sessions`**: List and switch between sessions (aliases: `/resume`, `/continue`)
- **`/compact`**: Compact the current session (alias: `/summarize`)

#### Data Export and Sharing
- **`/export`**: Export conversation to Markdown format
- **`/share`**: Share current session with others

### 2. Development Commands

#### Project Initialization
- **`/init`**: Analyze project and create `AGENTS.md` configuration file
- **`/edit-agents`**: Open current rules file in `$EDITOR`
- **`/where-rules`**: Show which rules are active and their merge order

#### File and Editor Operations
- **`/editor`**: Open external editor for composing messages
- **Reference Files**: Use `@filename` to reference files in messages

### 3. Shell Integration Commands

#### Command Execution
- **Shell Commands**: Use `!command` to execute shell commands
- **Examples**:
  - `!git status` - Show git repository status
  - `!npm test` - Run test suite
  - `!ls -la` - List directory contents

#### Environment Integration
- **Editor Configuration**: Uses `EDITOR` environment variable
- **Supported Editors**: VS Code, Vim, Nano, Notepad
- **Path Integration**: Respects system PATH for command resolution

## CLI Command Reference

### 1. Main Commands

#### Core Operations
```bash
# Start OpenCode in current directory
opencode

# Start in specific directory
opencode -c /path/to/project

# Run with debug logging
opencode -d

# Show version information
opencode --version
```

#### Non-Interactive Mode
```bash
# Execute single prompt
opencode "Analyze the codebase structure"

# Pipe input
echo "Review security patterns" | opencode

# Script integration
opencode "$(cat prompt.txt)"
```

### 2. Subcommands

#### Agent Management
```bash
# Manage custom agents
opencode agent list
opencode agent create my-agent
opencode agent delete my-agent
```

#### Authentication
```bash
# Manage provider credentials
opencode auth login
opencode auth logout
opencode auth status
```

#### GitHub Integration
```bash
# GitHub agent management
opencode github setup
opencode github status
```

#### Model Management
```bash
# List available models
opencode models list

# Get model information
opencode models info gpt-4
```

#### Server Mode
```bash
# Start headless server
opencode serve --port 8080

# Start with specific configuration
opencode serve --config custom.json
```

#### System Operations
```bash
# Update OpenCode
opencode upgrade

# Run with specific model
opencode --model gpt-4

# Set logging level
opencode --log-level debug
```

### 3. Global Flags

#### Common Options
- **`--help`**: Display help information
- **`--version`**: Print version information
- **`--model`**: Specify AI model to use
- **`--log-level`**: Set logging verbosity (debug, info, warn, error)
- **`-c, --directory`**: Set working directory
- **`-d, --debug`**: Enable debug logging

## Configuration Integration

### 1. Command Configuration

#### opencode.json Integration
```json
{
  "$schema": "https://opencode.ai/config.json",
  "commands": {
    "custom_commands_path": ".opencode/commands",
    "global_commands_path": "~/.config/opencode/commands"
  },
  "keybinds": {
    "help": "?",
    "new_session": "ctrl+n",
    "export": "ctrl+e"
  }
}
```

#### Environment Variables
```bash
# Custom command paths
export OPENCODE_COMMANDS_PATH="/custom/path/commands"

# Editor for /editor command
export EDITOR="code"

# Custom configuration file
export OPENCODE_CONFIG="/path/to/config.json"
```

### 2. AGENTS.md Command Integration

#### Command-Specific Rules
```markdown
# Custom Command Guidelines

## Command Creation Standards
* Use descriptive command names
* Include clear usage instructions
* Provide example outputs
* Document required arguments

## Argument Naming Conventions
* Use UPPER_CASE for argument names
* Be descriptive: $MODULE_NAME not $M
* Include type hints in descriptions
* Validate inputs when possible
```

## Advanced Features

### 1. Command Composition

#### Chaining Commands
```markdown
# Full Stack Review $COMPONENT

Execute comprehensive review of $COMPONENT:

1. First run: /security-check $COMPONENT
2. Then run: /performance-analysis $COMPONENT
3. Finally run: /documentation-review $COMPONENT

Combine results into unified recommendation.
```

#### Conditional Logic
```markdown
# Environment-Specific Deploy $ENV

Based on environment $ENV:

- If $ENV = "production":
  * Run full test suite
  * Require manual approval
  * Create backup
- If $ENV = "staging":
  * Run integration tests
  * Auto-deploy after tests
- If $ENV = "development":
  * Quick validation
  * Immediate deployment
```

### 2. Integration Patterns

#### Git Workflow Integration
```markdown
# Create Feature Branch $FEATURE_NAME

Create and set up feature branch for $FEATURE_NAME:

1. `git checkout main`
2. `git pull origin main`
3. `git checkout -b feature/$FEATURE_NAME`
4. Create initial commit structure
5. Set up branch protection rules
6. Create draft PR

Feature: $FEATURE_NAME
Base branch: $BASE_BRANCH
```

#### CI/CD Integration
```markdown
# Pipeline Status Check $PIPELINE_ID

Check CI/CD pipeline status for $PIPELINE_ID:

1. Query pipeline status
2. Display test results
3. Show deployment status
4. List any failures or warnings
5. Provide next steps if needed

Pipeline ID: $PIPELINE_ID
Environment: $TARGET_ENV
```

## Best Practices

### 1. Command Design

#### Structure Guidelines
1. **Clear Purpose**: Each command should have a single, well-defined purpose
2. **Descriptive Names**: Use action-oriented, descriptive command names
3. **Comprehensive Documentation**: Include usage instructions and examples
4. **Argument Validation**: Provide clear guidance for required arguments

#### Content Guidelines
1. **Specific Instructions**: Provide clear, actionable prompts
2. **Context Integration**: Reference project-specific patterns and standards
3. **Error Handling**: Include guidance for common failure scenarios
4. **Output Format**: Specify desired output format and structure

### 2. Team Collaboration

#### Version Control Strategy
1. **Project Commands**: Commit `.opencode/commands/` for team sharing
2. **Personal Commands**: Keep global commands in personal dotfiles
3. **Documentation**: Document command usage in project README
4. **Change Management**: Review command changes in pull requests

#### Command Organization
```
.opencode/commands/
├── README.md                    # Command documentation
├── code-review.md              # General code review
├── security-audit.md           # Security analysis
├── deploy/
│   ├── staging-deploy.md       # Staging deployment
│   ├── prod-deploy.md          # Production deployment
│   └── rollback.md             # Rollback procedures
├── testing/
│   ├── unit-test.md            # Unit test generation
│   ├── integration-test.md     # Integration test creation
│   └── e2e-test.md             # End-to-end test scenarios
└── docs/
    ├── api-docs.md             # API documentation
    ├── readme-update.md        # README maintenance
    └── changelog.md            # Changelog generation
```

### 3. Performance Optimization

#### Command Efficiency
1. **Focused Scope**: Keep commands focused and efficient
2. **Argument Reuse**: Design reusable argument patterns
3. **Caching**: Consider command result caching for expensive operations
4. **Lazy Loading**: Load additional context only when needed

## Security Considerations

### 1. Command Security

#### Safe Command Patterns
```markdown
# Security Guidelines for Commands

## Safe Operations
* Read-only file operations
* Status and information queries
* Test execution
* Documentation generation

## Requires Confirmation
* File modifications
* Network operations
* System commands
* Deployment operations
```

#### Argument Validation
```markdown
# Input Validation $USER_INPUT

Validate user input $USER_INPUT:

1. Check for malicious patterns
2. Sanitize special characters
3. Validate against expected format
4. Confirm before execution

Input to validate: $USER_INPUT
```

### 2. Access Control

#### Permission Integration
Commands respect OpenCode's permission system:
- File operations follow read/write permissions
- Shell commands follow execution permissions
- Network operations require appropriate access

## Troubleshooting

### Common Issues

#### 1. Command Not Found
**Symptoms**: Custom command doesn't appear or execute
**Solutions**:
- Verify file location and naming
- Check file extension (`.md` required)
- Restart OpenCode to reload commands
- Validate Markdown syntax

#### 2. Argument Problems
**Symptoms**: Arguments not properly substituted
**Solutions**:
- Check argument naming convention (UPPER_CASE)
- Verify argument syntax (`$NAME` format)
- Ensure no conflicting argument names
- Test with simple arguments first

#### 3. Permission Issues
**Symptoms**: Commands fail due to access restrictions
**Solutions**:
- Review OpenCode permission configuration
- Check file and directory permissions
- Validate command execution permissions
- Review security guard-rails in AGENTS.md

## Summary

SST OpenCode's command system provides powerful automation capabilities through:

- **Custom Commands**: User-defined Markdown-based commands with argument support
- **Built-in Commands**: Comprehensive set of session management and development commands
- **CLI Integration**: Full command-line interface with subcommands and global flags
- **Team Collaboration**: Version-controlled command sharing and organization
- **Security Integration**: Respect for permission systems and access controls
- **Flexibility**: Support for simple prompts to complex multi-step workflows

The system enables teams to create standardized, reusable workflows while maintaining security and consistency across development processes.