---
root: false
targets: ["*"]
description: "Gemini CLI Coding Assistant .aiexclude file specification for controlling file access and privacy"
globs: []
---

# Gemini CLI Coding Assistant Ignore File Specification

## Overview
Gemini CLI and other Google AI coding tools use ignore files to determine which files and directories should be excluded from AI analysis and context. This helps protect sensitive information, reduce noise, and improve performance by focusing on relevant code.

## File Placement and File Names

### Supported Ignore Files

#### 1. `.aiexclude` (Recommended)
- **Placement**: Any directory within the project
- **Scope**: Affects the directory itself and all subdirectories
- **Multiple placement**: Possible (merged from search start directory up to root)
- **Priority**: Lower level (deeper hierarchy) settings take precedence

#### 2. `.gitignore` (Automatic Integration)
- **Placement**: Only at root working folder (where Gemini CLI is launched)
- **Limitation**: `.gitignore` files in subdirectories are ignored
- **Behavior**: Files/directories ignored by VCS are automatically excluded from Gemini features

### Priority Rules
- VCS-ignored content (from .git, .hgignore, etc.) is never sent to Gemini
- When conflicts occur in the same file, `.aiexclude` takes precedence over `.gitignore`
- Binary files and very large files are automatically skipped by the CLI

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
- `Leading !` : **NOT SUPPORTED** - Negation patterns are disabled for security

### Basic Examples
```
# Secret keys and API keys
apikeys.txt
*.key
/secret.env

# Entire directories
my/sensitive/dir/

# Pattern matching
KEYS.*
*.kt
```

### Important Notes: Negation Patterns
- **Negation patterns with `!` are NOT supported**
- Once a path is blocked, it cannot be re-included deeper in the tree
- This is a deliberate security design choice to prevent accidental exposure

## Special Cases

### Empty `.aiexclude`
- **Behavior**: Equivalent to `**/*` (blocks everything in the directory and below)
- **Use case**: Useful in test fixtures, generated code, or experimental branches

### Multiple `.aiexclude` Files
- **Behavior**: Rules are additive (union)
- **No override**: There is no precedence trick - if any rule blocks a path, that path is blocked
- **Inheritance**: Uses the same glob rules as Git with directory anchoring

## Gemini CLI Workflow

### Basic Steps
1. Place `.aiexclude` files at project root or in specific subdirectories as needed
2. Add patterns following gitignore syntax (without negation)
3. Verify exclusion settings using validation commands
4. Files matching patterns are withheld from all Gemini features

### Validation Commands (Gemini CLI ≥ 0.1.14)
```bash
# Show which files would be sent with @./ command
gemini --dry-run -v "@./"

# List all patterns currently in effect
gemini config inspect fileFiltering
```

## Pattern Examples

### Quick Pattern Cookbook

#### Block Specific Files
```
# Block every file called KEYS anywhere below this directory
KEYS

# Block KEYS plus any extension (e.g., KEYS.json)
KEYS.*

# Block all TypeScript source in this subtree
*.ts

# Block only .ts files in this exact folder—not in children
/*.ts
```

#### Block Directories
```
# Block an entire secrets folder and everything inside it
my/sensitive/dir/

# Block all node_modules directories
**/node_modules/

# Block build outputs
dist/
build/
out/
```

#### Complex Patterns
```
# Block all log files at any depth
**/*.log

# Block configuration files in current directory only
/*.config.js
/*.env

# Block all files in specific subdirectories
secrets/**
config/production/**
```

## Best Practices

### Security First
- Manage API keys, secret keys, and internal code in top-level `.aiexclude`
- Clearly exclude anything you "absolutely don't want passed to the model"
- Use directory-scoped `.aiexclude` files to compartmentalize sensitive areas

### Performance Optimization
- Include libraries, generated code, and build artifacts
- Exclude large data files, media files, and dependencies
- Focus AI analysis on relevant source code only

### Common Security Patterns
```
# API keys and credentials
*.pem
*.key
*.crt
*.p12
*.pfx
.env*
!.env.example

# Database files
*.db
*.sqlite
*.sqlite3

# Configuration files with secrets
config/secrets/
**/database.yml
aws-credentials.json
gcp-service-account*.json

# Build artifacts
node_modules/
dist/
build/
*.log
.cache/
```

### Data Protection Patterns
```
# Customer data and PII
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

# Test data with sensitive content
test-data/sensitive/
**/*-secret*.json
```

