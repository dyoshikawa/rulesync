# Windsurf AI Code Editor Integration

## Overview

Windsurf supports comprehensive AI-assisted development through its Cascade AI system, with rules/memories, MCP servers, and advanced ignore file patterns. rulesync provides full integration with Windsurf's complete ecosystem.

## Generated Files

| File Type | Output Path | Description |
|-----------|-------------|-------------|
| **Project Rules** | `.windsurf/rules/*.md` | Project-specific rules (recommended) |
| **Single File Rules** | `.windsurf-rules` | Alternative single-file format |
| **MCP Configuration** | `.windsurf/mcp.json` | Model Context Protocol servers |
| **Ignore Rules** | `.codeiumignore` | File exclusion patterns for Cascade AI |

## Rule System

### Rule Placement Options

Windsurf supports multiple rule organization strategies:

#### Directory Variant (Recommended)
- **Location**: `.windsurf/rules/` directory
- **Files**: Multiple Markdown files for organized categorization
- **Benefits**: Better organization, team collaboration, version control friendly
- **Discovery**: Automatically discovers rules from current and parent directories

#### Single-File Alternative
- **Location**: `.windsurf-rules` file at project root
- **Format**: Single Markdown file with all rules
- **Use Case**: Simple projects or minimal rule sets

### Rule Activation Modes

Each rule can be configured with different activation modes:

1. **Always-On** (`windsurfActivationMode: "always"`): Rule injected in every prompt
2. **Manual** (`windsurfActivationMode: "manual"`): Only when explicitly @mentioned
3. **Model-Decision** (`windsurfActivationMode: "model-decision"`): AI decides relevance
4. **Glob** (`windsurfActivationMode: "glob"`): Apply only to files matching patterns

## Rule Processing

### Root Rules
- **Target**: Combined into rule files with `always` activation mode
- **Content**: Project overview and persistent context
- **Scope**: Project-wide guidelines

### Non-Root Rules
- **Target**: Individual rule files with appropriate activation modes
- **Content**: Specific implementation rules and detailed guidelines
- **Organization**: One file per rule category

## Usage Examples

### Generate Windsurf Configuration

```bash
# Generate only for Windsurf
npx rulesync generate --windsurf

# Generate with verbose output
npx rulesync generate --windsurf --verbose

# Generate in specific directory
npx rulesync generate --windsurf --base-dir ./packages/frontend
```

### Import Existing Configuration

```bash
# Import from existing Windsurf setup
npx rulesync import --windsurf

# This imports from:
# - .windsurf/rules/*.md files
# - .windsurf-rules (single file)
# - .windsurf/mcp.json (MCP configuration)
```

## File Organization

### Directory Structure (Recommended)
```
.windsurf/
├── rules/
│   ├── project-overview.md      # Always-on project context
│   ├── typescript-standards.md  # Language-specific rules
│   ├── testing-guidelines.md    # Testing requirements
│   ├── security-rules.md        # Security guidelines
│   └── ui-patterns.md           # Frontend-specific patterns
├── mcp.json                     # MCP server configuration
└── memories/                    # Auto-generated memories (IDE managed)
```

### Rule Examples

**Always-On Project Rule**:
```yaml
---
windsurfActivationMode: "always"
windsurfOutputFormat: "directory"
description: "Core project guidelines"
---

# Project Development Standards

## Tech Stack
- React 18 with TypeScript
- Tailwind CSS for styling
- Vitest for testing

## Architecture
- Clean architecture principles
- Component-based design
- Dependency injection
```

**Glob-Activated Rule**:
```yaml
---
windsurfActivationMode: "glob"
globs: ["**/*.tsx", "**/*.jsx"]
tags: ["ui", "react"]
---

# React Component Rules

Apply these rules when editing React components:

- Use functional components with hooks
- Implement proper TypeScript interfaces
- Include accessibility attributes
```

**Model-Decision Rule**:
```yaml
---
windsurfActivationMode: "model-decision"
description: "Database operation guidelines"
---

# Database Guidelines

Apply when working with database operations:

- Use Prisma for schema changes
- Always backup before migrations
- Validate input data
```

## Cascade AI Integration

### Memory System

Windsurf's Cascade AI integrates with multiple memory sources:

- **Workspace Rules**: Project-specific guidelines in `.windsurf/rules/`
- **Auto-Generated Memories**: Context learned from development patterns
- **Global Rules**: User-wide preferences (not managed by rulesync)

### Memory Features

- **Persistent Context**: Rules provide ongoing project understanding
- **Adaptive Learning**: Auto-memories adjust to development patterns
- **Contextual Application**: Rules activate based on current work context
- **Performance Optimization**: Smart memory loading for efficiency

## MCP Integration

### MCP Configuration

