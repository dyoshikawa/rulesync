# Qwen Code Integration

## Overview

[Qwen Code](https://github.com/QwenLM/Qwen-Coder) is an advanced AI-powered code editor and development environment that leverages the Qwen language model for intelligent code completion, understanding, and assistance.

rulesync generates Qwen Code configurations that use a **complex generator pattern** similar to GeminiCLI, featuring:
- **Root file**: `QWEN.md` for main project context
- **Memory system**: `.qwen/memories/*.md` for detailed rules and documentation
- **Git-aware filtering**: Uses intelligent git-based file filtering instead of traditional ignore files
- **MCP integration**: Supports Model Context Protocol via `.qwen/settings.json`

## Generated Files

### File Structure
```
project-root/
├── QWEN.md                      # Main configuration file (root rule)
├── .qwen/
│   ├── memories/                # Detail rules directory
│   │   ├── coding-standards.md  # Generated from detail rules
│   │   ├── security-rules.md    # Generated from detail rules
│   │   └── api-guidelines.md    # Generated from detail rules
│   └── settings.json            # MCP configuration (if configured)
└── .rulesync/
    ├── rules/                   # Source rule files
    │   ├── overview.md          # Root rule (→ QWEN.md)
    │   ├── coding-standards.md  # Detail rule (→ .qwen/memories/)
    │   └── security-rules.md    # Detail rule (→ .qwen/memories/)
    └── mcp.json                 # MCP source configuration
```

## Root File Generation (QWEN.md)

The main `QWEN.md` file is generated from your root rule and includes XML document references to memory files:

```markdown
# Project Overview

Your main project context goes here...

## Additional Documentation

The following files contain detailed rules and guidelines:

<document path=".qwen/memories/coding-standards.md">
Coding standards and style guide
</document>

<document path=".qwen/memories/api-guidelines.md">
API design and implementation guidelines  
</document>

<document path=".qwen/memories/security-rules.md">
Security requirements and best practices
</document>
```

### XML Document References
- Qwen Code supports `<document path="...">` tags for referencing external files
- File paths are relative to the project root
- Brief descriptions help Qwen Code understand when to load specific documents
- Files are loaded on-demand for better performance

## Memory System (.qwen/memories/)

Detail rules are converted to individual memory files in the `.qwen/memories/` directory:

### Memory File Format
```markdown
# Coding Standards

## Language Preferences
- TypeScript strict mode enabled
- Use functional components with hooks
- Prefer explicit return types

## Code Organization
- One component per file
- Group related utilities in modules
- Use barrel exports for clean imports

## Testing Requirements
- Unit tests for all business logic
- Integration tests for API endpoints
- Minimum 80% code coverage
```

### Features
- Each detail rule becomes a separate memory file
- Files maintain their original markdown formatting
- Qwen Code loads memories contextually based on current work
- Supports unlimited memory files for complex projects

## Git-Aware Filtering

Unlike traditional ignore files, Qwen Code uses **git-aware filtering**:

### How It Works
- Qwen Code respects your existing `.gitignore` patterns
- Additional intelligent filtering based on file types and content
- No need for dedicated `.qwenignore` or similar files
- Automatic exclusion of build artifacts and dependencies

### Advantages
- **Simplified Configuration**: No additional ignore files to maintain
- **Git Integration**: Consistent with existing git workflows  
- **Intelligent Filtering**: Contextual file filtering based on project type
- **Performance**: Efficient filtering without scanning all files

### Supported Patterns
Qwen Code automatically filters common patterns:
- `node_modules/` - Package dependencies
- `dist/`, `build/` - Build outputs
- `.git/` - Git metadata
- `*.log` - Log files
- Binary files and media assets

## MCP Integration

If your project includes MCP configuration in `.rulesync/mcp.json`, rulesync generates `.qwen/settings.json`:

### Generated MCP Configuration
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "env": {
        "WORKSPACE_ROOT": "."
      }
    },
    "github": {
      "command": "npx", 
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

### MCP Features
- **Tool Integration**: Connect external tools and services
- **Server Management**: Configure and manage MCP servers
- **Environment Variables**: Secure credential management
- **Auto-Configuration**: Automatic setup from rulesync MCP config

## Usage Examples

### Basic Setup
```bash
# Initialize project
npx rulesync init

# Edit your rule files
# .rulesync/rules/overview.md (becomes QWEN.md)
# .rulesync/rules/coding-standards.md (becomes .qwen/memories/)

# Generate Qwen Code configuration
npx rulesync generate --qwencode
```

### Generated Output
- ✅ `QWEN.md` with project overview and XML references
- ✅ `.qwen/memories/coding-standards.md` with detailed rules
- ✅ `.qwen/settings.json` with MCP configuration (if configured)

### With MCP Configuration
```bash
# Add MCP servers to .rulesync/mcp.json
{
  "mcpServers": {
    "database": {
      "command": "python",
      "args": ["-m", "db_mcp_server"],
      "env": {
        "DB_CONNECTION_STRING": "${DATABASE_URL}"
      }
    }
  }
}

# Generate with MCP support
npx rulesync generate --qwencode
```

## Best Practices

### Rule Organization
1. **Single Root Rule**: One overview rule for main project context
2. **Focused Detail Rules**: Separate files for different concerns
3. **Clear Descriptions**: Use descriptive titles for XML document references
4. **Logical Grouping**: Group related rules in coherent memory files

### Content Guidelines
1. **Specific Instructions**: Include concrete examples and patterns
2. **Context-Aware**: Write rules that help Qwen Code understand project structure
3. **Actionable**: Provide clear guidance for common development tasks
4. **Current**: Keep rules updated with project evolution

### Memory Management
1. **Size Control**: Keep individual memory files focused and reasonably sized
2. **Clear Naming**: Use descriptive filenames for memory files
3. **Regular Review**: Update memory files as project requirements change
4. **Performance**: Leverage Qwen Code's contextual loading for better performance

### MCP Integration
1. **Server Selection**: Choose MCP servers that enhance your development workflow
2. **Environment Security**: Use environment variables for sensitive configuration
3. **Tool Documentation**: Document custom MCP servers and their purposes
4. **Testing**: Verify MCP servers work correctly with your project setup

## Advanced Features

### Custom Memory Categories
```markdown
<!-- .rulesync/rules/database-patterns.md -->
---
root: false
targets: ["qwencode"]
description: "Database design and ORM patterns"
globs: ["**/*.sql", "**/*model*.ts", "**/migrations/**"]
---

# Database Patterns

## ORM Configuration
- Use TypeORM with strict mode
- Define entities with proper decorators
- Implement repository pattern for data access

## Migration Guidelines  
- One migration per feature
- Include rollback scripts
- Test migrations in development first
```

### Project-Specific Contexts
```markdown
<!-- .rulesync/rules/api-design.md -->
---
root: false
targets: ["qwencode"]
description: "RESTful API design standards"
globs: ["**/api/**", "**/routes/**", "**/*controller*.ts"]
---

# API Design Standards

## Endpoint Conventions
- Use RESTful URL patterns
- Implement proper HTTP status codes
- Include request/response validation

## Error Handling
- Consistent error response format
- Proper error logging and monitoring
- User-friendly error messages
```

## Troubleshooting

### Common Issues

#### Generated Files Not Loading
**Problem**: Qwen Code doesn't recognize generated configuration files
**Solution**: 
- Verify `QWEN.md` is in project root
- Check XML document references use correct relative paths
- Ensure `.qwen/memories/` directory exists with files

#### Memory Files Not Accessible
**Problem**: Memory files generated but not accessible to Qwen Code
**Solution**:
- Check file permissions on `.qwen/memories/` directory
- Verify memory files have `.md` extension
- Ensure files contain valid markdown content

#### MCP Configuration Issues
**Problem**: MCP servers not loading or connecting
**Solution**:
- Validate JSON syntax in `.qwen/settings.json`
- Check environment variables are properly set
- Verify MCP server commands are accessible
- Test server connectivity manually

### Validation Steps
1. **File Structure**: Verify all expected files are generated
2. **Content Quality**: Check that rule content is properly formatted
3. **XML References**: Ensure document references point to existing files
4. **MCP Testing**: Test MCP servers independently before integration

## Migration Guide

### From Manual Configuration
If you're currently using manual Qwen Code configuration:

1. **Export Existing Rules**: Copy current configurations
2. **Create rulesync Rules**: Convert to `.rulesync/rules/*.md` format
3. **Import MCP Config**: Add MCP servers to `.rulesync/mcp.json`
4. **Generate**: Run `npx rulesync generate --qwencode`
5. **Validate**: Test generated configuration works correctly

### From Other AI Tools
```bash
# Import from other tools and generate for Qwen Code
npx rulesync import --claudecode
npx rulesync import --cursor  
npx rulesync generate --qwencode
```

## Integration with Development Workflow

### Team Collaboration
1. **Version Control**: Commit `.qwen/` directory for team consistency
2. **Documentation**: Document custom MCP servers and memory organization
3. **Standards**: Establish team conventions for rule organization
4. **Review Process**: Include Qwen Code configuration in code reviews

### CI/CD Integration
```yaml
# .github/workflows/qwencode.yml
name: Qwen Code Configuration
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install -g rulesync
      - run: rulesync validate
      - run: rulesync generate --qwencode
      - name: Check for changes
        run: |
          if ! git diff --exit-code; then
            echo "Generated files are out of sync"
            exit 1
          fi
```

This comprehensive integration enables powerful AI-assisted development workflows with Qwen Code's advanced language model capabilities.