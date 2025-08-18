# OpenAI Codex CLI Integration

## Overview

OpenAI Codex CLI supports a hierarchical memory system that provides persistent context and project-specific rules to GPT-4 powered development workflows. rulesync generates organized instruction files that integrate with Codex CLI's memory hierarchy.

## Generated Files

| File Type | Output Path | Description |
|-----------|-------------|-------------|
| **Root Instructions** | `AGENTS.md` | Root instructions with XML document references |
| **Memory Files** | `.codex/memories/<filename>.md` | Individual memory files for detail rules |
| **MCP Configuration** | `.codex/mcp-config.json` | MCP server configuration |
| **Ignore Rules** | `.codexignore` | File exclusion patterns (community tools) |

## File Splitting Architecture

### Advanced Multi-File System (Enhanced v0.62.0+)
Codex CLI now implements advanced file splitting with XML document references for improved organization:

1. **Root Instructions** (`AGENTS.md`) - Contains primary project context with XML `<Documents>` references
2. **Memory Files** (`.codex/memories/*.md`) - Individual files for specific rule categories (auto-generated)
3. **Global Instructions** (`~/.codex/instructions.md`) - Personal preferences (unchanged)

### XML Document Reference System
- **Automatic XML Generation**: Uses fast-xml-parser for structured document references
- **Smart Path Resolution**: Auto-generated `@.codex/memories/{filename}.md` paths
- **Metadata Integration**: Includes description and glob patterns from frontmatter
- **Plain Markdown Output**: Clean memory files without YAML frontmatter complexity
- **Directory Auto-Creation**: `.codex/memories/` directory created automatically
- **Gitignore Integration**: Memory files excluded via `**/.codex/memories/` pattern

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
# - AGENTS.md (root instructions)
# - .codex/memories/*.md (memory files)
```

## File Organization

### Standard Structure
```
project-root/
├── AGENTS.md                    # Root instructions with XML references
├── .codex/
│   ├── memories/                # Memory files directory
│   │   ├── typescript-rules.md   # Language-specific rules
│   │   ├── testing-guidelines.md # Testing requirements
│   │   └── security-standards.md # Security guidelines
│   └── mcp-config.json         # MCP server configuration
└── .codexignore                 # File exclusion patterns
```

### Content Examples

**Root Instructions** (`AGENTS.md`) - Auto-generated with XML references:
```markdown
Please also reference the following documents as needed. In this case, `@` stands for the project root directory.

<Documents>
  <Document>
    <Path>@.codex/memories/typescript-rules.md</Path>
    <Description>TypeScript development guidelines</Description>
    <FilePatterns>**/*.ts, **/*.tsx</FilePatterns>
  </Document>
  <Document>
    <Path>@.codex/memories/testing-guidelines.md</Path>
    <Description>Testing requirements and practices</Description>
    <FilePatterns>**/*.test.ts, **/*.spec.ts</FilePatterns>
  </Document>
  <Document>
    <Path>@.codex/memories/security-standards.md</Path>
    <Description>Security guidelines and best practices</Description>
    <FilePatterns>**/*.js, **/*.ts, **/*.tsx</FilePatterns>
  </Document>
</Documents>

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

**Memory File** (`.codex/memories/typescript-rules.md`):
```markdown
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

### XML Document Integration
The file splitting system uses structured XML document references with enhanced features:

```xml
<Documents>
  <Document>
    <Path>@.codex/memories/component-guidelines.md</Path>
    <Description>Component development guidelines and patterns</Description>
    <FilePatterns>src/components/**/*.tsx, src/components/**/*.ts</FilePatterns>
  </Document>
  <Document>
    <Path>@.codex/memories/api-standards.md</Path>
    <Description>API development and testing standards</Description>
    <FilePatterns>src/api/**/*.ts, **/*.test.ts</FilePatterns>
  </Document>
</Documents>
```

### Advanced XML Features
- **Dynamic Path Resolution**: Automatically resolves `@` symbol to project root
- **Conditional FilePatterns**: Only includes patterns when globs exist in frontmatter
- **Auto-Generated Descriptions**: Uses frontmatter description or generates from filename
- **Structured Formatting**: XML output properly formatted with fast-xml-parser
- **Memory Organization**: Logical separation of concerns across multiple files

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
2. **Focused Topics**: One topic per memory file for better organization
3. **Auto-Generated XML**: XML references maintain structure without manual editing
4. **Version Control**: Track AGENTS.md in Git, memory files auto-excluded via .gitignore
5. **File Splitting**: Automatic separation of root and detail rules
6. **Plain Markdown**: Memory files generated without frontmatter complexity
7. **Directory Auto-Creation**: `.codex/memories/` created automatically during generation

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
- **Persistent Context**: Root instructions with organized memory references
- **Model Flexibility**: Choose appropriate model for task complexity (GPT-4, o1-mini, etc.)
- **Automatic Organization**: Memory files separated by topic/concern without manual effort
- **XML Integration**: Structured document references for easy AI navigation
- **Clean Output**: Plain Markdown memory files without YAML frontmatter
- **File Splitting Benefits**: Improved token efficiency and context management
- **Gitignore Integration**: Memory files automatically excluded from version control

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
1. **Audit Existing**: Review current instruction files
2. **Categorize Content**: Organize into logical rule categories
3. **rulesync Integration**: Import or recreate in `.rulesync/` format
4. **Generate Configuration**: Use rulesync to create AGENTS.md + memory files structure

## See Also

- [MCP Integration](../features/mcp.md) - Model Context Protocol configuration
- [Configuration](../configuration.md) - General configuration options
- [Best Practices](../guides/best-practices.md) - Instruction organization strategies