---
root: false
targets: ["*"]
description: "Windsurf ignore file specification for controlling file access and privacy"
globs: ["**/*"]
---

# Windsurf Ignore File Specification

## Overview
Windsurf is an AI-powered coding assistant and IDE that uses ignore files to control which files the AI can access, index, and analyze. The ignore system provides privacy and security controls to prevent sensitive data from being sent to remote AI systems.

## File Placement and Naming

### Primary Ignore File
- **File**: `.codeiumignore` in repository/workspace root
- **Alternative**: `.windsurfignore` (deprecated, not officially supported)
- **Scope**: Applies to the entire workspace/repository
- **Discovery**: Windsurf reads the file on startup and when it changes

### Global Configuration
- **Location**: `~/.codeium/.codeiumignore`
- **Scope**: Applied to all repositories opened with Windsurf
- **Use Case**: Enterprise/organizational policies, personal global preferences

### Multiple Workspaces
- Each workspace root can have its own `.codeiumignore`
- Rules are applied independently per workspace
- Monorepo support: each root directory maintains separate ignore rules

## File Format and Syntax

### Basic Structure
The `.codeiumignore` file uses identical syntax to `.gitignore` files:

```gitignore
# Comments start with #
# Blank lines are ignored

# Basic patterns
*.log
*.tmp
.env

# Directory patterns
build/
node_modules/

# Negation patterns (exceptions)
!important.log
!src/public-api/**
```

### Pattern Matching Rules

#### Wildcards and Special Characters
- `*` - Matches any characters except `/` (single path segment)
- `?` - Matches any single character except `/`
- `**` - Recursive wildcard (matches any number of directories)
- `[abc]` - Character class matching
- `[a-z]` - Character range matching

#### Path Anchoring
- **Leading `/`** - Anchors pattern to workspace root
  - `/secret.txt` matches only root-level file
  - `secret.txt` matches any file named secret.txt anywhere
- **Trailing `/`** - Matches directories only
  - `logs/` matches directories named logs
  - `logs` matches both files and directories

#### Advanced Patterns
```gitignore
# Match at any depth
**/test/fixtures/**

# Match from root only
/docs/private-design/*.pdf

# Match specific file types in specific locations
src/**/*.{tmp,cache,bak}

# Directory exclusion with exceptions
docs/**
!docs/README.md
!docs/public/**
```

## Precedence and Hierarchy

### Rule Evaluation Order
1. **Built-in defaults** - Automatic exclusions (node_modules/, .git/, build/, dist/)
2. **`.gitignore` rules** - Git ignore patterns are respected
3. **Repository `.codeiumignore`** - Project-specific rules
4. **Global `.codeiumignore`** - User/enterprise-wide rules

### Rule Resolution
- Patterns are evaluated top-to-bottom within each file
- **Last matching rule wins** within the same file
- More specific files (repository-level) take precedence over global rules

### Current Limitations
- **Exception Override Issue**: `.codeiumignore` exceptions (`!pattern`) may not properly override `.gitignore` exclusions
- **Single Location**: Only workspace root `.codeiumignore` is supported (no nested ignore files)

## Pattern Examples and Use Cases

### Security and Privacy Patterns
```gitignore
# === SECURITY & SECRETS ===
# Environment files
.env
.env.*
!.env.example

# Key materials and certificates
*.pem
*.key
*.crt
*.p12
*.pfx
*.der
id_rsa*
id_dsa*

# API keys and tokens
**/apikeys/
**/*_token*
**/*_secret*
**/*api_key*

# Database credentials
database.yml
**/database/config.*

# Cloud service configurations
aws-credentials.json
gcp-service-account*.json
azure-credentials.json
```

### Build Artifacts and Generated Files
```gitignore
# === BUILD ARTIFACTS ===
# Common build directories
build/
dist/
out/
target/
.next/
.nuxt/

# Compiled files
*.class
*.jar
*.war
*.exe
*.dll

# Cache directories
.cache/
.parcel-cache/
.webpack/
```

### Development and Testing
```gitignore
# === DEVELOPMENT ===
# Logs
*.log
logs/
*.tmp

# Coverage reports
coverage/
.nyc_output/
lcov.info

# Test fixtures and data
**/test/fixtures/**
**/test-data/**
**/__snapshots__/**

# IDE and editor files
.vscode/settings.json
.idea/
*.swp
*.swo
```

