---
root: false
targets: ["cursor"]
description: "Cursor IDE .cursorignore and .cursorindexingignore file specification"
globs: ["**/.cursorignore", "**/.cursorindexingignore"]
---

# Cursor IDE Ignore File Specification

## File Placement and File Names

### Project-Level Ignore Files
- **`.cursorignore`** 
  - Placement: Workspace/project root directory
  - Effect: Excluded from both indexing and AI features

- **`.cursorindexingignore`**
  - Placement: Workspace/project root directory  
  - Effect: Excluded from indexing only, still accessible to AI features

### Hierarchical Ignore Settings
- Setting: Enable "Hierarchical Cursor Ignore" in Settings › Features › Editor
- Effect: Combines multiple `.cursorignore` files from root to parent directories

### Global Ignore Settings
- Setting: "Global Ignore Files" in app settings
- Effect: Applied commonly to all projects

## File Content Specification

### Syntax (Same as `.gitignore`)
- Empty lines are ignored
- Comments from `#` to end of line
- Patterns are relative paths based on `.cursorignore` placement location
- Later patterns take precedence (last wins)

### Pattern Matching Rules
- `Trailing /` : Directory specification
- `!` : Negation (removes ignore)
- `*` : Any zero or more characters (excluding slash)
- `**` : Cross any hierarchical directories
- `?` : Any single character
- `[abc]` : Character class

### Basic Examples
```
# Specific file
config.json

# Entire directory
dist/

# File extension
*.log
```

### Advanced Examples
```
# Ignore everything first
*

# Restore only app/
!app/

# Ignore logs folder across entire tree
**/logs
```

## Files Ignored by Default

Cursor automatically excludes:
1. Items listed in root `.gitignore`
2. Default Ignore List:
   - `node_modules/`
   - `package-lock.json`
   - `*.lock`
   - `.env*`
   - Various image/video/binary files

## Behavior by File Type

| File                       | Indexing | AI Feature Access |
|----------------------------|----------|-------------------|
| `.cursorignore`            | Excluded | Excluded          |
| `.cursorindexingignore`    | Excluded | Accessible        |

## Troubleshooting

How to verify exclusion settings:
```bash
git check-ignore -v <path/to/file>
```

## Important Notes
- When calling Terminal or external tools from Chat, `.cursorignore` is not fully enforced
- It's important to verify that exclusions are working as intended