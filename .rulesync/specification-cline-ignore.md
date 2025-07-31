---
root: false
targets: ["cline"]
description: "Specification document for Cline VSCode Extension .clineignore file"
globs: ["**/.clineignore"]
---

# Cline VSCode Extension Ignore File Specification

## File Location and Filename

### File Path
- **Location**: Workspace root folder
  - Top-level folder opened in VS Code
  - Same level as `.vscode` folder
- **Multi-root workspace**: Can be placed in each root (applies only to that root)
- **Global settings**: Currently not supported

### Filename
- **`.clineignore`** (exact match, case-sensitive)
- Alternative names or extensions (e.g., `.clineignore.txt`) are invalid

## File Content Specification

### Basic Syntax (same as `.gitignore`)
- 1 line = 1 pattern
- Empty lines are ignored
- UTF-8 (without BOM) recommended

### Wildcards
- `*` : 0 or more characters
- `?` : Any single character  
- `[...]` : Character set/range
- `**` : Any level of directories (double star)

### Special Symbols
- `Trailing /` : Directory specification (ignore entire folder)
- `!pattern` : Negation (cancels previous ignore setting)
- `#` : Comment line
- `Leading /` : Root-relative path
- No slash : Matches from anywhere

### Basic Examples
```
# Example: .clineignore
# All logs
*.log

# Ignore dependency modules
node_modules/

# Ignore temp folder hierarchy
temp/**

# But include important.log
!important.log
```

## Behavior in Cline

### Immediate Reflection
- Watched immediately when saved in VS Code, applied without restart

### Access Control
- Content reading tools like `read_file` are completely blocked
- Shows "ignored" error message when accessed

### Display in File Lists
- File names are displayed when listing directories with `list_files`, etc.
- Ignored files are marked with a lock icon (🔒)

### Scope of Impact
- Ignore settings only affect Cline
- Does not impact Git or other extensions

## Best Practices

1. **Setup Immediately After Project Creation**
   - Exclude large generated artifacts like `node_modules` and `build/`

2. **Protect Sensitive Information**
   - Always exclude `.env`, `secret.json`, etc.

3. **Performance Optimization**
   - For large repositories, list items like `**/test-fixtures/**` and `**/*.snap`
   - List assets that don't need to be read by AI

## Benefits
- Privacy protection
- Performance improvement (better prompt count and response speed)