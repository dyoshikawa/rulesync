---
root: false
targets: ['*']
description: "Roo Code rules specification"
globs: []
---

# Roo Code Rules

https://docs.roocode.com/features/custom-instructions

## Overview
A mechanism to provide custom instructions to Roo Code for personalized behavior regarding coding style, workflow, and decision-making processes.

## File Format
- **Workspace-Wide**: `.roo/rules/` directory (preferred) or `.roorules` file
- **Mode-Specific**: `.roo/rules-{modeSlug}/` directory (preferred) or `.roorules-{modeSlug}` file
- **File Types**: Markdown (`.md`) or text (`.txt`) files

## Instruction Hierarchy
1. Language Preference
2. Global Instructions (via Prompts tab)
3. Mode-Specific Instructions
4. Mode-Specific Rule Files
5. Workspace-Wide Rule Files

## File Structure
```
.roo/
├── rules/
│   ├── coding-style.md
│   ├── testing.md
│   └── documentation.md
└── rules-typescript/
    ├── specific-patterns.md
    └── type-safety.md
```

## Subdirectory Support

### Unlimited Recursive Loading
- **Full Recursion**: Supports unlimited nesting depth within `.roo/rules/` directories
- **File Discovery**: Uses Node.js `fs.readdir(dir, {withFileTypes: true, recursive: true})`
- **No Depth Limit**: Only limited by OS path length (~260 chars on older Windows) or system resources
- **File Types**: Loads all files (binary files may cause issues - avoid swap files)

### File Processing Order
- **Sorting**: Files sorted by full relative path in lexicographical order (case-insensitive)
- **Directory Independence**: Subdirectory location doesn't affect precedence
- **Naming Control**: Use numeric prefixes (00-, 10-, 20-) to guarantee load order
- **Context Limits**: When combined rules exceed LLM context window, oldest (alphabetically-first) rules are truncated

### Directory Organization Examples
```
.roo/
├── rules/
│   ├── 00-global-standards.md    # Loaded first (numeric prefix)
│   ├── security/
│   │   ├── 10-auth-policy.md     # Loaded by numeric prefix
│   │   └── db/
│   │       └── encryption.md     # Deep nesting supported
│   ├── api/
│   │   ├── contracts.md
│   │   └── validation.md
│   └── frontend/
│       ├── components.md
│       └── styling.md
└── rules-typescript/             # Mode-specific rules
    ├── 00-type-safety.md
    └── patterns/
        └── react-hooks.md
```

### Best Practices for Deep Organization
- **Numeric Prefixes**: Use `00-`, `10-`, `20-` to control load order across directories
- **Focused Files**: Keep individual rule files small and focused
- **Clean Environment**: Avoid editor swap files (`.swp`, temporary files) in rules directories
- **Monitor Context**: Large rule sets may exceed model context limits

## Features
- Recursive file loading from directories
- Alphabetical file processing order
- Complementary rule interaction
- Team-standardized rule sharing via version control
- Mode-specific customization support

## Best Practices
- Use directory-based methods for team standardization
- Organize instructions into multiple focused files
- Provide clear, specific guidance
- Version control rule files for team consistency
- Combine with Custom Modes for specialized environments