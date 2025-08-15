---
root: false
targets: ["*"]
description: "Windsurf AI code editor ignore files configuration specification"
globs: []
---

# Windsurf AI Code Editor Ignore Files Configuration Specification

## Overview
Windsurf's Cascade AI and indexing engine use ignore files to determine which files and directories should be excluded from AI analysis and context. This helps protect sensitive information, reduce noise, and improve performance by focusing on relevant code.

## Ignore Mechanisms

### 1. Git Integration (.gitignore)
- **Automatic**: Whatever Git ignores is automatically skipped by Windsurf's indexer
- **No Duplication**: Rules don't need to be duplicated in Windsurf-specific files
- **Standard Behavior**: Follows standard Git ignore patterns and conventions

### 2. Windsurf-Specific Ignore (.codeiumignore)
- **File**: `.codeiumignore`
- **Location**: Root of the workspace/repository
- **Syntax**: Identical to `.gitignore` syntax
- **Purpose**: Additional exclusions specific to AI analysis

### 3. Built-in Defaults
Always ignored by Windsurf:
- `node_modules/` directory
- Any path starting with "." (hidden files and directories)

## File Format Specification

### Syntax Rules
The `.codeiumignore` file uses the same syntax as `.gitignore`:

#### Basic Patterns
- **Blank lines**: Ignored (no effect)
- **Comments**: Lines starting with `#`
- **File matching**: Exact filename or pattern
- **Directory matching**: Trailing `/` indicates directory-only match

#### Wildcard Patterns
- **`*`**: Matches any characters except `/`
- **`?`**: Matches any single character
- **`**`**: Matches zero or more directories (recursive)
- **`[abc]`**: Matches any character in the set
- **`[a-z]`**: Matches any character in the range

#### Path Patterns
- **Leading `/`**: Anchors pattern to repository root
- **Trailing `/`**: Matches directories only
- **No leading `/`**: Matches at any level in the directory tree

#### Negation Patterns
- **`!pattern`**: Re-include a previously excluded path
- **Evaluation Order**: Rules processed top-to-bottom, later rules override earlier ones

## Configuration Examples

### Basic .codeiumignore Example
```gitignore
# Build artifacts
dist/
build/
out/
target/

# Logs and temporary files
*.log
*.tmp
.env
.env.*

# Screenshots except README
screenshots/**
!screenshots/README.png

# Source files only in src/
*
!src/
!src/**/*.ts
!src/**/*.js
```

### Security-Focused Configuration
```gitignore
# Secrets and credentials
*.pem
*.key
*.crt
*.p12
*.pfx
.env*
!.env.example

# API keys and tokens
**/apikeys/
**/*_token*
**/*_secret*
**/*api_key*

# Database files
*.db
*.sqlite
*.sqlite3

# Configuration files with secrets
config/secrets/
**/database.yml
aws-credentials.json
gcp-service-account*.json
```

### Development Environment Configuration
```gitignore
# Dependencies
node_modules/
.pnpm-store/
.yarn/
vendor/

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
```

### Large Data Files Configuration
```gitignore
# Data files
*.csv
*.xlsx
*.json
data/
datasets/

# Media files
*.mp4
*.avi
*.mov
*.png
*.jpg
*.jpeg
*.gif

# Archives
*.zip
*.tar.gz
*.rar
```

### Framework-Specific Examples

#### Node.js Project
```gitignore
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build outputs
dist/
build/
.next/
.nuxt/

# Environment files
.env*
!.env.example

# Cache
.npm/
.eslintcache
```

#### Python Project
```gitignore
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
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
source-dist/
var/
wheels/

# Data and logs
*.log
*.db
*.sqlite
```

#### Java Project
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
.vscode/

# Logs
*.log

# Maven/Gradle
.m2/
.gradle/
```

## Advanced Patterns

### Conditional Exclusions
```gitignore
# Exclude all JavaScript files in lib but keep index.js
lib/**/*.js
!lib/index.js

# Exclude all config files except development
config/*
!config/development.json
```

### Multi-Level Patterns
```gitignore
# Exclude all test directories but keep unit tests
**/test/**
!**/test/unit/**

# Exclude all logs except error logs
**/*.log
!**/*error*.log
```

### Complex Project Structure
```gitignore
# Monorepo: exclude all node_modules
**/node_modules/

# Exclude all build outputs
**/dist/
**/build/

