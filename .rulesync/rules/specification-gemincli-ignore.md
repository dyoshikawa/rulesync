---
root: false
targets: ["*"]
description: "Gemini CLI Coding Assistant .aiexclude file specification"
globs: []
---

# Gemini CLI Coding Assistant Ignore File Specification

## File Placement and File Names

### Supported Ignore Files

#### 1. `.aiexclude` (Recommended)
- **Placement**: Any directory within the project
- **Scope**: Affects the directory itself and all subdirectories
- **Multiple placement**: Possible (merged from search start directory up to root)
- **Priority**: Lower level (deeper hierarchy) settings take precedence

#### 2. `.gitignore` (Preview feature)
- **Placement**: Only at root working folder (where Gemini CLI is launched)
- **Limitation**: `.gitignore` files in subdirectories are ignored
- **Setting**: Can be toggled on/off with "Context Exclusion Gitignore"

### Priority Rules
- When conflicts occur in the same file, `.aiexclude` takes precedence over `.gitignore`

## File Content Specification

### Basic Syntax (Same as `.gitignore`)
- Empty lines are ignored
- Lines starting with `#` are comments
- One pattern per line to specify target paths

### Wildcards and Patterns
- `*` : Matches any length of characters except delimiter (`/`)
- `**` : Matches any depth across `/` delimiters
- `?` : Matches any single character
- `Leading /` : Absolute specification from the directory containing `.aiexclude`
- `Trailing /` : Specifies entire directory
- `Leading !` : Negation (exclusion removal)

### Basic Examples
```
# Secret keys and API keys
apikeys.txt
*.key
/secret.env

# Entire directories
my/sensitive/dir/

# Negation patterns (behavior may vary by environment)
foo/*
!foo/README.md
```

### Important Notes: Negation Patterns
- Firebase Studio/IDX does not support negation patterns (`!`)
- Gemini Code Assist proper supports them
- CLI environment requires testing confirmation

## Special Cases

### Empty `.aiexclude`
- Firebase Studio/IDX: Equivalent to `**/*` (blocks everything)
- Negation patterns cannot be used

### VS Code Extension Integration
- Customizable via Extensions > Gemini Code Assist > Context Exclusion File
- CLI references extension-side settings

## Gemini CLI Workflow

### Basic Steps
1. Place `.gitignore` (optional) and `.aiexclude` (recommended) at project root
2. Add additional `.aiexclude` files in subdirectories as needed
3. Set current directory as "project root" when running CLI
4. Verify exclusion settings (diagnostic command planned for future preview version)

### Diagnostic Command (Planned)
```bash
# Planned for preview version v0.2 and later
gemini context list-excluded
```

## Best Practices

### Security First
- Manage API keys, secret keys, and internal code in top-level `.aiexclude`
- Clearly exclude anything you "absolutely don't want passed to the model"

### Performance Optimization
- Include libraries, generated code, and build artifacts in `.gitignore` as well
- Unify management between Git and Gemini

### Complex Rule Management
- Adopt the pattern "broadly block → selectively restore needed items with `!`"
- However, negation pattern behavior verification is required

### Safety First
- Initially exclude files you're unsure about
- Gradually restore individual items with `!` as needed

## Version Information
- Foundation: Gemini Code Assist
- Current: CLI v0.1 (manual verification only)
- Planned: Diagnostic functionality added in v0.2 and later