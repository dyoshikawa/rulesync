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

## Subdirectory Support

### Multi-Level Directory Structure
- **Nesting Pattern**: Multiple `.cursor/rules/` folders at different directory levels (not subdirectories within a single rules folder)
- **File Discovery**: Only files directly inside each `.cursor/rules/` folder are loaded
- **No Sub-folders**: Files in `.cursor/rules/some-group/xyz.mdc` are **ignored**

### File Organization Structure
```
project/
├── .cursor/
│   └── rules/                 # Project-wide rules (flat)
│       ├── global-style.mdc
│       └── project-standards.mdc
├── packages/
│   ├── api/
│   │   └── .cursor/
│   │       └── rules/         # API-specific rules (flat)
│   │           └── api-contracts.mdc
│   └── web/
│       └── .cursor/
│           └── rules/         # Web-specific rules (flat)
│               ├── react.mdc
│               └── tailwind.mdc
└── scripts/
    └── deploy/
        └── .cursor/
            └── rules/         # Deploy-specific rules (flat)
                └── deploy-checklist.mdc
```

### Rule Discovery Mechanism
1. **Current File Context**: Cursor looks at the currently open file's directory path
2. **Ancestor Scanning**: Walks up the directory tree checking for `.cursor/rules/` folders
3. **Rule Merging**: Combines rules from project root and closest ancestor directories
4. **Relevance Filtering**: AI evaluates description and globs to determine applicable rules

### Nesting Depth and Performance
- **No Depth Limit**: Supports unlimited nesting levels in monorepos
- **Efficient Scanning**: Only checks current file's path ancestry, not entire tree
- **File Watching**: Changes reflected within ~1 second via file system watcher

### Precedence and Conflicts
- **No Automatic Precedence**: "Closer" rules are not automatically higher priority
- **AI Evaluation**: Model evaluates all relevant rules and may use any subset
- **Explicit Control**: Use `alwaysApply: true` or specific `globs` patterns to guarantee inclusion
- **Discovery Order**: Nearest-folder rules processed first, followed by root rules

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