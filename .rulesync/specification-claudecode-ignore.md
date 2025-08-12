---
root: false
targets: ["*"]
description: "Claude Code settings.json permission.deny specification for security configuration"
globs: []
---

# Claude Code Settings Permission System Specification

## Overview
Claude Code uses a permission system in settings.json to control tool access and prevent specific actions for security purposes. This system provides fine-grained control over what Claude can and cannot do in your development environment.

## File Placement (Hierarchical Order)

### 1. Enterprise-Managed Policy (Highest Priority, Cannot be Overridden)
- **macOS**: `/Library/Application Support/ClaudeCode/managed-settings.json`
- **Linux/Windows WSL**: `/etc/claude-code/managed-settings.json`

### 2. Per-User Configuration (Applies to All Projects)
- **Location**: `~/.claude/settings.json`

### 3. Per-Project Configuration (Repository-Specific)
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
    "allow": [
      "rule3",
      "rule4"
    ],
    "additionalDirectories": [
      "/path/to/allowed/directory"
    ],
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

#### File Operations (Using Gitignore Patterns)
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

## Security-Focused Configuration Examples

### Complete Security Template
```json
{
  "permissions": {
    "deny": [
      "Bash(rm:*)",
      "Bash(sudo:*)",
      "Bash(curl:*)",
      "Bash(wget:*)",
      "Edit(.env*)",
      "Edit(**/*.pem)",
      "Edit(**/*.key)",
      "Edit(**/.ssh/**)",
      "Read(.env*)",
      "Read(**/*.pem)",
      "Read(**/*.key)",
      "Read(**/.ssh/**)",
      "WebFetch"
    ],
    "allow": [
      "Read(**/*.md)",
      "Read(**/*.ts)",
      "Read(**/*.tsx)",
      "Read(**/*.js)",
      "Read(**/*.jsx)",
      "Edit(**/*.ts)",
      "Edit(**/*.tsx)",
      "Edit(**/*.js)",
      "Edit(**/*.jsx)",
      "Bash(git status)",
      "Bash(git diff)",
      "Bash(npm run test:*)",
      "Bash(npm run lint:*)",
      "Glob",
      "Grep",
      "LS"
    ]
  }
}
```

### Framework-Specific Examples

#### Node.js Project Security
```json
{
  "permissions": {
    "deny": [
      "Edit(node_modules/**)",
      "Edit(package-lock.json)",
      "Edit(.env*)",
      "Bash(npm publish)",
      "Bash(rm:*)",
      "Read(.env*)",
      "Read(node_modules/**/.env*)"
    ],
    "allow": [
      "Bash(npm run:*)",
      "Bash(npm test:*)",
      "Bash(npm install:*)",
      "Edit(src/**)",
      "Read(src/**)"
    ]
  }
}
```

#### Python Project Security
```json
{
  "permissions": {
    "deny": [
      "Edit(.env*)",
      "Edit(venv/**)",
      "Edit(**/*.pyc)",
      "Bash(pip install:*)",
      "Bash(python -m pip install:*)",
      "Read(.env*)",
      "Read(**/__pycache__/**)"
    ],
    "allow": [
      "Bash(python -m pytest:*)",
      "Bash(python -m black:*)",
      "Edit(**/*.py)",
      "Read(**/*.py)"
    ]
  }
}
```

### Corporate/Enterprise Configuration
```json
{
  "permissions": {
    "deny": [
      "Edit(legal/**)",
      "Edit(compliance/**)",
      "Edit(audit/**)",
      "Edit(contracts/**)",
      "Edit(**/confidential/**)",
      "Edit(**/proprietary/**)",
      "Read(legal/**)",
      "Read(compliance/**)",
      "Read(customer-data/**)",
      "Read(pii/**)",
      "Bash(kubectl:*)",
      "Bash(docker run:*)",
      "Bash(sudo:*)",
      "WebFetch(domain:internal.company.com)"
    ],
    "allow": [
      "Edit(src/**)",
      "Edit(docs/**)",
      "Read(src/**)",
      "Read(docs/**)",
      "Bash(git:*)",
      "Bash(npm run:*)"
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
      "/path/to/additional/allowed/directory",
      "/workspace/temp"
    ]
  }
}
```