# Keep specific documentation
docs/**
!docs/README.md
!docs/api/

# Exclude all .env files except examples
**/.env*
!**/.env.example
```

## Integration and Management

### File Creation and Editing
1. **Manual Creation**: Create `.codeiumignore` file in project root
2. **Text Editor**: Use any text editor to modify patterns
3. **Version Control**: Consider committing to share with team
4. **Documentation**: Document complex patterns and their purposes

### Testing and Validation

#### Local Testing
```bash
# Test patterns using Git's check-ignore (similar behavior)
git check-ignore -v <path>

# If Git ignores it, Windsurf will too
```

#### Pattern Validation
1. **Syntax Check**: Ensure patterns follow gitignore syntax
2. **Scope Verification**: Test that intended files are excluded
3. **Performance Impact**: Monitor indexing performance after changes

### Refresh and Application
1. **File Changes**: Edit `.codeiumignore` file
2. **Index Refresh**: Trigger "Re-index workspace" in Windsurf
3. **Alternative**: Reload the IDE to apply changes
4. **Verification**: Check that files are properly excluded

## Best Practices

### Security Guidelines
1. **Sensitive Data**: Always exclude files containing secrets, API keys, passwords
2. **Personal Information**: Exclude files with PII or confidential data
3. **Production Configs**: Exclude production configuration files
4. **Database Files**: Exclude local database files and backups

### Performance Optimization
1. **Large Files**: Exclude large binary files and datasets
2. **Build Artifacts**: Exclude generated files and build outputs
3. **Dependencies**: Exclude third-party dependencies and vendor directories
4. **Cache Directories**: Exclude temporary and cache directories

### Team Collaboration
1. **Shared Standards**: Establish team conventions for ignore patterns
2. **Documentation**: Document rationale for complex patterns
3. **Version Control**: Commit `.codeiumignore` for team consistency
4. **Regular Review**: Periodically review and update patterns

### Maintenance
1. **Pattern Cleanup**: Remove obsolete patterns regularly
2. **Testing**: Verify patterns work as expected
3. **Performance Monitoring**: Monitor impact on indexing performance
4. **Team Feedback**: Gather feedback on exclusion effectiveness

## Troubleshooting

### Common Issues

#### 1. Files Still Indexed
**Symptoms**: Files appear in AI context despite being in ignore file
**Solutions**:
- Check pattern syntax for errors
- Verify file is in correct location (repository root)
- Trigger workspace re-indexing
- Check for conflicting negation patterns

#### 2. Over-Exclusion
**Symptoms**: Important files excluded from AI context
**Solutions**:
- Review patterns for overly broad rules
- Use negation patterns (`!`) to re-include specific files
- Test patterns with smaller scope first

#### 3. Performance Issues
**Symptoms**: Slow indexing or high CPU usage
**Solutions**:
- Exclude large directories and files
- Use more specific patterns instead of broad wildcards
- Monitor and optimize pattern complexity

#### 4. Pattern Conflicts
**Symptoms**: Unexpected behavior with complex patterns
**Solutions**:
- Simplify patterns and test incrementally
- Review pattern precedence (later rules override earlier ones)
- Use Git's check-ignore to test pattern behavior

### Debugging Steps
1. **Pattern Testing**: Use Git tools to test pattern behavior
2. **Incremental Changes**: Add patterns one at a time to identify issues
3. **Index Monitoring**: Watch indexing behavior after changes
4. **Log Review**: Check Windsurf logs for ignore-related messages

## Integration with Development Workflow

### CI/CD Integration
1. **Pattern Validation**: Include ignore file validation in CI
2. **Security Scanning**: Verify sensitive files are properly excluded
3. **Performance Testing**: Monitor indexing performance in CI

### IDE Integration
1. **File Status**: Use IDE indicators to verify ignore status
2. **Quick Access**: Configure editor shortcuts for ignore file editing
3. **Team Sharing**: Share ignore configurations through version control

### Monitoring and Analytics
1. **Index Size**: Monitor workspace index size changes
2. **Performance Metrics**: Track indexing time and resource usage
3. **Coverage Analysis**: Ensure important files aren't excluded

## File Naming Convention Note

### Historical Context
- **Current Standard**: `.codeiumignore` (official documentation)
- **Alternative Names**: Some older references mention `.windsurf-ignore`
- **Recommendation**: Use `.codeiumignore` for consistency with official documentation

### File Validation
Windsurf automatically detects and loads `.codeiumignore` files, providing the "WindsurfIgnore" functionality referenced in the official documentation.

This specification provides comprehensive guidance for configuring ignore files in Windsurf, enabling effective exclusion of sensitive, irrelevant, or large files from AI analysis while maintaining security and performance.