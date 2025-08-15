---
root: false
targets: ['*']
description: "GitHub Copilot custom instructions specification"
globs: []
---

# GitHub Copilot Custom Instructions

https://code.visualstudio.com/docs/copilot/copilot-customization

## Overview
A mechanism to provide custom instructions to GitHub Copilot in VS Code. Automatically applied to chat requests.

## File Format
- **Workspace**: `.github/copilot-instructions.md`
  - Automatically applied to all chat requests
  - Requires `github.copilot.chat.codeGeneration.useInstructionFiles` setting
- **Project**: `.github/instructions/*.instructions.md`
  - Can specify file application scope with glob patterns
  - Can reference other instruction files

## File Structure
```markdown
---
description: "Brief file description"
applyTo: "**"  # Glob pattern
---

Natural language instruction content
```

## Subdirectory Support

### Directory Nesting (VS Code Only)
- **Default Behavior**: **No subdirectory support** - only scans `.github/instructions/` (non-recursive)
- **Configuration Required**: Must explicitly enable subdirectories using `chat.instructionsFilesLocations` setting
- **Platform Limitation**: Only available in VS Code, not GitHub.com, Visual Studio, or JetBrains IDEs

### Enabling Subdirectory Support
Configure in VS Code settings.json:
```json
{
  "chat.instructionsFilesLocations": {
    ".github/instructions/**": true,           // All subdirectories
    ".github/instructions/backend": true,      // Specific subdirectory
    "src/frontend/instructions": false         // Disabled folder
  }
}
```

### Cross-Platform Compatibility
- **VS Code**: Supports subdirectories with configuration
- **GitHub.com**: Only honors `.github/copilot-instructions.md` (single file)
- **Visual Studio**: Only honors `.github/copilot-instructions.md` (single file)
- **JetBrains IDEs**: Only honors `.github/copilot-instructions.md` (single file)

### File Organization Examples
```
.github/
├── copilot-instructions.md     # Universal (all platforms)
└── instructions/               # VS Code only
    ├── general.instructions.md # Default location
    ├── backend/                # Requires configuration
    │   └── api.instructions.md
    └── frontend/               # Requires configuration
        └── ui.instructions.md
```

## Features
- Combine instructions from multiple files
- Support variables like `${workspaceFolder}`
- Not used in code completion (chat only)

## Best Practices
- Keep instructions short and specific
- Avoid references to external resources
- Split into multiple files by functionality