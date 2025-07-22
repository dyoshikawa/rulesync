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

## Features
- Combine instructions from multiple files
- Support variables like `${workspaceFolder}`
- Not used in code completion (chat only)

## Best Practices
- Keep instructions short and specific
- Avoid references to external resources
- Split into multiple files by functionality