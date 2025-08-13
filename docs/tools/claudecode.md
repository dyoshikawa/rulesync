# Claude Code Integration

## Overview

Claude Code supports a comprehensive memory system and custom slash commands. rulesync provides seamless integration with Claude Code's project-specific configuration system.

## Generated Files

| File Type | Output Path | Description |
|-----------|-------------|-------------|
| **Memory** | `./CLAUDE.md` | Main project memory (root rules) |
| **Memory Details** | `.claude/memories/*.md` | Detail rules (non-root) |
| **Custom Commands** | `.claude/commands/*.md` | Custom slash commands |
| **MCP Configuration** | `.mcp.json` | Model Context Protocol servers |
| **Ignore Rules** | `.claude/settings.json` | File access permissions |

## Memory System

### Hierarchical Structure

Claude Code uses a hierarchical memory system:

- **Root Rules** (`./CLAUDE.md`): Project-wide overview and policies
- **Detail Rules** (`.claude/memories/*.md`): Specific implementation rules
- **Auto-Import**: CLAUDE.md includes `@filename` references to detail files

### Memory Features

- **Project Memory**: Automatically loaded when Claude Code starts
- **Import System**: Can import other files using `@path/to/import` syntax  
- **Search Mechanism**: Recursive search from current directory to root
- **Size Optimization**: Keep under few thousand tokens for cost efficiency

## Custom Slash Commands

### Command Generation

rulesync generates custom slash commands from `.rulesync/commands/` directory:

```bash
# Generate commands for Claude Code
npx rulesync generate --claudecode
```

### Command Format

Commands are generated as plain Markdown files:

```
.claude/commands/
├── init-project.md      # /init-project command
├── test-suite.md        # /test-suite command  
└── deploy.md            # /deploy command
```

### Creating Custom Commands

Instead of using Claude Code's built-in `/init` command, create a custom rulesync command:

**`.claude/commands/init-rulesync.md`**

```markdown
Analyze this project's codebase and update .rulesync/overview.md files as needed.

Please ensure the following frontmatter is defined in .rulesync/overview.md:

---
root: true | false               # Required: Rule level
targets: ["*"]                   # Required: Target tools  
description: ""                  # Required: Rule description
globs: ["**/*"]                  # Required: File patterns
---

In .rulesync/overview.md, root should be set to true.
```

## Rule Processing

### Root Rules
- **Target**: Main `CLAUDE.md` file
- **Content**: Project overview and high-level guidelines
- **Import References**: Automatically includes `@filename` references to detail files

### Non-Root Rules  
- **Target**: `.claude/memories/*.md` files
- **Content**: Specific implementation rules and detailed guidelines
- **Organization**: One file per rule category

## Usage Examples

### Generate Claude Code Configuration

```bash
# Generate only for Claude Code
npx rulesync generate --claudecode

# Generate with verbose output
npx rulesync generate --claudecode --verbose

# Generate in specific directory (monorepo)
npx rulesync generate --claudecode --base-dir ./packages/frontend
```

### Import Existing Configuration

```bash
# Import from existing Claude Code setup
npx rulesync import --claudecode

# This imports from:
# - CLAUDE.md (main memory)
# - .claude/memories/*.md (detail memories)
# - .claude/commands/*.md (custom commands)
```

## Integration Benefits

- **Team Standardization**: All team members use the same rule set
- **Project-Specific Initialization**: Optimized rule configuration for each project
- **Automatic Rule Updates**: Rules adapt to project changes automatically
- **Continuous Improvement**: Rules evolve with project growth
- **Command Consistency**: Uniform slash commands across projects

## Best Practices

### Memory Organization
1. **Single Root Rule**: Only one file should have `root: true`
2. **Focused Detail Rules**: Each non-root file covers specific topics
3. **Clear Descriptions**: Use descriptive filenames and descriptions
4. **Regular Updates**: Keep rules current with project evolution

### Command Design
1. **Clear Purpose**: Each command should have single responsibility
2. **Descriptive Names**: Use intuitive command names
3. **Detailed Instructions**: Provide step-by-step guidance
4. **Expected Outcomes**: Specify what should be accomplished

## See Also

- [Custom Commands](../features/custom-commands.md) - Detailed command creation guide
- [MCP Integration](../features/mcp.md) - Model Context Protocol configuration
- [Configuration](../configuration.md) - General configuration options