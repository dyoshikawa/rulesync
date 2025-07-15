---
root: false
targets: ["kiro"]
description: "Kiro IDE ignore files specification and best practices"
globs: "src/**/*.ts"
---

# Kiro Ignore Files Specification

## Overview
Kiro IDE uses a three-file system to control which files the AI agent can access. This provides fine-grained control over file visibility with support for both exclusion and re-inclusion patterns.

## File Priority and Processing Order

Kiro evaluates ignore patterns in the following order:

1. **`.gitignore`** - Standard Git ignore file (highest priority for exclusions)
2. **`.aiignore`** - AI-specific exclusions (processed after .gitignore)
3. **`.kirodeignore`** - Re-inclusion/allowlist (processed last, can override previous exclusions)

Files are processed sequentially, with later files able to override earlier patterns. This allows for sophisticated inclusion/exclusion logic.

## File Locations

All ignore files should be placed at the repository root. Kiro does not support nested ignore files in subdirectories.

```
<repository-root>/
├── .gitignore
├── .aiignore
└── .kirodeignore
```

## Pattern Syntax

All three files use the same gitignore-style pattern syntax:

### Basic Patterns
- **Blank lines** are ignored (used as separators)
- **Comments** start with `#`
- **Wildcards**:
  - `*` matches any characters except `/`
  - `?` matches any single character except `/`
  - `[abc]` matches any character in the set
  - `[a-z]` matches any character in the range

### Path Patterns
- **Leading `/`** anchors the pattern to the repository root
  - `/build` matches only the build directory at root
  - `build` matches any build directory at any level
- **Trailing `/`** matches only directories
  - `logs/` matches directories named logs
  - `logs` matches both files and directories named logs
- **Double asterisk `**`** matches zero or more directories
  - `**/test` matches test anywhere in the tree
  - `docs/**` matches everything under docs
  - `**/*.log` matches all .log files at any depth

### Negation Patterns
- **Leading `!`** negates a pattern (re-includes previously excluded items)
  - Must not have a trailing `/` in negation patterns
  - Cannot re-include a file if its parent directory is excluded

## File-Specific Usage

### 1. .gitignore
Primary file for excluding sensitive and build artifacts. Kiro reads this first because most projects already have one.

```gitignore
# Secrets & Credentials
*.pem
*.key
*.crt
*.pfx
*.der
id_rsa*

# AWS Credentials (never commit these)
.aws/
**/.aws/**

# Environment files
.env
*.env
.env.*

# Infrastructure state
terraform.tfstate*
cdk.out/

# Generic secret patterns
**/*secret*.json
**/*secrets*.yml
**/config/**/prod*.yaml

# Build artifacts
dist/
build/
target/
*.log

# Dependencies
node_modules/
.pnpm-store/
```

### 2. .aiignore
Additional AI-specific exclusions not needed in .gitignore. Use this for files that can be in Git but shouldn't be read by the AI.

```gitignore
# Data files AI shouldn't process
*.csv
*.tsv
*.sqlite
*.db

# Large binary files
*.zip
*.tar.gz
*.rar

# Sensitive documentation
internal-docs/
confidential/

# Test data that might confuse AI
test/fixtures/large-*.json
benchmark-results/

# Reinforce critical exclusions from .gitignore
*.pem
*.key
.env*
```

### 3. .kirodeignore
Surgical re-inclusion of specific files or patterns that were excluded by the previous two files.

```gitignore
# Re-include specific documentation the AI needs
!docs/api/**
!docs/architecture.md

# Re-include specific test files for context
!test/fixtures/example-*.json

# Re-include README files everywhere
!**/README.md

# Re-include specific config examples
!config/example.env
!config/sample-*.yaml
```

## Security Best Practices

### Protecting Secrets
Always exclude files containing secrets or credentials:

```gitignore
# Authentication & Secrets
*.pem
*.key
*.crt
private-key*
id_rsa*
id_dsa*
*.p12
*.pfx

# AWS Specific
.aws/
aws-exports.js
amplify/backend/amplify-meta.json

# Environment Variables
.env
.env.*
!.env.example  # Allow example files

# API Keys and Tokens
**/apikeys/
**/*_token*
**/*_secret*
```

### Infrastructure State
Exclude files containing infrastructure state or sensitive configuration:

```gitignore
# Terraform
*.tfstate
*.tfstate.*
.terraform/

# AWS CDK
cdk.out/
cdk.context.json

# Serverless
.serverless/

# SAM
.aws-sam/
```

## Common Patterns

### Development Files
```gitignore
# IDE
.idea/
.vscode/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Logs
*.log
logs/
```

### Build Artifacts
```gitignore
# Common build directories
dist/
build/
out/
target/

# Language specific
*.pyc
__pycache__/
*.class
*.o
*.so
```

### Dependencies
```gitignore
# Node.js
node_modules/
pnpm-lock.yaml
package-lock.json

# Python
venv/
*.egg-info/

# Java
target/
*.jar
```

## Workflow Commands

### Reloading Ignore Lists
After editing any ignore file, reload the patterns:
- Command Palette → "Kiro: Reload Ignore Lists"
- Changes take effect immediately for chat, code actions, and hooks

### Verification
To verify which files are excluded:
```bash
# List files that Git ignores
git ls-files --others --ignored --exclude-standard

# Check specific file
git check-ignore -v path/to/file
```

## Best Practices

### Organization
1. Keep security-critical exclusions in `.gitignore`
2. Use `.aiignore` for AI-specific exclusions
3. Use `.kirodeignore` sparingly for specific inclusions
4. Document complex patterns with comments

### Maintenance
1. Review ignore files regularly
2. Test patterns before committing
3. Keep patterns as specific as possible
4. Avoid overly broad exclusions that might hide important context

### Team Collaboration
1. Commit all three files to version control
2. Document the purpose of custom patterns
3. Establish team conventions for what should be excluded
4. Regular security audits of ignore patterns

## Example Complete Setup

### .gitignore
```gitignore
# Security Critical
*.pem
*.key
.env*
.aws/
terraform.tfstate*

# Build & Dependencies
node_modules/
dist/
*.log
```

### .aiignore
```gitignore
# Additional AI Exclusions
*.csv
*.sqlite
test/fixtures/large-*.json
internal-docs/
```

### .kirodeignore
```gitignore
# Re-include for AI Context
!docs/api/**
!.env.example
!test/fixtures/small-*.json
```

## Integration with Kiro Features

### Agent Hooks
Hooks respect ignore patterns - they cannot access or modify ignored files.

### Spec Sessions
Ignored files won't be analyzed during spec generation or refinement.

### Code Generation
Kiro won't generate code that imports or references ignored files.

## Troubleshooting

### Common Issues

1. **File still accessible after adding to ignore**
   - Reload ignore lists via Command Palette
   - Check pattern syntax and specificity
   - Verify file path matches pattern

2. **Cannot re-include file with .kirodeignore**
   - Ensure parent directory isn't excluded
   - Check pattern doesn't have trailing `/`
   - Verify pattern syntax is correct

3. **Pattern not working as expected**
   - Test with `git check-ignore -v`
   - Check for typos in pattern
   - Ensure pattern is in correct file

## Summary

Kiro's three-file ignore system provides powerful, flexible control over file visibility:

1. **`.gitignore`** - Primary exclusions (Git + AI)
2. **`.aiignore`** - Additional AI-only exclusions  
3. **`.kirodeignore`** - Selective re-inclusions

This system ensures sensitive files remain protected while allowing fine-grained control over what context the AI can access. The familiar gitignore syntax makes it easy to manage, and the hierarchical processing allows for sophisticated inclusion/exclusion rules.