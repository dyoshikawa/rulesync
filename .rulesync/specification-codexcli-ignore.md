---
root: false
targets: ["*"]
description: "OpenAI Codex CLI file exclusion and ignore patterns specification"
globs: ["**/.codexignore", "**/.gitignore", "**/*.json", "**/*.toml", "**/*.yaml"]
---

# OpenAI Codex CLI Ignore File Specification

## Overview
OpenAI Codex CLI currently has limited built-in support for file exclusion patterns. While a dedicated `.codexignore` file has been requested by the community (GitHub Issue #205), it is not yet fully implemented. However, Codex CLI does have some built-in intelligence for handling common directories and provides configuration options for managing file access and security.

## Current File Exclusion Behavior

### Built-in Exclusions
Codex CLI automatically handles certain directories and file types:

#### Node.js Projects
- **`node_modules/`**: Automatically ignored when indexing code or listing files
- **Access**: Only accessed when explicitly requested by the user
- **Behavior**: Codex CLI has built-in intelligence to avoid sending unnecessary dependency files to the AI model

#### Common Build Artifacts
While not officially documented, Codex CLI likely follows common patterns for excluding:
- Build output directories (`dist/`, `build/`, `out/`)
- Cache directories (`.cache/`, `.tmp/`)
- Log files (`*.log`)
- System files (`.DS_Store`, `Thumbs.db`)

### Configuration-Based Exclusions
Codex CLI provides configuration options that can limit file access:

#### Safe Commands Configuration
In `~/.codex/config.yaml` or `~/.codex/config.json`:
```yaml
# YAML format
safeCommands:
  - npm test
  - yarn lint
  - git status
  - git log --oneline

# JSON format
{
  "safeCommands": [
    "npm test",
    "yarn lint", 
    "git status",
    "git log --oneline"
  ]
}
```

## Proposed .codexignore Specification

### File Placement
Based on the GitHub feature request and common patterns:
- **Primary Location**: `.codexignore` in project root
- **Scope**: Project-wide file exclusions
- **Version Control**: Should be committed to repository for team consistency

### Expected Syntax (Based on Community Request)
The proposed `.codexignore` file would follow `.gitignore` syntax patterns:

```gitignore
# Comments start with hash
# Blank lines are ignored

# Exclude specific files
secrets.json
api-keys.txt
.env.local

# Exclude directories
secrets/
private/
confidential/

# Exclude file patterns
*.key
*.pem
*.p12
*.pfx

# Exclude test data with sensitive content
test-data/sensitive/
**/*-secret*.json

# Exclude build artifacts
dist/
build/
*.log
.cache/

# Negation patterns (re-include previously excluded)
!secrets/README.md
!test-data/public/
```

### Pattern Syntax (Expected)
Based on standard gitignore patterns:

#### Basic Patterns
- `filename`: Exclude specific file
- `directory/`: Exclude entire directory
- `*.ext`: Exclude all files with extension
- `**/*.ext`: Exclude files with extension at any depth

#### Path Patterns  
- `/root-file`: Exclude file only at project root
- `dir/subdir/`: Exclude specific subdirectory path
- `**/pattern`: Match pattern at any directory level

#### Negation Patterns
- `!file`: Re-include previously excluded file
- `!directory/`: Re-include previously excluded directory

## Workaround Solutions

### Method 1: Environment Variables
Control Codex CLI behavior through environment variables:
```bash
# Disable project documentation loading
export CODEX_DISABLE_PROJECT_DOC=1

# Custom configuration
export CODEX_CONFIG_FILE=/path/to/custom/config.toml
```

### Method 2: Custom Configuration File
Use `--config-file` flag with TOML configuration:
```toml
# custom-config.toml
model = "gpt-4o-mini"
approval-mode = "suggest"

# Custom exclusion logic could be implemented here
# (requires custom wrapper or future feature)
```

### Method 3: Directory Structure
Organize sensitive files outside the working directory:
```
project/
├── src/           # Codex CLI working directory
├── docs/
├── tests/
└── sensitive/     # Keep outside Codex CLI scope
    ├── secrets/
    ├── credentials/
    └── private-data/
```

### Method 4: Git Submodules
Use git submodules for sensitive components:
```bash
# Add sensitive code as submodule
git submodule add https://private-repo.com/sensitive-module.git sensitive

# Codex CLI can be configured to ignore submodules
```

## Security Best Practices

### Protecting Sensitive Data

#### API Keys and Credentials
```gitignore
# In proposed .codexignore
.env
.env.*
!.env.example

# API keys
*.key
*.pem
api-keys.json
credentials.json

# Cloud provider credentials
aws-credentials.json
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

# Infrastructure as Code secrets
*.tfstate
*.tfstate.*
terraform.tfvars
secrets.auto.tfvars

# Kubernetes secrets
**/k8s/**/secret*.yaml
**/kubernetes/**/secret*.yaml
```

#### Business Sensitive Data
```gitignore
# Customer data
customer-data/
pii/
personal-data/
**/*customer*.csv
**/*personal*.json

# Internal documentation
confidential/
internal-docs/
company-secrets/
strategy/
```

### Environment-Specific Exclusions

#### Development Environment
```gitignore
# Development-only exclusions
.vscode/settings.json
.idea/workspace.xml
*.swp
*.swo
*~

# Local development databases
local.db
dev.sqlite
test-data/
```

#### Production Considerations
```gitignore
# Production secrets (should never be in repo anyway)
production.env
prod-secrets.json
deployment-keys/

# Build artifacts that might contain secrets  
build/
dist/
.next/
.nuxt/
```

## Implementation Patterns

### Custom Wrapper Script
Until native `.codexignore` support is available, create a wrapper:

```bash
#!/bin/bash
# codex-wrapper.sh

# Check if sensitive files exist in current directory
if [ -f ".env" ] || [ -f "secrets.json" ]; then
    echo "Warning: Sensitive files detected. Use with caution."
    read -p "Continue? (y/N): " -n 1 -r
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Run Codex CLI with original arguments
codex "$@"
```

### Pre-commit Hook
Add validation to prevent sensitive data exposure:

```bash
#!/bin/sh
# .git/hooks/pre-commit

# Check for potential secrets before commit
if grep -r "api_key\|secret\|password" . --exclude-dir=.git; then
    echo "Potential secrets found. Review before committing."
    exit 1
fi
```

### IDE Integration
Configure IDE to warn about sensitive files:

```json
// .vscode/settings.json
{
  "files.watcherExclude": {
    "**/.env*": true,
    "**/secrets/**": true,
    "**/*.key": true
  },
  "search.exclude": {
    "**/.env*": true,
    "**/secrets/**": true,
    "**/*.key": true
  }
}
```

## Migration from Other AI Tools

### From .gitignore
Many patterns can be copied directly:
```bash
# Copy relevant patterns from .gitignore
cp .gitignore .codexignore

# Edit to focus on AI-specific concerns
# Remove build artifacts if you want AI to see them
# Add AI-specific sensitive patterns
```

### From .cursorignore
```bash
# Cursor ignore patterns are directly compatible
cp .cursorignore .codexignore
```

### From .aiexclude (Gemini CLI)
```bash
# Direct compatibility expected
cp .aiexclude .codexignore
```

## Future Implementation Expectations

### Expected Features
Based on the GitHub issue and community requests:

1. **File Pattern Matching**: Standard glob patterns like `*.key`, `secrets/`
2. **Directory Exclusion**: Exclude entire directories from AI context
3. **Negation Support**: Re-include specific files with `!pattern`
4. **Hierarchical Support**: Support for nested `.codexignore` files
5. **Real-time Validation**: Warning when AI tries to access ignored files

### Integration Points
- **CLI Commands**: Integration with `codex doctor` for validation
- **Configuration**: Possible integration with main config file
- **Debugging**: Options to list ignored files and patterns
- **Override Capabilities**: Flags to temporarily bypass ignores

## Monitoring and Validation

### Checking Current Behavior
```bash
# List files that Codex CLI can see
codex --list-files  # (hypothetical future command)

# Check configuration
codex doctor

# Debug mode to see file access
CODEX_DEBUG_CONFIG=1 codex
```

### Validation Checklist
- [ ] Sensitive files are not exposed to AI model
- [ ] Build artifacts are appropriately excluded
- [ ] Team members use consistent ignore patterns
- [ ] Ignore patterns don't interfere with legitimate AI tasks
- [ ] Performance impact is minimal

## Community and Future Development

### Feature Request Status
- **GitHub Issue**: #205 - ".codexignore file" feature request
- **Community Interest**: 20+ thumbs up reactions
- **Status**: Requested but not yet implemented
- **Timeline**: No official timeline provided

### Contributing to Development
1. **Feedback**: Add comments to GitHub issue #205
2. **Use Cases**: Share specific use cases and requirements
3. **Testing**: Participate in beta testing when available
4. **Documentation**: Help improve documentation and examples

### Alternative Solutions
Until native support is available:
1. Use directory structure to isolate sensitive files
2. Implement custom wrapper scripts
3. Use environment variables for configuration
4. Leverage git hooks for validation
5. Configure IDE-level exclusions

This specification provides comprehensive guidance for file exclusion patterns in OpenAI Codex CLI, covering current limitations, workaround solutions, and expectations for future `.codexignore` file support.