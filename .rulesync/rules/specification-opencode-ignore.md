---
root: false
targets: ["*"]
description: "OpenCode file exclusion and ignore patterns for controlling AI access to sensitive files"
globs: []
---

# OpenCode Ignore Files and Security Configuration Specification

## Overview
OpenCode uses Git-based file exclusion patterns and security configurations to control which files the AI can access. The system relies primarily on `.gitignore` patterns and permission controls rather than dedicated ignore files.

## File Exclusion Mechanisms

### 1. Git Integration (.gitignore)

#### Automatic Exclusion
- **Primary Method**: OpenCode automatically respects `.gitignore` patterns
- **Behavior**: Files ignored by Git are automatically excluded from AI context
- **Scope**: Repository-wide exclusion following Git ignore rules
- **No Duplication**: No need to maintain separate ignore files

#### Standard .gitignore Integration
OpenCode follows standard Git ignore patterns:
```gitignore
# Dependencies
node_modules/
.pnpm-store/
.yarn/

# Build artifacts
dist/
build/
out/
target/

# Environment files
.env
.env.*
!.env.example

# Logs and temporary files
*.log
*.tmp
.cache/

# IDE and editor files
.vscode/settings.json
.idea/
*.swp
*.swo
```

### 2. Built-in Security Patterns

#### Default Exclusions
OpenCode has built-in intelligence to avoid certain file types and directories:
- **Dependencies**: `node_modules/`, `vendor/`, `.pnpm-store/`
- **Hidden Files**: Files and directories starting with `.`
- **Build Artifacts**: Common build output directories
- **System Files**: OS-specific temporary and system files

#### Smart Context Loading
- **Selective Reading**: Only loads relevant files based on context
- **Size Limits**: Automatically excludes very large files
- **Binary Detection**: Skips binary files and media content
- **Performance Optimization**: Prioritizes source code and documentation

## Permission-Based Controls

### 1. Configuration via opencode.json

#### Permission Settings
```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "write": "ask",
    "run": "ask",
    "read": "allow"
  }
}
```

#### Permission Levels
- **allow**: Automatically permitted
- **ask**: Prompt user for confirmation
- **deny**: Always blocked

#### File Operation Controls
```json
{
  "permission": {
    "write": {
      "default": "ask",
      "patterns": {
        "*.md": "allow",
        "src/**/*.ts": "allow",
        ".env*": "deny",
        "package.json": "ask"
      }
    },
    "read": {
      "default": "allow",
      "patterns": {
        ".env*": "deny",
        "secrets/**": "deny",
        "*.key": "deny"
      }
    }
  }
}
```

### 2. Runtime Security Guards

#### AI Guard-rails in AGENTS.md
```markdown
## AI Guard-rails
* Never change code under `packages/generated/**`
* Ask before running shell commands that modify prod data
* Don't access files in `secrets/` or `.env*`
* Avoid reading binary files or large datasets
```

#### Command Restrictions
```markdown
## Security Guidelines
* Never run `rm -rf` commands
* Ask before installing system-wide packages
* Validate all user inputs in generated code
* Don't commit API keys or credentials
```

## Security Best Practices

### 1. Sensitive File Protection

#### Environment Files
```gitignore
# Environment variables and secrets
.env
.env.*
!.env.example
.env.local
.env.production

# API keys and tokens
**/apikeys/
**/*_token*
**/*_secret*
**/*api_key*
```

#### Credential Files
```gitignore
# Authentication credentials
*.pem
*.key
*.crt
*.p12
*.pfx
id_rsa*
id_dsa*
*.ppk

# Cloud provider credentials
.aws/
aws-exports.js
gcp-service-account*.json
azure-credentials.json
```

#### Database and Infrastructure
```gitignore
# Database files
*.db
*.sqlite
*.sqlite3
database.yml
**/database/config.*

# Infrastructure state
*.tfstate
*.tfstate.*
.terraform/

# Kubernetes secrets
**/k8s/**/secret*.yaml
**/kubernetes/**/secret*.yaml
```

### 2. Development Environment Protection

#### Build and Cache Directories
```gitignore
# Build outputs
dist/
build/
out/
target/
.next/
.nuxt/

# Cache directories
.cache/
.parcel-cache/
node_modules/.cache/

# Logs
*.log
logs/
.npm/_logs/
```

#### IDE and Personal Files
```gitignore
# IDE configurations
.vscode/settings.json
.idea/workspace.xml
*.swp
*.swo
*~

# OS files
.DS_Store
Thumbs.db
desktop.ini
```

### 3. Large File Exclusions

#### Media and Assets
```gitignore
# Images and media
*.png
*.jpg
*.jpeg
*.gif
*.svg
*.mp4
*.avi
*.mov