Windsurf uses `.windsurf/mcp.json` for MCP server configuration:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxx"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
    },
    "database": {
      "serverUrl": "https://db-service.example.com/mcp/sse"
    }
  }
}
```

### Transport Types
- **STDIO**: Local executable communication via stdin/stdout
- **SSE**: Server-Sent Events over HTTP/HTTPS
- **HTTP**: Plain HTTP endpoint communication

## Advanced Features

### Multi-Level Rule Discovery

Windsurf automatically discovers rules from:
- Current folder and subdirectories
- Parent directories up to Git root
- All open workspaces (duplicates deduped)

### Rule Configuration Options

**Output Format Control**:
```yaml
---
windsurfOutputFormat: "directory"  # Generate .windsurf/rules/*.md
# or
windsurfOutputFormat: "single-file"  # Generate .windsurf-rules
---
```

**Tag-Based Organization**:
```yaml
---
tags: ["security", "typescript", "frontend"]
windsurfActivationMode: "model-decision"
---
```

### Ignore File Integration

Windsurf uses `.codeiumignore` for excluding files from Cascade AI:

```gitignore
# Build artifacts
dist/
build/
out/

# Dependencies
node_modules/
.pnpm-store/

# Environment files
.env*
!.env.example

# Secrets and keys
*.pem
*.key
secrets/
```

## Best Practices

### Rule Organization
1. **Use Directory Structure**: Prefer `.windsurf/rules/` for complex projects
2. **Appropriate Activation**: Choose activation modes based on rule context
3. **Clear Descriptions**: Use descriptive rule descriptions for model-decision mode
4. **Focused Content**: Keep rules specific to their intended context

### Performance Optimization
1. **Smart Activation**: Use glob and model-decision modes to reduce noise
2. **Relevant Content**: Include only applicable rules for specific contexts
3. **Size Management**: Keep rule files focused and concise
4. **Memory Integration**: Leverage auto-generated memories for dynamic context

### Team Collaboration
1. **Version Control**: Commit `.windsurf/rules/` for team consistency
2. **Rule Documentation**: Document complex activation patterns
3. **Regular Updates**: Maintain rules as project evolves
4. **Activation Testing**: Verify rules activate appropriately

## Integration Benefits

### Development Experience
- **Context-Aware AI**: Cascade AI understands project patterns
- **Adaptive Assistance**: Rules adjust to current work context
- **Consistent Quality**: AI generates code following established patterns
- **Reduced Iterations**: Better context leads to more accurate suggestions

### AI Enhancement
- **Multi-Modal Rules**: Combine always-on, contextual, and pattern-based rules
- **Dynamic Context**: Auto-memories provide evolving project understanding
- **Intelligent Activation**: Rules activate when most relevant
- **Performance Balance**: Smart loading prevents context overload

## Migration Strategies

### From Other AI Tools
1. **Multi-Tool Import**: Import rules from various AI coding tools
2. **Activation Mapping**: Convert rule types to appropriate activation modes
3. **Content Adaptation**: Adjust rules for Windsurf's context system
4. **Testing Validation**: Verify rules work effectively with Cascade AI

### Rule Consolidation
1. **Organize by Context**: Group rules by activation patterns
2. **Optimize Activation**: Use most appropriate mode for each rule
3. **Performance Tuning**: Balance context richness with performance
4. **Team Training**: Educate team on new rule system

## Troubleshooting

### Common Issues
1. **Rules Not Activated**: Check activation mode and conditions
2. **Performance Issues**: Optimize rule activation patterns
3. **Context Overload**: Use more specific activation modes
4. **Rule Conflicts**: Review overlapping rule conditions

### Debugging Steps
1. **Check Rule Discovery**: Verify rules are found by Windsurf
2. **Review Activation**: Test rule activation conditions
3. **Monitor Performance**: Check impact on Cascade AI response time
4. **Validate Context**: Ensure rules provide appropriate guidance

## Configuration Examples

### Frontend-Focused Project
```yaml
---
windsurfActivationMode: "glob"
globs: ["**/*.tsx", "**/*.jsx", "**/*.css"]
windsurfOutputFormat: "directory"
---

# Frontend Development Rules

## Component Standards
- Use functional components with hooks
- Implement proper TypeScript interfaces
- Follow atomic design principles

## Styling Guidelines  
- Use Tailwind utility classes
- Implement responsive design patterns
- Maintain design system consistency
```

### Full-Stack Application
```yaml
---
windsurfActivationMode: "model-decision"
description: "Full-stack development guidelines for API and frontend"
windsurfOutputFormat: "directory"
---

# Full-Stack Development Rules

## API Development
- RESTful endpoint design
- Proper error handling
- Authentication/authorization

## Database Operations
- Use migrations for schema changes
- Implement proper indexes
- Validate all inputs
```

## See Also

- [MCP Integration](../features/mcp.md) - Model Context Protocol configuration
- [Configuration](../configuration.md) - Rule configuration options
- [Best Practices](../guides/best-practices.md) - Rule organization strategies