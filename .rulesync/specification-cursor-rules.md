---
root: false
targets: ['*']
description: "Cursor project rules specification"
globs: []
---

# Cursor Project Rules

https://docs.cursor.com/context/rules

## Overview
A mechanism to provide project-specific rules and context to Cursor's AI model.

## File Format
- **Location**: `.cursor/rules/` directory
- **Extension**: `.mdc` (Markdown with Context)
- Nested `.cursor/rules` in subdirectories is also possible

## Rule Types
1. **Always**: Always included in model context
2. **Auto Attached**: Applied when files matching glob pattern are referenced
3. **Agent Requested**: Applied when AI determines it's needed (description required)
4. **Manual**: Applied only when explicitly referenced with `@ruleName`

## File Structure
```markdown
---
description: "RPC Service boilerplate"
globs: "**/*.rpc.ts"
alwaysApply: false
---

- Use internal RPC pattern when defining services
- Always use snake_case for service names

@service-template.ts
```

## Features
- Can reference additional files with `@filename`
- Support project-wide and subdirectory-specific rules
- Used for recording domain knowledge, workflow automation, and coding standardization

## Best Practices
- Keep rules concise (500 lines or less recommended)
- Split large concepts into multiple rules
- Include specific examples