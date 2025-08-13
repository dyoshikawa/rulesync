# Custom Slash Commands

## Overview

rulesync can generate custom slash commands for Claude Code and Gemini CLI from unified command definitions. This enables you to create consistent custom commands across different AI assistants, streamlining your development workflow.

## Supported Tools

| Tool | Output Path | Format | Command Syntax |
|------|-------------|--------|----------------|
| **Claude Code** | `.claude/commands/<name>.md` | Plain Markdown | `/command-name [args]` |
| **Gemini CLI** | `.gemini/commands/<name>.md` | Plain Markdown | `/command-name [args]` |

## Command File Structure

### Source Directory
Create command files in the `.rulesync/commands/` directory:

```
.rulesync/
├── commands/
│   ├── init-project.md      # /init-project command
│   ├── test-suite.md        # /test-suite command
│   ├── deploy.md            # /deploy command
│   └── git/
│       ├── commit.md        # /git:commit command (namespaced)
│       └── review.md        # /git:review command
└── *.md                     # Regular rule files
```

### Command File Format

Commands use simplified YAML frontmatter and Markdown content:

```markdown
---
targets: ["claudecode", "geminicli"]    # Target tools (optional)
description: "Initialize project setup"  # Brief description (optional)
---

# Initialize Project

Analyze this project's codebase and set up the initial configuration.

## Steps:
1. Scan project structure
2. Identify technology stack
3. Create configuration files
4. Set up development environment

Please ensure the following:
- All dependencies are properly configured
- Environment variables are documented
- README is updated with setup instructions
```

## Frontmatter Fields

### Command Frontmatter (Simplified in v0.58.0)
- **`targets`** (optional): Array of target tools. Defaults to `["claudecode", "geminicli"]`
- **`description`** (optional): Brief description of the command's purpose

**Note**: The command name is automatically derived from the filename (without extension).

## Command Examples

### Project Planning Command
**`.rulesync/commands/plan.md`**:
```markdown
---
description: "Create a step-by-step implementation plan"
---

Your role is strategist only. Devise a comprehensive plan for: $ARGUMENTS

Do NOT write or execute code.

Return a markdown document with:
1. Understanding of requirements
2. Investigation steps needed
3. Phased implementation approach
4. Verification and testing plan
5. Potential risks and mitigations

Focus on strategic planning, not implementation details.
```

### Code Review Command
**`.rulesync/commands/review.md`**:
```markdown
---
description: "Perform comprehensive code review"
targets: ["claudecode"]
---

Please review the following code for:

1. **Code Quality**
   - Readability and maintainability
   - Adherence to project standards
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

File to review: $ARGUMENTS
```

### Testing Command
**`.rulesync/commands/test-all.md`**:
```markdown
---
description: "Run all test suites with coverage"
---

Run the complete test suite for this project with coverage reporting.

Execute the following in sequence:
1. Unit tests
2. Integration tests  
3. E2E tests (if applicable)
4. Generate coverage report

Report any failures with details about:
- Test name and location
- Error message
- Potential fix suggestions

For any failing tests, provide guidance on:
- Root cause analysis
- Fix implementation
- Prevention strategies
```

### Git Integration Commands
**`.rulesync/commands/git/commit.md`**:
```markdown
---
description: "Generate conventional commit message"
---

Based on the staged git changes, generate a conventional commit message.

Format: `type(scope): description`

Types: feat, fix, docs, style, refactor, test, chore

Analyze the staged changes and provide:
1. Appropriate commit type
2. Relevant scope (if applicable)
3. Clear, concise description
4. Body text if changes are complex
5. Footer for breaking changes or issue references

Consider the project's existing commit history for consistency.
```

**`.rulesync/commands/git/review.md`**:
```markdown
---
description: "Review git changes for quality"
---

Please analyze the git diff and provide a comprehensive review:

**Analysis Areas:**
1. Code quality and readability
2. Potential bugs or issues
3. Performance considerations  
4. Security implications
5. Test coverage impact

**Review Format:**
- Summary of changes
- Specific feedback by file
- Suggested improvements
- Approval recommendation

Focus on constructive feedback that improves code quality.

Changes to review: $ARGUMENTS (default: staged changes)
```

## Namespaced Commands

### Creating Namespaces
Organize related commands using subdirectories:

```
.rulesync/commands/
├── frontend/
│   ├── component.md         # /frontend:component
│   ├── test.md              # /frontend:test
│   └── docs.md              # /frontend:docs
├── backend/
│   ├── api.md               # /backend:api
│   ├── database.md          # /backend:database
│   └── deploy.md            # /backend:deploy
└── git/
    ├── commit.md            # /git:commit
    ├── branch.md            # /git:branch
    └── merge.md             # /git:merge
```