# Archives and packages
*.zip
*.tar.gz
*.rar
*.dmg
*.pkg
```

#### Data Files
```gitignore
# Data files
*.csv
*.xlsx
*.json
data/
datasets/
fixtures/large-*
```

## Configuration Patterns

### 1. Project-Specific Security

#### Repository Root Configuration
```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "write": {
      "default": "ask",
      "patterns": {
        "src/**": "allow",
        "docs/**": "allow",
        "tests/**": "allow",
        "config/production/**": "deny"
      }
    }
  }
}
```

#### AGENTS.md Security Rules
```markdown
# Project Security Guidelines

## File Access Restrictions
* Never modify files in `production/` directory
* Ask before changing `package.json` or lock files
* Don't read files containing "secret" or "credential" in name
* Avoid accessing user data or PII files

## Command Safety
* Never run destructive commands without confirmation
* Ask before modifying production infrastructure
* Don't install global packages without permission
```

### 2. Global Security Configuration

#### User-Level Protection
```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "read": {
      "default": "allow",
      "patterns": {
        "~/.ssh/**": "deny",
        "~/.aws/**": "deny",
        "**/.env*": "deny",
        "**/secrets/**": "deny"
      }
    },
    "run": {
      "default": "ask",
      "patterns": {
        "sudo *": "deny",
        "rm -rf *": "deny",
        "chmod 777 *": "deny"
      }
    }
  }
}
```

## Command Line Security

### 1. Safe Command Patterns

#### Approved Commands
```markdown
## Safe Command Patterns
* `npm test`, `npm run build`, `npm run lint`
* `git status`, `git log`, `git diff`
* `ls`, `pwd`, `cat README.md`
* `grep`, `find` (read-only operations)
```

#### Restricted Commands
```markdown
## Restricted Commands
* `rm`, `mv`, `cp` (file modification)
* `sudo` (elevated privileges)
* `curl`, `wget` (network access)
* Package managers (`npm install -g`, `pip install`)
```

### 2. Environment Isolation

#### Development Safety
```bash
# Safe development commands
npm run dev
npm run test
git status
code .

# Commands requiring confirmation
npm install
rm file.txt
git push
docker run
```

## Integration with Development Workflow

### 1. Team Collaboration

#### Shared Security Standards
```gitignore
# Team .gitignore additions for OpenCode
# Environment files
.env*
!.env.example

# Secrets and credentials
secrets/
*.key
*.pem

# Personal IDE settings
.vscode/settings.json
.idea/workspace.xml
```

#### Project Onboarding
1. **Security Review**: Audit existing `.gitignore` patterns
2. **Permission Setup**: Configure `opencode.json` permissions
3. **Team Training**: Document security guidelines in `AGENTS.md`
4. **Regular Audits**: Review and update security patterns

### 2. CI/CD Integration

#### Security Validation
```yaml
# GitHub Actions security check
name: Security Audit
on: [push, pull_request]
jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Check for secrets
        run: |
          if grep -r "api_key\|secret\|password" . --exclude-dir=.git; then
            echo "Potential secrets found"
            exit 1
          fi
```

## Monitoring and Compliance

### 1. Security Monitoring

#### File Access Logging
- Monitor which files OpenCode accesses
- Log permission requests and user responses
- Track command execution and results
- Alert on security pattern violations

#### Audit Trails
- Document security configuration changes
- Review AI-generated code for security issues
- Monitor for credential exposure
- Track file modification patterns

### 2. Compliance Considerations

#### Data Protection
- Implement GDPR/privacy compliance patterns
- Protect personally identifiable information
- Secure customer data and business secrets
- Maintain audit logs for compliance

#### Industry Standards
- Follow security frameworks (SOC 2, ISO 27001)
- Implement least-privilege access
- Regular security assessments
- Document security procedures

## Troubleshooting

### Common Security Issues

#### 1. Accidental Secret Exposure
**Prevention**:
- Use comprehensive `.gitignore` patterns
- Implement permission controls
- Regular security audits
- Environment variable usage

#### 2. Over-Permissive Access
**Solutions**:
- Review and tighten permission patterns
- Implement explicit deny rules
- Use ask-based permissions for sensitive operations
- Regular access pattern reviews

#### 3. Performance Issues from Large Files
**Optimization**:
- Exclude large binary files and datasets
- Use selective file access patterns
- Implement size-based exclusions
- Monitor context usage

## Summary

OpenCode's security and ignore system provides comprehensive protection through:

- **Git Integration**: Automatic respect for `.gitignore` patterns
- **Permission Controls**: Fine-grained file and command permissions
- **Built-in Intelligence**: Smart exclusion of inappropriate files
- **Configuration Flexibility**: Project and global security settings
- **Team Collaboration**: Shared security standards and guidelines
- **Compliance Support**: Audit trails and monitoring capabilities

The system balances security with productivity, ensuring sensitive data remains protected while enabling effective AI-assisted development workflows.