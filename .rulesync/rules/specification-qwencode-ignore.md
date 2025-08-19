---
root: false
targets: ["*"]
description: "Qwen Code ignore files specification for controlling AI file access"
globs: []
---

# Qwen Code Ignore Files Specification

## Overview
Qwen Code uses git-aware file filtering to control which files the AI can access and process. The system automatically respects `.gitignore` patterns and provides additional configuration options for fine-grained control over file visibility.

## File Exclusion Mechanisms

### 1. Git Integration (.gitignore)

#### Automatic Exclusion
- **Primary Method**: Qwen Code automatically respects `.gitignore` patterns
- **Behavior**: Files ignored by Git are automatically excluded from AI context
- **Scope**: Repository-wide exclusion following standard Git ignore rules
- **No Duplication**: No need to maintain separate ignore files

#### Standard .gitignore Integration
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

### 2. Built-in Smart Filtering

#### Default Exclusions
Qwen Code has built-in intelligence to avoid certain file types and directories:
- **Hidden Files**: Files and directories starting with `.`
- **Dependencies**: `node_modules/`, `vendor/`, `.pnpm-store/`
- **Build Artifacts**: Common build output directories
- **System Files**: OS-specific temporary and system files
- **Binary Files**: Automatically detected and excluded

#### Git-Aware Filtering Configuration
```json
{
  "fileFiltering": {
    "respectGitIgnore": true,
    "enableRecursiveFileSearch": true
  }
}
```

### Configuration Options

#### respectGitIgnore (boolean)
- **Default**: `true`
- **Purpose**: Whether to respect `.gitignore` patterns when discovering files
- **When true**: Git-ignored files (like `node_modules/`, `dist/`, `.env`) are automatically excluded from @ commands and file listing operations
- **When false**: All files are potentially accessible to the AI

#### enableRecursiveFileSearch (boolean)
- **Default**: `true`
- **Purpose**: Whether to enable searching recursively for filenames under current tree
- **Usage**: Affects @ prefix completion and file discovery
- **Performance**: Set to `false` for better performance in very large repositories

## Configuration Examples

### Basic File Filtering Setup
```json
{
  "fileFiltering": {
    "respectGitIgnore": true,
    "enableRecursiveFileSearch": true
  }
}
```

### Restrictive Configuration
```json
{
  "fileFiltering": {
    "respectGitIgnore": true,
    "enableRecursiveFileSearch": false
  }
}
```

## Security-Focused .gitignore Patterns

### Secrets and Credentials
```gitignore
# Environment files
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

### Infrastructure State
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

### Development Files
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

# Logs
*.log
logs/
.npm/_logs/
```

### Build Artifacts and Dependencies
```gitignore
# Node.js
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build outputs
dist/
build/
.next/
.nuxt/

# Cache directories
.cache/
.parcel-cache/
.next/cache/

# Test coverage
coverage/
.nyc_output/
```

## Advanced Filtering Patterns

### Language-Specific Exclusions

#### Python Projects
```gitignore
# Virtual environments
venv/
.venv/
env/
__pycache__/

# Build artifacts
*.pyc
*.pyo
*.pyd
build/
dist/
*.egg-info/
```

#### Java Projects
```gitignore
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

# Logs
*.log
```

#### Go Projects
```gitignore
# Binaries
*.exe
*.exe~
*.dll
*.so
*.dylib

# Test binary
*.test

# Output of go coverage tool
*.out

# Dependency directories
vendor/
```

### Large File Exclusions
```gitignore
# Media files
*.mp4
*.avi
*.mov
*.mkv
*.png
*.jpg
*.jpeg
*.gif
*.svg

# Archives and packages
*.zip
*.tar.gz
*.rar
*.dmg
*.pkg

# Data files
*.csv
*.xlsx
*.sqlite
*.db
data/
datasets/
```

## Integration with @ Commands

