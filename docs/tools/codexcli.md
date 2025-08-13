# OpenAI Codex CLI Integration

## Overview

OpenAI Codex CLI supports a hierarchical memory system that provides persistent context and project-specific rules to GPT-4 powered development workflows. rulesync generates organized instruction files that integrate with Codex CLI's memory hierarchy.

## Generated Files

| File Type | Output Path | Description |
|-----------|-------------|-------------|
| **Project Instructions** | `codex.md` | Main project-level instructions (root rules) |
| **Detail Instructions** | `<filename>.md` | Additional instruction files (non-root rules) |
| **MCP Configuration** | `.codex/mcp-config.json` | MCP server configuration |
| **Ignore Rules** | `.codexignore` | File exclusion patterns (community tools) |

## Hierarchical Memory System

### Memory Hierarchy
Codex CLI loads instructions in hierarchical order:

1. **Global User Instructions** (`~/.codex/instructions.md`) - Personal preferences
2. **Project-Level Instructions** (`codex.md`) - Project-specific guidelines
3. **Directory-Specific Instructions** (`<cwd>/codex.md`) - Local rules

### File Processing
- **Root Rules** → `codex.md` (main project instructions)
- **Non-Root Rules** → Individual `.md` files for specific categories
- **Plain Markdown**: Clean, readable format without complex frontmatter

## Supported Models

OpenAI Codex CLI works with various OpenAI models:

- **GPT-4**: Best for complex reasoning and architecture decisions
- **GPT-4 Turbo**: Optimized for performance and cost efficiency  
- **o1-mini**: Specialized for coding tasks and problem-solving
- **GPT-4o-mini**: Balanced performance for everyday development tasks

## Usage Examples

### Generate Codex CLI Configuration

```bash
# Generate only for OpenAI Codex CLI
npx rulesync generate --codexcli

# Generate with MCP configuration
npx rulesync generate --codexcli --verbose

# Generate in specific directory (monorepos)
npx rulesync generate --codexcli --base-dir ./packages/frontend
```

### Import Existing Configuration

```bash
# Import from existing Codex CLI setup
npx rulesync import --codexcli

# This imports from:
# - codex.md (main instructions)
# - Additional .md files (detail instructions)
```

## File Organization

### Standard Structure
```
project-root/
├── codex.md                     # Main project instructions
├── typescript-rules.md         # Language-specific rules
├── testing-guidelines.md       # Testing requirements
├── security-standards.md       # Security guidelines
└── .codex/
    └── mcp-config.json         # MCP server configuration
```

### Content Examples

**Main Instructions** (`codex.md`):
```markdown
# E-commerce Platform Development

This is a modern e-commerce platform built with Next.js and TypeScript.

## Architecture
- Frontend: Next.js 14 with TypeScript
- Backend: Next.js API routes  
- Database: PostgreSQL with Prisma ORM
- Styling: Tailwind CSS

## Development Workflow
### Setup
```bash
pnpm install
cp .env.example .env.local
pnpm db:push
```

## Database Guidelines
- Use Prisma schema for all database changes
- Run migrations in order: dev → staging → production
- Always backup before schema changes
```

**Detail Instructions** (`typescript-rules.md`):
```markdown
# TypeScript Development Rules

## Code Quality Standards
- Use TypeScript strict mode
- Write descriptive commit messages
- Include error handling in all functions
- Use meaningful variable names

## Component Standards
- One component per file
- Use TypeScript interfaces for props
- Implement proper error boundaries
- Follow atomic design principles
```

## MCP Integration

### MCP Configuration
rulesync can generate MCP server configurations for Codex CLI:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/project/root"],
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
- **STDIO Transport**: Local process communication via stdin/stdout
- **HTTP/SSE Transport**: Remote server communication (future support)
- **Wrapper Servers**: Third-party MCP servers that expose Codex CLI functionality

## Advanced Features

