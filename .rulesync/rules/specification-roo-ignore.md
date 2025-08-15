---
root: false
targets: ["*"]
description: "Roocode AI Coding Assistant .rooignore file specification"
globs: []
---

# Roocode AI Coding Assistant Ignore File Specification

## File Placement and File Names

### File Path
- **Placement**: Only one file directly under VS Code workspace root
- **Structure example**:
  ```
  project-root/
  ├─ src/
  ├─ .git/
  └─ .rooignore
  ```
- **Limitation**: `.rooignore` files placed in subdirectories are ignored
- **Self-protection**: `.rooignore` itself is always implicitly ignored

### File Name
- **`.rooignore`** (leading dot, no extension)
- **Support started**: Official support in Roocode 3.8 (2025-03-13)

## File Content Specification

### Basic Syntax (Fully compatible with `.gitignore`)
- One pattern per line
- Paths are relative from workspace root
- UTF-8 encoding recommended

### Wildcards and Patterns
- `*` : Zero or more characters
- `?` : Single character
- `**` : Recursive match across directory hierarchies
- `Trailing /` : Directory specification (ignores everything under that directory)
- `Leading /` : Root-anchored (targets only directly under root)

### Special Symbols
- `!pattern` : Negation (cancels previous rule)
- `#` : Comment (from line start to end)
- Empty lines : Treated as separators

### Sample
```
# Dependencies and build artifacts
node_modules/
dist/
build/

# Logs & binaries
*.log
*.png
*.pdf

# Confidential information
.env*
config/secret.json

# Exception: keep specific logs
!important.log
```

## Ignored Scenarios

### Strictly Blocked (Both read and write prohibited)
- `read_file`
- `write_to_file`
- `apply_diff`
- `insert_content`
- `search_and_replace`
- `list_code_definition_names`

### File Listing and Directory Attachment
- `list_files` tool: Omits ignored targets
- `@directory` attachment: Excludes ignored targets or displays 🔒 mark
  - Display setting: When `showRooIgnoredFiles=true`

### Command Execution
- `execute_command`: Ignored targets are blocked even with read-type subcommands like `cat` and `grep`

## Relationship with @ Mentions

### Directory Mentions
- `@directory`: `.rooignore` is respected from v3.17 (2025-05-14) onwards
- Ignored files are excluded from attachment content or displayed with 🔒

### Individual File Mentions
- `@/path/to/file`: Explicit naming bypasses `.rooignore`
- Considered as user explicitly requesting "look at this file"
- Recommended practice: fundamentally avoid mentioning confidential files

## Best Practices

1. **Large File Countermeasures**
   - Early ignore specification for files over 40KB, images/videos
   - Prevents LLM context overflow

2. **Security Enhancement**
   - For important binaries and secret keys, consider separate repository management or encryption in addition to `.rooignore`

3. **Immediate Reflection**
   - Updates to `.rooignore` are reflected immediately upon saving
   - No extension restart required

4. **Additional Protection**
   - If placement at root is not possible, strengthen protection by turning OFF `allowIgnored` option

## Important Notes
- Support from Roocode 3.8 onwards
- `.rooignore` outside workspace root is invalid
- Explicit file mentions bypass ignore settings