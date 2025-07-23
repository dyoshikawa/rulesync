---
root: false
targets: ['*']
description: "Cline rules specification"
globs: []
---

# Cline Rules

https://docs.cline.bot/features/cline-rules

## Overview
A mechanism to provide "system-level guidance" to Cline projects and conversations.

## File Format
- **Location**: `.clinerules/` directory or `Documents/Cline/Rules`
- **File Format**: Markdown files

## Creation Methods
1. Click the "+" button in Rules tab
2. Use `/new-rule` slash command in chat
3. Manually create Markdown files

## File Structure Best Practices
- Use clear and concise language
- Focus on expected results
- Organize rules by concern (e.g., documentation, coding standards)
- Control file order with numeric prefixes (optional)

## Subdirectory Support

### Directory Nesting
- **Current Status**: **No subdirectory support**
- **Limitation**: Cline only scans one level deep in `.clinerules/`
- **File Discovery**: Only `*.md` and `*.mdx` files directly in `.clinerules/` are loaded
- **Nested Files**: Files in subdirectories like `.clinerules/backend/api.md` are **ignored**

### Workarounds for Organization
- **Flat Structure**: Keep all rule files directly in `.clinerules/`
- **Rules Bank Pattern**: Use parallel directory like `clinerules-bank/` for organization
- **File Management**: Copy/move specific files to `.clinerules/` when needed
- **Naming Conventions**: Use descriptive prefixes or numeric prefixes for ordering

### File Organization Example
```
project/
├── .clinerules/           # Active rules (flat structure)
│   ├── 01-coding-style.md
│   ├── 02-api-patterns.md
│   └── 03-testing.md
└── clinerules-bank/       # Organized storage (not loaded)
    ├── backend/
    │   └── api-patterns.md
    └── frontend/
        └── component-guide.md
```

## Folder System Features
- Support multiple rule files within `.clinerules/`
- Can maintain inactive rule sets as "rules bank"
- Support context-specific rule activation
- Easy switching between project contexts

## Advanced Management Features
- Cline v3.13 introduces toggleable popover UI
- Instant display and switching of active rules
- Quick rule file creation and management functionality

## Implementation Tips
- Individual rule files should be focused
- Use descriptive file names
- Consider git-ignoring active `.clinerules/` folder
- Create team scripts for rule combinations