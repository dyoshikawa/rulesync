# AugmentCode Integration

## Overview

AugmentCode supports rule-based AI assistance with YAML frontmatter configuration. rulesync provides intelligent rule generation with automatic type detection and organized file structure for AugmentCode's rule system.

## Generated Files

| File Type | Output Path | Description |
|-----------|-------------|-------------|
| **Rules** | `.augment/rules/*.md` | Rule files with YAML frontmatter |
| **Legacy Support** | `.augment-guidelines` | Legacy single-file format (if needed) |
| **MCP Configuration** | `.augment/mcp.json` | Model Context Protocol servers |
| **Ignore Rules** | `.augmentignore` | File exclusion patterns |

## Rule Types

AugmentCode supports different rule application types:

### Always Rules (`type: always`)
- **When**: Rules applied constantly across entire project
- **Generated From**: Root rules (`root: true`) in rulesync
- **Behavior**: Persistent context for all AI interactions

### Auto Rules (`type: auto`)
- **When**: Rules applied automatically when AI detects relevance
- **Generated From**: Non-root rules with `description` specified
- **Behavior**: Context-aware automatic rule application

### Manual Rules (`type: manual`)
- **When**: Rules applied only when explicitly invoked
- **Generated From**: Non-root rules without description (default)
- **Behavior**: User-controlled rule activation

## Rule Format

AugmentCode uses Markdown files with YAML frontmatter:

```markdown
---
type: always
description: "TypeScript coding standards for all files"
globs: ["**/*.ts", "**/*.tsx"]
---

# TypeScript Development Rules

## Coding Standards
- Use strict TypeScript configuration
- Prefer interfaces over types for object shapes
- Use meaningful variable names

## Architecture Guidelines
- Follow clean architecture principles
- Separate concerns with clear module boundaries
- Use dependency injection for external services
```

## Rule Processing Logic

rulesync automatically determines appropriate rule types:

### Type Detection Rules
1. **Root rules** (`root: true`) → `type: always`
2. **Non-root with description** → `type: auto` 
3. **Non-root without description** → `type: manual` (default)

### Frontmatter Generation
- **type**: Automatically determined based on rule characteristics
- **description**: Used for `auto` type rules to help AI detect relevance
- **globs**: File patterns for rule application

## Usage Examples

### Generate AugmentCode Configuration

```bash
# Generate only for AugmentCode
npx rulesync generate --augmentcode

# Generate with verbose output
npx rulesync generate --augmentcode --verbose

# Generate in specific directory
npx rulesync generate --augmentcode --base-dir ./packages/frontend
```

### Import Existing Configuration

```bash
# Import from modern AugmentCode setup
npx rulesync import --augmentcode

# Import from legacy format
npx rulesync import --augmentcode-legacy

# This imports from:
# - .augment/rules/*.md (modern format)
# - .augment-guidelines (legacy format)
```

## File Organization

### Standard Structure
```
.augment/
├── rules/
│   ├── project-overview.md      # Always-applied rules
│   ├── typescript-standards.md  # Auto-applied for TypeScript
│   ├── testing-guidelines.md    # Auto-applied for tests
│   ├── security-rules.md        # Auto-applied for security
│   └── deployment-tools.md      # Manual-only rules
├── mcp.json                     # MCP server configuration
└── legacy/
    └── .augment-guidelines      # Legacy format (if needed)
```

### Rule Examples

**Always-Applied Rule** (from root rule):
```yaml
---
type: always
description: "Project-wide development standards"
globs: ["**/*"]
---

# Project Development Standards

## Core Principles
- Clean code practices
- Comprehensive testing
- Security-first approach
- Performance optimization
```

**Auto-Applied Rule** (from non-root with description):
```yaml
---
type: auto
description: "TypeScript-specific coding guidelines and best practices"
globs: ["**/*.ts", "**/*.tsx"]
---

# TypeScript Guidelines

## Type Safety
- Use strict TypeScript configuration
- Avoid `any` type usage
- Implement proper interfaces

## Code Organization
- Export types and interfaces clearly
- Use barrel exports for modules
- Maintain consistent file naming
```

**Manual Rule** (from non-root without description):
```yaml
---
type: manual
globs: ["**/deploy/**", "**/scripts/**"]
---

# Deployment and Scripting Guidelines

## Deployment Process
- Use staging environment for testing
- Validate all configurations
- Implement rollback procedures

## Script Development
- Include error handling
- Add comprehensive logging
- Document script purposes
```

## Advanced Features

### Legacy Format Support

rulesync supports both modern and legacy AugmentCode formats:

**Legacy Import**:
```bash
# Import from legacy .augment-guidelines file
npx rulesync import --augmentcode-legacy
```

