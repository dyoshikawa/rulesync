---
root: false
targets: ["copilot"]
description: "GitHub Copilot Content exclusion feature specification"
globs: []
---

# GitHub Copilot Ignore File Specification

## Important Prerequisites

**GitHub Copilot does not have traditional "ignore files".**
- File-based ignore settings like `.gitignore` are not supported
- Instead, use the "Content exclusion" feature
- Settings are managed in YAML format on GitHub's Web UI

## Content Exclusion Specification

### Usage Requirements
- **Target Plans**: Copilot Business or Copilot Enterprise
- **Permissions**: Repository Admin / Organization Owner / Enterprise Owner
- **Target IDEs**: VS Code, Visual Studio, JetBrains IDEs, etc. (Vim completion only)
- **Reflection Time**: Automatically distributed within 30 minutes after setting changes

### Limitations
- Symbolic links cannot be used
- Type information inferentially obtained by IDEs cannot be completely blocked

## Setting Locations and Methods

### 1. Repository Settings (Most Common)
- **Location**: GitHub → Settings → Copilot → Content exclusion
- **Item**: "Paths to exclude in this repository"
- **Format**: YAML list format

### 2. Organization Settings
- **Location**: Organization Settings → Copilot → Content exclusion
- **Scope**: Applied to multiple repositories within the organization

### 3. Enterprise Settings
- **Location**: Enterprise Policies → Copilot → Content exclusion
- **Scope**: Applied to entire Enterprise

## YAML Configuration Syntax

### Basic Rules
- Each line in `- "pattern"` format (must be enclosed in quotes)
- Comments from `#` to end of line
- Case insensitive (fnmatch compliant)

### Path Patterns
- `Leading /` : Absolute path based on repository root
- `*` : Filename or arbitrary string for one level
- `**` : Arbitrary directories across hierarchies
- `?` : Any single character

### Repository Configuration Examples
```yaml
# Exclude specific file
- "/src/some-dir/kernel.rs"

# Exclude secrets.json wherever it is
- "secrets.json"

# Wildcard patterns
- "secret*"
- "*.cfg"

# Recursively exclude directory
- "/scripts/**"
```

### Organization/Enterprise Configuration Examples

#### Exclude arbitrary locations
```yaml
"*":
  - "/home/runner/.ssh/**"
  - "/etc/**"
```

#### Exclude only within specific repository
```yaml
https://github.com/org/example-repo.git:
  - "/internal/**"
  - "private*.md"
```

### Repository Reference Notes
- All formats HTTP(S) / git:// / SSH are supported
- Username and port numbers are ignored

## Verifying Setting Reflection

### VS Code
```
Command Palette → "Developer: Reload Window"
```

### Other IDEs
- Restart to obtain settings

## About Unofficial `.copilotignore`

### Community Implementations
- **mattickx/copilotignore-vscode** (VS Code extension)
- **panozzaj/vim-copilot-ignore** (Vim plugin)

### Limitations
- No official support
- Local Copilot disabling only
- No effect on other developers
- Not GitHub server-side exclusion

## Best Practices

### Security
1. Always exclude confidential information with Content exclusion
2. Set consistent exclusion rules at organization level
3. Regularly review exclusion settings

### Performance
1. Exclude large binary files and generated files
2. Exclude test fixtures and mock data
3. Exclude third-party libraries

### Management Operations
1. Document exclusion patterns
2. Share exclusion rules within team
3. Verify impact scope when changing settings

## Technical Specification Details
- **Pattern Matching**: fnmatch compliant
- **Character Encoding**: UTF-8
- **Path Separator**: `/` (unified even in Windows environment)
- **Maximum Settings**: Official limit unpublished (limited within practical range)