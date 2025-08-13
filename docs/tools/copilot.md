# GitHub Copilot Integration

## Overview

GitHub Copilot supports custom instructions through Markdown files with YAML frontmatter. rulesync generates organized instruction files that integrate seamlessly with Copilot's context system.

## Generated Files

| File Type | Output Path | Description |
|-----------|-------------|-------------|
| **Instructions** | `.github/instructions/*.instructions.md` | Custom instruction files |
| **Main Instructions** | `.github/copilot-instructions.md` | Primary instruction file (if single file preferred) |
| **MCP Configuration** | `.vscode/mcp.json` | Model Context Protocol servers |
| **Ignore Rules** | `.copilotignore` | File exclusion patterns (community tools) |

## Instruction Format

GitHub Copilot uses Markdown files with YAML frontmatter:

```markdown
---
type: instruction
description: "TypeScript coding standards for components"
patterns: ["**/*.tsx", "**/*.ts"]
---

# TypeScript Component Guidelines

## Coding Standards
- Use functional components with TypeScript
- Implement proper prop interfaces
- Use hooks for state management

## Naming Conventions
- PascalCase for components
- camelCase for functions and variables
- kebab-case for file names
```

## Rule Processing

### Root Rules
- **Target**: Combined into main instruction files
- **Format**: Standard frontmatter + Markdown content
- **Scope**: Project-wide guidelines

### Non-Root Rules
- **Target**: Individual `.instructions.md` files
- **Format**: Same frontmatter structure
- **Organization**: One file per rule category

## Usage Examples

### Generate Copilot Configuration

```bash
# Generate only for GitHub Copilot
npx rulesync generate --copilot

# Generate with verbose output
npx rulesync generate --copilot --verbose

# Generate in specific directory
npx rulesync generate --copilot --base-dir ./packages/frontend
```

### Import Existing Configuration

```bash
# Import from existing Copilot setup
npx rulesync import --copilot

# This imports from:
# - .github/copilot-instructions.md
# - .github/instructions/*.instructions.md
```

## Custom Instructions

### Instruction Types

**Project Standards**:
```yaml
---
type: instruction
description: "Project-wide development standards"
patterns: ["**/*"]
---

# Development Standards
Follow clean code principles and maintain consistent formatting.
```

**Language-Specific Rules**:
```yaml
---
type: instruction  
description: "Python coding guidelines"
patterns: ["**/*.py"]
---

# Python Guidelines
- Use type hints for all functions
- Follow PEP 8 style guidelines
- Write comprehensive docstrings
```

**Framework Guidelines**:
```yaml
---
type: instruction
description: "React component patterns"
patterns: ["**/*.tsx", "**/*.jsx"]
---

# React Component Guidelines
- Use functional components with hooks
- Implement proper error boundaries
- Follow atomic design principles
```

## File Organization

### Standard Structure
```
.github/
├── copilot-instructions.md          # Main instructions (optional)
└── instructions/
    ├── typescript-rules.instructions.md
    ├── testing-standards.instructions.md
    ├── security-guidelines.instructions.md
    └── api-patterns.instructions.md
```

### Rule Mapping
- **Root rules** → Combined main instructions or separate files
- **Non-root rules** → Individual instruction files
- **File patterns** → Mapped to `patterns` field in frontmatter

## Integration Benefits

### Development Experience
- **Context-Aware Suggestions**: Copilot understands project conventions
- **Consistent Code Quality**: Enforces standards across team
- **Reduced Review Time**: Code follows established patterns
- **Learning Acceleration**: New team members learn conventions faster

### Team Collaboration
- **Shared Standards**: All team members get same guidance
- **Version Control**: Instructions evolve with project
- **Documentation Integration**: Rules serve as living documentation
- **Onboarding Efficiency**: New developers get instant context

## Advanced Features

### Pattern Matching
```yaml
# Specific file types
patterns: ["**/*.test.ts", "**/*.spec.ts"]

# Directory targeting
patterns: ["src/components/**/*.tsx"]

# Multiple patterns
patterns: ["**/*.ts", "**/*.tsx", "!**/*.test.*"]
```

### Conditional Instructions
```yaml
---
type: instruction
description: "Database operations"
patterns: ["**/*database*", "**/*db*", "**/models/**"]
---

# Database Guidelines
Apply these rules when working with database-related code...
```

### Multi-Environment Support
```yaml
---
type: instruction
description: "Environment-specific configurations"
patterns: ["**/config/**", "**/.env*"]
---

# Configuration Guidelines
- Use environment variables for secrets
- Validate all configuration values
- Document configuration options
```

## Best Practices

### Instruction Design
1. **Clear Descriptions**: Write descriptive instruction titles
2. **Specific Patterns**: Target rules to relevant files
3. **Actionable Content**: Provide concrete, implementable guidance
4. **Regular Updates**: Keep instructions current with project evolution

### Performance Optimization
1. **Focused Patterns**: Use precise file patterns to reduce noise
2. **Relevant Content**: Include only applicable rules
3. **Avoid Redundancy**: Don't duplicate information across instructions
4. **Size Management**: Keep individual instruction files manageable

### Team Workflow
1. **Review Process**: Include instruction changes in code reviews
2. **Consistency Checks**: Ensure instructions don't contradict
3. **Usage Monitoring**: Track effectiveness of instruction guidance
4. **Feedback Integration**: Incorporate team feedback on instruction quality

## Troubleshooting

### Common Issues
1. **Instructions Not Applied**: Check file patterns match target files
2. **Conflicting Guidance**: Review instructions for contradictions
3. **Performance Impact**: Optimize file patterns and content
4. **Version Compatibility**: Ensure instructions work with Copilot version

### Debugging Steps
1. **Verify File Locations**: Check `.github/instructions/` directory
2. **Pattern Testing**: Test patterns against actual file paths
3. **Content Review**: Ensure instruction content is clear and actionable
4. **Copilot Logs**: Check Copilot output for instruction application

## Migration Strategies

### From Manual Instructions
1. **Audit Existing**: Review current `.github/copilot-instructions.md`
2. **Categorize Content**: Organize into logical rule categories
3. **Import to rulesync**: Use import command to convert
4. **Refine Organization**: Adjust rule structure as needed

### From Other Tools
1. **Multi-Tool Import**: Import rules from other AI tools
2. **Copilot Adaptation**: Adjust patterns and content for Copilot
3. **Testing Validation**: Verify instructions work effectively
4. **Team Training**: Educate team on new instruction system

## See Also

- [Configuration](../configuration.md) - Frontmatter schema and options
- [Import Guide](../features/import.md) - Import existing configurations
- [Best Practices](../guides/best-practices.md) - Instruction organization strategies