**Legacy Format** (`.augment-guidelines`):
```markdown
# Project Guidelines

## Development Standards
- Follow clean code principles
- Maintain comprehensive test coverage
- Use consistent formatting

## TypeScript Rules
- Enable strict mode
- Use meaningful type names
- Avoid any type usage
```

### Conditional Rule Application

**Context-Specific Rules**:
```yaml
---
type: auto
description: "API development and testing guidelines"
globs: ["**/api/**", "**/routes/**", "**/*.api.ts"]
---

# API Development Rules

Apply these guidelines when working on API endpoints and routing.
```

**Framework-Specific Rules**:
```yaml
---
type: auto  
description: "React component development patterns"
globs: ["**/*.tsx", "**/components/**"]
---

# React Component Guidelines

## Component Structure
- Use functional components with hooks
- Implement proper TypeScript interfaces
- Follow atomic design principles
```

## Migration Support

### From Legacy Format
1. **Automatic Detection**: rulesync detects legacy `.augment-guidelines` format
2. **Content Parsing**: Extracts rules from legacy Markdown content
3. **Type Assignment**: Assigns appropriate rule types based on content analysis
4. **Modern Generation**: Creates organized `.augment/rules/*.md` structure

### From Other Tools
1. **Multi-Tool Import**: Import rules from various AI tools
2. **Type Mapping**: Convert rule characteristics to AugmentCode types
3. **Content Adaptation**: Adjust rules for AugmentCode's context system
4. **Validation**: Ensure rules work effectively with AugmentCode

## Best Practices

### Rule Organization
1. **Type Selection**: Choose appropriate rule types based on usage patterns
2. **Clear Descriptions**: Use descriptive text for `auto` type rules
3. **Focused Content**: Keep rules specific to their intended context
4. **Regular Updates**: Maintain rules as project evolves

### Content Guidelines
1. **Actionable Rules**: Provide specific, implementable guidance
2. **Context Awareness**: Include relevant context for rule application
3. **Avoid Redundancy**: Don't duplicate information across rules
4. **Performance Optimization**: Use appropriate glob patterns

### Team Workflow
1. **Rule Reviews**: Include rule changes in code reviews
2. **Consistency Checks**: Ensure rules don't contradict each other
3. **Usage Monitoring**: Track effectiveness of different rule types
4. **Team Training**: Educate team on rule types and usage

## Integration Benefits

### Development Experience
- **Intelligent Assistance**: Auto rules activate when AI detects relevance
- **Flexible Control**: Manual rules provide explicit user control
- **Consistent Context**: Always rules provide persistent project understanding
- **Reduced Noise**: Appropriate rule types prevent context overload

### AI Enhancement
- **Context-Aware Rules**: Auto rules activate based on current work context
- **Performance Optimization**: Smart rule loading prevents unnecessary processing
- **Targeted Guidance**: Rules apply to appropriate file types and contexts
- **User Control**: Manual rules allow explicit guidance activation

## Troubleshooting

### Common Issues
1. **Rules Not Applied**: Check rule type and glob patterns
2. **Context Overload**: Use more specific rule types and patterns
3. **Performance Issues**: Optimize glob patterns and rule content
4. **Type Confusion**: Review rule type selection logic

### Debugging Steps
1. **Check File Structure**: Verify rules are in `.augment/rules/` directory
2. **Review Rule Types**: Ensure appropriate type selection
3. **Test Glob Patterns**: Verify patterns match intended files
4. **Monitor Performance**: Check impact on AI response times

## Configuration Examples

### Full-Stack Project
```yaml
---
type: always
description: "Full-stack development principles"
globs: ["**/*"]
---

# Full-Stack Development Standards

## Architecture
- Clean separation of concerns
- RESTful API design
- Component-based frontend

## Quality Standards
- Comprehensive testing
- Code review requirements  
- Documentation standards
```

### Microservices Architecture
```yaml
---
type: auto
description: "Microservices development and deployment guidelines"
globs: ["**/services/**", "**/microservices/**"]
---

# Microservices Guidelines

## Service Design
- Single responsibility principle
- API-first development
- Independent deployment

## Inter-Service Communication
- Use message queues for async operations
- Implement circuit breakers
- Monitor service health
```

### Testing-Focused Rules
```yaml
---
type: auto
description: "Comprehensive testing strategies and implementation"
globs: ["**/*.test.*", "**/*.spec.*", "**/tests/**"]
---

# Testing Guidelines

## Test Structure
- Follow AAA pattern (Arrange, Act, Assert)
- Use descriptive test names
- Test edge cases and error conditions

## Coverage Requirements
- Minimum 80% code coverage
- Unit tests for all business logic
- Integration tests for API endpoints
```

## See Also

- [Configuration](../configuration.md) - Frontmatter schema and rule options
- [Import Guide](../features/import.md) - Import existing configurations
- [Best Practices](../guides/best-practices.md) - Rule organization strategies