## Rule Behavior
- **Deny Always Wins**: If a tool matches both deny and allow rules, it is refused
- **Pattern Matching**: Uses gitignore-style patterns for file operations
- **Exact Matching**: Bash commands can use exact matching or prefix matching with `:*`

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

## Common Security Patterns

### Secrets Protection
```json
{
  "permissions": {
    "deny": [
      "Edit(.env*)",
      "Edit(**/*.pem)",
      "Edit(**/*.key)",
      "Edit(**/*.crt)",
      "Edit(**/*.p12)",
      "Edit(**/*.pfx)",
      "Edit(aws-credentials.json)",
      "Edit(gcp-service-account*.json)",
      "Edit(azure-credentials.json)",
      "Read(.env*)",
      "Read(**/*.pem)",
      "Read(**/*.key)",
      "Read(**/*.crt)",
      "Read(**/*.p12)",
      "Read(**/*.pfx)"
    ]
  }
}
```

### System Protection
```json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf:*)",
      "Bash(sudo:*)",
      "Bash(chmod 777:*)",
      "Bash(chown:*)",
      "Edit(/etc/**)",
      "Edit(/usr/**)",
      "Edit(/bin/**)",
      "Edit(/sbin/**)"
    ]
  }
}
```

### Network Security
```json
{
  "permissions": {
    "deny": [
      "WebFetch",
      "WebSearch",
      "Bash(curl:*)",
      "Bash(wget:*)",
      "Bash(nc:*)",
      "Bash(netcat:*)",
      "Bash(telnet:*)"
    ]
  }
}
```

### Development Safety
```json
{
  "permissions": {
    "deny": [
      "Bash(git push --force:*)",
      "Bash(git reset --hard:*)",
      "Bash(npm publish)",
      "Bash(yarn publish)",
      "Edit(package-lock.json)",
      "Edit(yarn.lock)",
      "Edit(pnpm-lock.yaml)"
    ]
  }
}
```

## Integration with Development Workflow

### CI/CD Pipeline Integration
```json
{
  "permissions": {
    "deny": [
      "Bash(docker push:*)",
      "Bash(kubectl apply:*)",
      "Bash(terraform apply:*)",
      "Edit(.github/workflows/**)",
      "Edit(.gitlab-ci.yml)",
      "Edit(Jenkinsfile)"
    ]
  }
}
```

### Code Review Safety
```json
{
  "permissions": {
    "deny": [
      "Edit(CODEOWNERS)",
      "Edit(.github/PULL_REQUEST_TEMPLATE.md)",
      "Bash(git push origin main)",
      "Bash(git merge --no-ff:*)"
    ]
  }
}
```

## Best Practices

### Security Guidelines
1. **Principle of Least Privilege**: Start with restrictive rules, gradually allow needed operations
2. **Layer Security**: Use multiple permission levels (enterprise, user, project)
3. **Regular Audits**: Review and update permission rules regularly
4. **Team Alignment**: Ensure all team members understand security policies
5. **Documentation**: Document rationale for permission rules

### Rule Management
1. **Specific Patterns**: Use specific patterns rather than broad tool blocking when possible
2. **Test Rules**: Validate permission rules work as expected
3. **Environment Separation**: Use different rules for development vs. production
4. **Version Control**: Track changes to permission configurations

### Team Collaboration
1. **Shared Standards**: Establish team standards for permission configurations
2. **Onboarding**: Include permission setup in developer onboarding
3. **Communication**: Clearly communicate security policies to team
4. **Regular Review**: Periodically review and update rules as needed

## Troubleshooting

### Common Issues
1. **Overly Restrictive Rules**: Start with minimal restrictions and add as needed
2. **Pattern Conflicts**: Review pattern precedence and specificity
3. **Tool Discovery**: Use `/permissions` to see current permission state
4. **Rule Testing**: Test permission rules in safe environment first

### Debugging Commands
```bash
# Check current permissions
/permissions

# View configuration
claude config list

# Test specific tool access
# (Attempt to use tool and observe if it's blocked)
```

## Migration and Compatibility

### From Other Security Systems
- Import existing ignore patterns from `.gitignore`
- Adapt file-based restrictions to Claude Code pattern syntax
- Consider security requirements from existing tools

### Upgrade Considerations
- Review permission rules when updating Claude Code
- Test existing configurations with new versions
- Update patterns as new tools are added

This specification provides comprehensive guidance for configuring Claude Code's permission system to maintain security while enabling productive AI-assisted development workflows.