### Large Data Files
```gitignore
# === LARGE DATA FILES ===
# Data files
*.csv
*.xlsx
*.sqlite
*.db
*.dump

# Media files
*.mp4
*.avi
*.mov
*.wav
*.mp3

# Archive files
*.zip
*.tar.gz
*.rar
```

### Framework-Specific Examples

#### Node.js Project
```gitignore
# Dependencies
node_modules/
.pnpm-store/
.yarn/

# Build outputs
dist/
build/
.next/

# Environment
.env*
!.env.example

# Logs and cache
*.log
.cache/
```

#### Python Project
```gitignore
# Virtual environments
venv/
.venv/
env/
.env/

# Python artifacts
__pycache__/
*.pyc
*.pyo
*.pyd

# Data and models
data/
models/
*.pkl
*.h5
```

#### Java/Spring Project
```gitignore
# Build outputs
target/
out/
*.class

# IDE files
.idea/
*.iml

# Application secrets
application-prod.properties
src/main/resources/application-*.yml
!src/main/resources/application.yml
```

## Integration with Windsurf Features

### Local Indexing System
- **Process**: Windsurf preprocesses the workspace up to a configurable file limit
- **AST Generation**: Creates Abstract Syntax Tree representation of code
- **Embedding Computation**: Generates embeddings for code chunks locally
- **Vector Store**: Maintains local index with file path and line range pointers

### Context Awareness
- **Automatic Exclusion**: Large vendor folders excluded by default
- **Import Graph**: Considers dependency relationships while respecting ignore rules
- **Build Scripts**: Includes relevant build configuration while excluding outputs

### Cascade Integration
- **File Access**: Cascade cannot view, edit, or create files in ignored paths
- **Context Injection**: Ignored files are never included in AI context
- **Tool Operations**: All Windsurf tools respect ignore patterns

## Privacy and Security Implications

### Data Protection
- **No Upload**: Ignored files are never uploaded to Windsurf servers
- **Local Processing**: Indexing respects ignore rules during local preprocessing
- **Memory Only**: In Zero-Data-Retention mode, even non-ignored code is only held in memory
- **SOC 2 Compliance**: Annual third-party penetration testing and certification

### User Control
- **Opt-out Mechanism**: Complete control over what data is indexed
- **Manual Override Warning**: Manually pasted ignored file content is still processed
- **Telemetry Control**: Separate settings for usage metrics and code snippet telemetry

### Enterprise Features
- **Global Policies**: Managed global `.codeiumignore` for organizational standards
- **Audit Trail**: Logging of ignore rule application and file access
- **Compliance**: Support for regulatory requirements (GDPR, HIPAA, SOX)

## Performance Considerations

### Large Codebase Optimization
```gitignore
# Exclude large directories early
/vendor/
/third_party/
/external/

# Binary and media files
*.bin
*.exe
*.so
*.dylib

# Generated documentation
/docs/generated/
/api-docs/

# Large data directories
/datasets/
/backups/
/archives/
```

### Indexing Performance
- **File Limit**: Configurable maximum number of files to index
- **Memory Management**: Exclude large files to prevent memory issues
- **Processing Speed**: Fewer files means faster startup and re-indexing

### Best Practices for Performance
1. **Broad Exclusions First**: Exclude large directories before specific files
2. **Binary File Exclusion**: Always exclude binary files and media
3. **Generated Code**: Consider excluding generated code that changes frequently
4. **Regular Review**: Periodically review and optimize ignore patterns

## Configuration Management

### Version Control Integration
```gitignore
# Commit .codeiumignore to share with team
# Keep it alongside .gitignore for consistency

# Example repository structure:
# .gitignore          - Git exclusions
# .codeiumignore      - Windsurf AI exclusions
# .editorconfig       - Editor settings
```

### Team Collaboration
- **Shared Rules**: Commit `.codeiumignore` for team consistency
- **Local Overrides**: Use global configuration for personal preferences
- **Documentation**: Document ignore decisions in team wikis or README

