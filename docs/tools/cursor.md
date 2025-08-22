# Cursor Integration

## Overview

Cursor supports advanced rule types and MDC (Markdown with YAML frontmatter) format. rulesync provides intelligent rule type detection and generation for Cursor's project rules system.

## Generated Files

| File Type | Output Path | Description |
|-----------|-------------|-------------|
| **Project Rules** | `.cursor/rules/*.mdc` | Rule files in MDC format |
| **Legacy Rules** | `.cursorrules` | Single-file legacy format (if needed) |
| **MCP Configuration** | `.cursor/mcp.json` | Model Context Protocol servers |
| **Ignore Rules** | `.cursorignore` | File exclusion patterns |

## Rule Types

Cursor supports four distinct rule application modes:

### 1. Always Rules (`cursorRuleType: always`)
- **When**: Rules applied constantly across entire project
- **Generated From**: Root rules (`root: true`) in rulesync
- **Behavior**: Persistent context for all AI interactions

### 2. Specific Files Rules (`cursorRuleType: specificFiles`)
- **When**: Rules applied to files matching glob patterns
- **Generated From**: Non-root rules with `globs` specified
- **Behavior**: Automatic application based on file patterns

### 3. Intelligent Rules (`cursorRuleType: intelligently`)
- **When**: AI determines when rules are relevant
- **Generated From**: Non-root rules with `description` but empty `globs`
- **Behavior**: Context-aware rule application

### 4. Manual Rules (`cursorRuleType: manual`)
- **When**: Rules applied only when manually invoked
- **Generated From**: Non-root rules with empty `description` and `globs`
- **Behavior**: Explicit user control

## MDC Format

Cursor uses MDC (Markdown with YAML frontmatter) format:

```markdown
---
alwaysApply: true
description: "TypeScript coding standards"
globs: ["**/*.ts", "**/*.tsx"]
---

# TypeScript Rules

- Use strict TypeScript configuration
- Prefer interfaces over types for object shapes
- Use meaningful variable names
```

## Rule Processing Logic

rulesync automatically determines appropriate `cursorRuleType` based on rule content:

### Detection Rules
1. **`alwaysApply: true`** → `cursorRuleType: always`
2. **Non-empty globs** → `cursorRuleType: specificFiles`
3. **Non-empty description + empty globs** → `cursorRuleType: intelligently`
4. **Empty description + empty globs** → `cursorRuleType: manual`

### Edge Cases
- **Non-empty description + non-empty globs**: Processed as `specificFiles` (globs take priority)
- **No matching conditions**: Processed as `manual` (default)

## Import Support

### Supported Source Files
- `.cursorrules` (legacy single-file format)
- `.cursor/rules/*.mdc` (modern MDC format)
- `.cursorignore` (ignore patterns)
- `.cursor/mcp.json` (MCP server configuration)

### Import Process
```bash
# Import existing Cursor configuration
npx rulesync import --cursor

# Converts:
# - .cursorrules → .rulesync/*.md with appropriate rule types
# - .cursor/rules/*.mdc → .rulesync/*.md with preserved metadata
# - .cursorignore → .rulesyncignore patterns
# - .cursor/mcp.json → .rulesync/.mcp.json
```

## Usage Examples

### Generate Cursor Configuration

```bash
# Generate only for Cursor (new preferred syntax)
npx rulesync generate --targets cursor

# Generate with clean build (new syntax)
npx rulesync generate --targets cursor --delete

# Generate in specific directory (new syntax)
npx rulesync generate --targets cursor --base-dir ./packages/frontend

# Legacy syntax (still works with deprecation warning)
npx rulesync generate --cursor
npx rulesync generate --cursor --delete
```

### Rule Examples

**Always-Apply Rule** (from root rule):
```yaml
---
root: true
targets: ["cursor"]
description: "Project-wide TypeScript standards"
globs: ["**/*"]
---

# Project Standards
Use TypeScript strict mode for all files.
```

**Specific Files Rule** (from non-root rule):
```yaml
---
targets: ["cursor"]
globs: ["**/*.test.ts"]
cursorRuleType: "specificFiles"
---

# Testing Rules
Use Jest and Testing Library for all tests.
```

## Advanced Features

### Custom Rule Types
You can override automatic rule type detection:

```yaml
---
targets: ["cursor"] 
cursorRuleType: "intelligently"  # Force intelligent mode
description: "Component testing patterns"
---
```

### Multi-Target Rules
Rules can target multiple tools while maintaining Cursor-specific behavior:

```yaml
---
targets: ["cursor", "copilot", "cline"]
cursorRuleType: "specificFiles"
globs: ["**/*.tsx"]
---
```

## Best Practices

### Rule Organization
1. **Use Always Rules Sparingly**: Only for truly project-wide standards
2. **Leverage Specific Files**: Target rules to relevant file patterns
3. **Intelligent Rules for Context**: Use for workflow-specific guidance
4. **Manual Rules for Tools**: Commands and utilities

### Performance Optimization
1. **Specific Glob Patterns**: Use precise patterns to reduce noise
2. **Focused Descriptions**: Clear, concise rule descriptions
3. **Avoid Rule Conflicts**: Ensure rules don't contradict each other

### Team Collaboration
1. **Consistent Rule Types**: Establish team standards for rule application
2. **Regular Reviews**: Update rules as project evolves  
3. **Documentation**: Comment complex rule logic

## Migration Guide

### From Legacy .cursorrules
1. **Import Existing**: `npx rulesync import --cursor`
2. **Review Generated Rules**: Check `.rulesync/` directory
3. **Refine Rule Types**: Adjust `cursorRuleType` if needed
4. **Generate New Config**: `npx rulesync generate --targets cursor`

### From Other AI Tools
1. **Import Multiple Sources**: Import from other tools first
2. **Merge Rules**: Consolidate into unified rule files
3. **Cursor-Specific Tuning**: Add `cursorRuleType` fields as needed
4. **Test Rule Application**: Verify rules work as expected

## Troubleshooting

### Common Issues
1. **Rules Not Applied**: Check glob patterns match target files
2. **Unexpected Behavior**: Review `cursorRuleType` selection logic
3. **Performance Issues**: Narrow glob patterns or use manual rules
4. **Rule Conflicts**: Ensure rules have clear precedence

### Debugging Steps
1. **Check Generated MDC**: Review `.cursor/rules/*.mdc` files
2. **Verify Glob Patterns**: Test patterns against actual file paths
3. **Rule Type Validation**: Ensure appropriate `cursorRuleType` selection
4. **Import Validation**: Check imported rules maintain correct structure

## See Also

- [Configuration](../configuration.md) - Frontmatter schema and options
- [Import Guide](../features/import.md) - Detailed import process
- [Best Practices](../guides/best-practices.md) - Rule organization strategies