### Development Environment Patterns
```
# IDE and editor files
.vscode/settings.json
.idea/
*.swp
*.swo

# Cache directories
.cache/
.parcel-cache/
.next/cache/

# Test coverage reports
coverage/
.nyc_output/

# Temporary files
*.tmp
.env.local
```

## Integration with Development Tools

### Version Control
- Commit `.aiexclude` files for team consistency
- Use `.gitignore` for files that shouldn't be in the repository at all
- Use `.aiexclude` for files that are in the repository but shouldn't be seen by AI

### Framework-Specific Examples

#### Node.js Project
```
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment files
.env*
!.env.example

# Build outputs
dist/
build/
.next/

# Cache
.npm/
.eslintcache
```

#### Python Project
```
# Virtual environments
venv/
.venv/
env/
.env/
__pycache__/

# Build artifacts
*.pyc
*.pyo
*.pyd
.Python
build/
dist/
*.egg-info/

# Data and logs
*.log
*.db
*.sqlite
```

#### Java Project
```
# Build outputs
target/
build/
out/
*.class
*.jar
*.war

# IDE files
.idea/
*.iml
.vscode/

# Logs
*.log

# Maven/Gradle
.m2/
.gradle/
```

## Security Considerations

### Protecting Credentials & Sensitive Data
- Keep API keys, private certs, .env files out of the repo entirely when possible
- Use secret-manager tools or CI environment variables
- Add patterns to both `.gitignore` (prevent commits) and `.aiexclude` (defense-in-depth)
- Review patterns when adding new file types (`.key`, `.pem`, `.pfx`)

### Enterprise Security Configuration
```
# Complete security template
# ───── Source Control Metadata ─────
.git/
.svn/
.hg/
.idea/
*.iml
.vscode/settings.json

# ───── Build Artifacts ─────
/out/
/dist/
/target/
/build/
*.class
*.jar
*.war

# ───── Secrets & Credentials ─────
.env
.env.*
!.env.example
*.pem
*.key
*.crt
*.p12
*.pfx
secrets/**
config/secrets/
**/secrets/

# ───── Infrastructure & Deployment ─────
*.tfstate
*.tfstate.*
.terraform/
**/k8s/**/secret*.yaml
docker-compose.override.yml

# ───── Large Data Files ─────
*.csv
*.xlsx
*.sqlite
*.db
*.dump
data/
datasets/
```

## Verification and Testing

### Testing Ignore Rules
1. Create or edit `.aiexclude` file with desired patterns
2. Use dry-run commands to verify file exclusion
3. Test with Gemini CLI features to ensure sensitive files are protected
4. Monitor that legitimate development files remain accessible

### Validation Commands
```bash
# Check which files are being filtered
gemini --dry-run -v "@./"

# Inspect current filtering configuration
gemini config inspect fileFiltering

# Verify specific patterns
# (Manual verification by comparing against patterns)
```

## Troubleshooting

### Common Issues
1. **Files still accessible**: Check pattern syntax and file placement
2. **Over-exclusion**: Review patterns for overly broad rules
3. **Performance issues**: Exclude large directories and files appropriately
4. **Pattern conflicts**: Simplify patterns and test incrementally

### Debug Steps
1. **Pattern Testing**: Use validation commands to test pattern behavior
2. **Incremental Changes**: Add patterns one at a time to identify issues
3. **File Monitoring**: Watch which files are being accessed during AI operations
4. **Log Review**: Check Gemini CLI logs for ignore-related messages

## Best Practices Summary

### Security Guidelines
1. **Never commit secrets**: Use environment variables and secret managers
2. **Regular audits**: Review `.aiexclude` rules periodically
3. **Team consistency**: Ensure all team members use same ignore rules
4. **Principle of least privilege**: Start with restrictive rules, gradually relax
5. **Secret rotation**: If ignored files contained secrets, rotate them

### Maintenance Workflow
1. **Initial setup**: Create comprehensive `.aiexclude` before enabling AI features
2. **Code review**: Include `.aiexclude` changes in pull request reviews
3. **Documentation**: Document why specific patterns are ignored
4. **Regular review**: Update rules as project structure evolves
5. **Testing**: Regularly verify that sensitive files remain protected

### Team Collaboration
1. **Version control**: Commit `.aiexclude` to repository
2. **Onboarding**: Include ignore file setup in developer onboarding
3. **Standards**: Establish team standards for what should be ignored
4. **Communication**: Clearly communicate ignore rules to all team members

This specification provides comprehensive guidance for configuring ignore files in Gemini CLI and related Google AI coding tools, ensuring effective exclusion of sensitive, irrelevant, or large files from AI analysis while maintaining security and performance.