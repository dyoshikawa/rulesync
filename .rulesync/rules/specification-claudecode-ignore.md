---
root: false
targets: ["*"]
description: Claude Code settings.json permission.deny specification for security configuration
globs: []
---

# Claude Code settings.json permission.deny Specification

## Overview
Claude Code uses permission.deny in settings.json to control tool access and prevent specific actions for security purposes.

## File Placement (Hierarchical Order)

### 1. Enterprise-Managed Policy (highest priority, cannot be overridden)
- **macOS**: `/Library/Application Support/ClaudeCode/managed-settings.json`
- **Linux/Windows WSL**: `/etc/claude-code/managed-settings.json`

### 2. Per-User Configuration (applies to all projects)
- **Location**: `~/.claude/settings.json`

### 3. Per-Project Configuration (repository-specific)
- **Shared**: `.claude/settings.json` (committed to VCS)
- **Local**: `.claude/settings.local.json` (developer-only, auto-gitignored)

### Precedence Order
Enterprise → CLI flags → `.claude/settings.local.json` → `.claude/settings.json` → `~/.claude/settings.json`

## JSON Structure
```json
{
  "permissions": {
    "deny": [
      "rule1",
      "rule2"
    ],
    "allow": [],
    "additionalDirectories": [],
    "defaultMode": "string"
  }
}
```

## Permission Rule Grammar

### Tool Blocking Syntax
```
ToolName(optional-specifier)
```

### Complete Tool Blocking
- `"WebFetch"` - Blocks all web requests
- `"Bash"` - Blocks all shell commands
- `"Edit"` - Blocks all file edits
- `"Read"` - Blocks all file reads

### Selective Tool Blocking

#### Bash Commands
- `"Bash(<exact-command>)"` - Blocks exact command
- `"Bash(<prefix>:*)"` - Blocks commands starting with prefix

Examples:
- `"Bash(curl:*)"` - Blocks all curl commands
- `"Bash(npm run deploy)"` - Blocks exact command
- `"Bash(sudo:*)"` - Blocks all sudo commands
- `"Bash(rm -rf /*)"` - Blocks dangerous deletion

#### File Operations (using gitignore patterns)
- `"Edit(<gitignore-pattern>)"` - Blocks edits matching pattern
- `"Read(<gitignore-pattern>)"` - Blocks reads matching pattern

Examples:
- `"Edit(docs/**)"` - Blocks edits under docs directory
- `"Read(~/.ssh/*)"` - Blocks reading SSH directory
- `"Edit(src/**)"` - Blocks edits to source code

#### Web Operations
- `"WebFetch(domain:<domain>)"` - Blocks requests to specific domain

Examples:
- `"WebFetch(domain:example.com)"` - Blocks requests to example.com

#### MCP Tools
- `"mcp__server"` - Blocks entire MCP server
- `"mcp__server__tool"` - Blocks specific MCP tool

## Configuration Examples

### Network Security Configuration
```json
{
  "permissions": {
    "deny": [
      "WebFetch",
      "WebSearch",
      "Bash(curl:*)",
      "Bash(wget:*)"
    ]
  }
}
```

### Development Environment Protection
```json
{
  "permissions": {
    "deny": [
      "Edit(src/**)",
      "Bash(rm:*)",
      "Bash(sudo:*)"
    ],
    "allow": [
      "Bash(npm run test:*)",
      "Bash(npm run lint)"
    ],
    "defaultMode": "acceptEdits"
  }
}
```

### Enterprise Security Policy
```json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf /*)",
      "Bash(sudo:*)",
      "Bash(kubectl apply:*)",
      "Bash(docker run:*)",
      "Edit(/etc/**)",
      "Read(~/.ssh/**)",
      "WebFetch(domain:internal.company.com)"
    ]
  }
}
```

### Repository-Specific Restrictions
```json
{
  "permissions": {
    "deny": [
      "Edit(production/**)",
      "Edit(config/secrets/**)",
      "Bash(npm publish)",
      "Bash(git push origin main)"
    ]
  }
}
```

## Advanced Features

### Default Mode Options
- `"defaultMode": "acceptEdits"` - Auto-accept file edit operations
- `"defaultMode": "denyAll"` - Deny all operations by default

### Additional Directories
```json
{
  "permissions": {
    "additionalDirectories": [
      "/path/to/additional/allowed/directory"
    ]
  }
}
```

## Rule Behavior
- **Deny always wins**: If a tool matches both deny and allow rules, it is refused
- **Pattern matching**: Uses gitignore-style patterns for file operations
- **Exact matching**: Bash commands can use exact matching or prefix matching with `:*`

## Validation and Testing

### Check Current Configuration
```bash
claude config list
```

### View Permissions in REPL
```
/permissions
```

### Test Denied Actions
Attempt to trigger a denied action - Claude will refuse and mention the blocking rule.

## Best Practices
- Use enterprise policy for organization-wide security requirements
- Use per-project settings for repository-specific restrictions
- Keep sensitive configurations in local settings for individual developers
- Test permission rules before deploying to ensure they work as expected
- Use specific patterns rather than broad tool blocking when possible
- Document permission rules for team understanding