### Multi-Directory Support
```bash
# Generate in multiple directories (monorepo)
npx rulesync generate --codexcli --base-dir ./packages/frontend,./packages/backend
```

### Environment-Specific Rules
```markdown
# Environment-Specific Guidelines

## Development
- Use local database connections
- Enable verbose logging
- Allow experimental features

## Production  
- Use production database connections
- Minimize logging output
- Require manual approval for destructive operations
```

### Model-Specific Optimization
```markdown
# Model Usage Guidelines

## GPT-4 (Complex Tasks)
- Architecture decisions
- Code reviews
- Algorithm design
- Performance optimization

## o1-mini (Coding Tasks)  
- Bug fixing
- Feature implementation
- Code refactoring
- Test writing

## GPT-4o-mini (Daily Tasks)
- Code completion
- Documentation
- Simple debugging
- Routine maintenance
```

## Best Practices

### Instruction Design
1. **Clear Structure**: Use consistent heading hierarchy
2. **Actionable Content**: Provide specific, implementable guidance
3. **Context Relevant**: Focus on project-specific needs
4. **Regular Updates**: Keep instructions current with project evolution

### Memory Management
1. **Concise Content**: Keep under 2000 words per file for cost efficiency
2. **Focused Topics**: One topic per instruction file
3. **Hierarchical Organization**: Use project → detail instruction flow
4. **Version Control**: Track instruction changes in Git

### Team Workflow
1. **Shared Standards**: Ensure all team members use same instructions
2. **Regular Reviews**: Update instructions based on project changes
3. **Documentation Sync**: Keep instructions aligned with project docs
4. **New Member Training**: Use instructions for developer onboarding

## Configuration Management

### Disabling Instructions
```bash
# Disable project-level instruction loading
CODEX_DISABLE_PROJECT_DOC=1 codex

# Using CLI flag
codex --no-project-doc
```

### Debug Configuration
```bash
# Enable debug mode to see loaded files
CODEX_DEBUG_CONFIG=1 codex

# Check configuration
codex doctor
```

## Integration Benefits

### Development Experience
- **Consistent Context**: Persistent project context across sessions
- **Model Flexibility**: Choose appropriate model for task complexity
- **Hierarchical Rules**: Local rules can override global settings
- **Plain Markdown**: Easy to read and maintain instruction format

### Team Collaboration
- **Shared Knowledge**: Team members use consistent instruction set
- **Project Evolution**: Instructions evolve with project changes
- **Onboarding Efficiency**: New developers get immediate context
- **Quality Consistency**: AI generates code following team standards

## Troubleshooting

### Common Issues
1. **Instructions Not Applied**: Check file location and naming
2. **Performance Issues**: Reduce instruction file size
3. **Conflicting Rules**: Review instruction hierarchy and conflicts
4. **Model Selection**: Choose appropriate model for task complexity

### Debugging Steps
1. **Check File Structure**: Verify correct file placement
2. **Review Content**: Ensure instructions are clear and specific
3. **Test Hierarchy**: Verify instruction loading order
4. **Monitor Usage**: Track instruction effectiveness

## Migration Strategies

### From Other AI Tools
1. **Multi-Tool Import**: Import rules from other AI coding tools
2. **Format Conversion**: Convert to plain Markdown format
3. **Hierarchy Organization**: Organize into project/detail structure
4. **Model Optimization**: Adjust content for OpenAI model characteristics

### From Manual Setup
1. **Audit Existing**: Review current `codex.md` and instruction files
2. **Categorize Content**: Organize into logical rule categories
3. **rulesync Integration**: Import or recreate in `.rulesync/` format
4. **Generate Configuration**: Use rulesync to create organized structure

## See Also

- [MCP Integration](../features/mcp.md) - Model Context Protocol configuration
- [Configuration](../configuration.md) - General configuration options
- [Best Practices](../guides/best-practices.md) - Instruction organization strategies