### Namespace Benefits
1. **Organization**: Group related commands logically
2. **Discoverability**: Easier to find relevant commands
3. **Avoiding Conflicts**: Prevent command name collisions
4. **Team Workflow**: Align with team development structure

## Advanced Features

### Argument Injection

Commands support argument injection through special markers:

#### Claude Code
- **`$ARGUMENTS`**: Injects command arguments

#### Gemini CLI  
- **`{{args}}`**: Injects command arguments
- **Shell execution**: `!{ command }` executes shell commands

### Tool-Specific Features

#### Claude Code Commands
- **File Content Injection**: `@<filepath>` inlines file contents
- **Shell Command Execution**: `!<bash command>` executes and includes output
- **Extended Thinking**: Include keywords to trigger longer reasoning cycles

#### Gemini CLI Commands
- **Shell Integration**: `!{ <shell-cmd> }` executes commands and substitutes output
- **Argument Placeholders**: `{{args}}` for explicit argument placement
- **Implicit Append**: Arguments appended if no placeholder present

## Generation and Usage

### Generating Commands

Commands are generated automatically with the regular generate command:

```bash
# Generate everything including commands
npx rulesync generate

# Generate only for Claude Code (includes commands)
npx rulesync generate --claudecode

# Generate only for Gemini CLI (includes commands)  
npx rulesync generate --geminicli

# Generate for both command-supporting tools
npx rulesync generate --claudecode --geminicli
```

### Using Generated Commands

#### In Claude Code
```bash
# Simple command
/init-project

# Command with arguments
/review src/components/Button.tsx

# Namespaced command
/frontend:component UserProfile --typescript
```

#### In Gemini CLI
```bash
# Simple command
/plan

# Command with arguments
/test-all --coverage

# Namespaced command  
/git:commit --conventional
```

## Best Practices

### Command Design
1. **Single Purpose**: Each command should have one clear responsibility
2. **Descriptive Names**: Use intuitive, self-explanatory command names
3. **Consistent Arguments**: Design predictable argument patterns
4. **Clear Instructions**: Provide step-by-step guidance in command body

### Content Guidelines
1. **Specific Instructions**: Provide clear, actionable prompts
2. **Context Integration**: Use argument injection and shell commands appropriately
3. **Output Format**: Specify desired output format (markdown, JSON, etc.)
4. **Role Definition**: Define AI role and constraints clearly

### Organization Strategy
1. **Namespace Thoughtfully**: Group related commands in logical subdirectories
2. **Avoid Duplication**: Don't create similar commands for minor variations
3. **Version Control**: Commit commands for team sharing
4. **Documentation**: Document complex commands and their usage

### Team Collaboration
1. **Shared Commands**: Use version control for team-wide command sharing
2. **Naming Conventions**: Establish consistent command naming standards
3. **Regular Reviews**: Include command changes in pull request reviews
4. **Usage Training**: Educate team members on available commands

## Migration and Updates

### From Manual Commands
1. **Audit Existing**: Review current `.claude/commands/` or `.gemini/commands/`
2. **Extract Common Patterns**: Identify reusable command templates
3. **Convert to rulesync**: Create unified commands in `.rulesync/commands/`
4. **Generate and Test**: Verify commands work correctly

### Command Evolution
1. **Usage Monitoring**: Track which commands are most useful
2. **Feedback Integration**: Update commands based on team feedback
3. **Optimization**: Improve command efficiency and effectiveness
4. **Cleanup**: Remove unused or outdated commands

## Troubleshooting

### Common Issues
1. **Command Not Found**: Check file naming and directory structure
2. **Arguments Not Working**: Verify argument injection syntax for each tool
3. **Tool Compatibility**: Ensure command targets correct tools
4. **Namespace Issues**: Check subdirectory structure for namespaced commands

### Debugging Steps
1. **Check Generation**: Verify commands are generated in correct locations
2. **Test Commands**: Use `/help` to confirm command registration
3. **Review Content**: Ensure command instructions are clear and specific
4. **Validate Arguments**: Test argument injection with sample inputs

## Integration Benefits

### Workflow Efficiency
- **Consistent Interface**: Same commands work across different AI tools
- **Reduced Context Switching**: Common tasks become simple command invocations
- **Team Standardization**: Shared commands ensure consistent workflows
- **Automation**: Complex multi-step processes become single commands

### Development Quality
- **Best Practices**: Commands encode team knowledge and standards
- **Consistency**: Standardized approaches to common tasks
- **Knowledge Sharing**: Commands document team processes
- **Onboarding**: New team members learn through command usage

## See Also

- [Claude Code Integration](../tools/claudecode.md) - Claude Code specific features
- [Gemini CLI Integration](../tools/geminicli.md) - Gemini CLI specific features
- [Configuration](../configuration.md) - Command configuration options