### Migration Strategies
- **From .gitignore**: Copy relevant patterns and add AI-specific exclusions
- **From Other Tools**: Adapt patterns from `.cursorignore`, `.aiexclude`
- **Gradual Implementation**: Start restrictive, gradually relax as needed

## Troubleshooting and Validation

### Verification Methods

#### IDE Context Panel
1. Open Windsurf Chat → "Context" pane
2. Indexed files show green dots
3. Ignored files don't appear in the list
4. Hover over files to see which rule applied

#### Command Line Verification
```bash
# Check specific file status
windsurf context --explain path/to/file.ts

# Show effective context
# Command Palette → "Windsurf AI: Show Effective Context"
```

### Common Issues and Solutions

#### Rule Not Applied
- **Problem**: Ignore patterns not taking effect
- **Solutions**:
  - Confirm file is at workspace root
  - Reload IDE window
  - Run "Windsurf: Re-index Workspace"
  - Check for conflicting patterns

#### Exception Patterns Not Working
- **Problem**: `!pattern` not overriding `.gitignore`
- **Known Issue**: Exception rules may not take precedence over Git exclusions
- **Workaround**: Modify `.gitignore` or use more specific patterns

#### Over-Exclusion
- **Problem**: Too many files excluded, losing context
- **Solutions**:
  - Use more specific patterns
  - Add exception rules for important interfaces
  - Review and refine broad exclusions

#### Performance Issues
- **Problem**: Slow indexing or large memory usage
- **Solutions**:
  - Exclude large directories early in the file
  - Add binary file exclusions
  - Reduce workspace size limit in settings

### Debugging Techniques

#### Pattern Testing
```gitignore
# Test patterns incrementally
# Start with broad patterns
build/
*.log

# Add specific exceptions
!build/config.json

# Use comments to document decisions
# Exclude test fixtures - too large for context
tests/fixtures/**
```

#### Log Analysis
- **Location**: Check Windsurf logs for ignore pattern processing
- **IDE Logs**: Help → Show Log in Explorer
- **Console Output**: Debug information during indexing

## Best Practices

### Security-First Approach
1. **Default Deny**: Start with restrictive rules, gradually allow
2. **Secret Scanning**: Regularly audit for exposed credentials
3. **Team Training**: Educate team on ignore file importance
4. **Regular Review**: Periodic security review of patterns

### Maintenance Guidelines
1. **Document Decisions**: Comment complex patterns
2. **Version Control**: Always commit ignore files
3. **Team Consistency**: Establish organization-wide standards
4. **Performance Monitoring**: Monitor indexing performance and adjust

### Pattern Organization
```gitignore
# === .codeiumignore TEMPLATE ===
# Organized by category for maintainability

# 1. SECURITY & SECRETS
*.env
*.key
secrets/

# 2. BUILD ARTIFACTS  
build/
dist/
*.class

# 3. LARGE DATA FILES
*.csv
*.zip
data/

# 4. DEVELOPMENT
*.log
.cache/
coverage/

# 5. PROJECT-SPECIFIC
# Add your custom patterns here

# 6. EXCEPTIONS (LAST)
!src/public-api/**
!docs/README.md
```

### Enterprise Deployment
1. **Global Policies**: Deploy managed global `.codeiumignore`
2. **Compliance Mapping**: Map ignore patterns to regulatory requirements
3. **Audit Trails**: Maintain logs of ignore pattern changes
4. **Training Programs**: Regular security awareness training

## Integration with Other Systems

### Git Integration
- **Complementary**: Works alongside `.gitignore`, doesn't replace it
- **Precedence**: `.gitignore` rules are respected by default
- **Override Issues**: Limited ability to override Git exclusions

### CI/CD Integration
```yaml
# Example GitHub Actions validation
name: Validate Ignore Files
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Check ignore file syntax
        run: |
          if [ -f .codeiumignore ]; then
            echo "Validating .codeiumignore syntax"
            # Add syntax validation logic
          fi
```

### Other AI Tools
- **Cursor**: Can adapt patterns from `.cursorignore`
- **Codeium**: Direct compatibility (same underlying system)
- **Generic AI**: Can reuse patterns in `.aiexclude`

This comprehensive specification provides the foundation for understanding and implementing Windsurf's ignore file system, ensuring secure and efficient AI-assisted development workflows while maintaining privacy and performance standards.