### File Content Injection
The @ command system respects file filtering settings:
```bash
# These commands automatically exclude git-ignored files
@src/my_project/ Summarize the code in this directory
@README.md What is this file about?
```

### Error Handling
- **Invalid Paths**: Results in error message
- **Permission Issues**: Reported to user
- **Filtered Files**: Silently excluded from results

## Best Practices

### Security Guidelines
1. **Sensitive Data**: Always exclude files containing secrets, API keys, passwords
2. **Personal Information**: Exclude files with PII or confidential data
3. **Production Configs**: Exclude production configuration files
4. **Database Files**: Exclude local database files and backups

### Performance Optimization
1. **Large Files**: Exclude large binary files and datasets
2. **Build Artifacts**: Exclude generated files and build outputs
3. **Dependencies**: Exclude third-party dependencies
4. **Cache Directories**: Exclude temporary and cache directories

### Team Collaboration
1. **Shared Standards**: Establish team conventions for ignore patterns
2. **Documentation**: Document rationale for exclusion patterns
3. **Version Control**: Commit `.gitignore` for team consistency
4. **Regular Review**: Periodically review and update patterns

## Configuration Management

### Settings File Locations
Configure file filtering in any of these locations:

1. **System Settings**: `/etc/gemini-cli/settings.json` (highest priority)
2. **Project Settings**: `.qwen/settings.json` (project-specific)
3. **User Settings**: `~/.qwen/settings.json` (personal defaults)

### Environment-Specific Configuration
```json
{
  "fileFiltering": {
    "respectGitIgnore": true,
    "enableRecursiveFileSearch": false
  }
}
```

## Troubleshooting

### Common Issues

#### Files Still Visible Despite .gitignore
**Symptoms**: Files appear in AI context despite being in `.gitignore`
**Solutions**:
- Verify `respectGitIgnore: true` in settings
- Check `.gitignore` syntax and patterns
- Ensure files are actually ignored by Git (`git check-ignore -v path`)
- Clear any Git cache issues (`git rm --cached file`)

#### Performance Issues with Large Repositories
**Symptoms**: Slow file discovery or high memory usage
**Solutions**:
- Set `enableRecursiveFileSearch: false`
- Add more exclusion patterns to `.gitignore`
- Exclude large directories and file types
- Use more specific patterns instead of broad wildcards

#### @ Commands Not Finding Files
**Symptoms**: Expected files not included in @ command results
**Solutions**:
- Check if files are git-ignored
- Verify file paths and naming
- Review filtering configuration
- Test with simple file paths first

### Debugging Steps
1. **Check Git Status**: Use `git status` to see what Git sees
2. **Test Patterns**: Use `git check-ignore -v <path>` to test specific files
3. **Review Settings**: Verify `fileFiltering` configuration in settings.json
4. **Monitor Performance**: Watch for slow responses with large file sets

## Migration from Other AI Tools

### From Other CLIs
Most AI coding tools use similar `.gitignore` integration:
```bash
# Usually works without changes
cp .gitignore .gitignore  # Already compatible
```

### Adding Qwen Code Specific Patterns
```gitignore
# Qwen Code specific (if needed)
.qwen/
*.qwen.log
qwen-cache/
```

## Integration with Development Workflow

### CI/CD Integration
```yaml
# Example GitHub Actions
name: Validate Ignore Patterns
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Check for secrets
        run: |
          if grep -r "api_key\|secret\|password" . --exclude-dir=.git --exclude-dir=node_modules; then
            echo "Potential secrets found"
            exit 1
          fi
```

### Team Onboarding
1. **Documentation**: Include ignore patterns in project README
2. **Templates**: Provide standard `.gitignore` templates
3. **Validation**: Regular security audits of exclusion patterns
4. **Training**: Educate team on file filtering principles

This specification provides comprehensive guidance for configuring file exclusion and filtering in Qwen Code, ensuring sensitive files remain protected while maintaining optimal performance and development experience.