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