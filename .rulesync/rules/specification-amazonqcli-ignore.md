---
root: false
targets: ["*"]
description: "Amazon Q Developer CLI ignore files specification for controlling file access and exclusion patterns"
globs: []
---

# Amazon Q Developer CLI Ignore Files Specification

## Overview
Amazon Q Developer CLI currently has limited built-in support for dedicated ignore files. While a `.q-ignore` or `.amazonqignore` file has been requested by the community, it is not yet implemented. However, there are configuration approaches and workarounds for managing file exclusion and access control.

## Current State

### No Native Ignore File Support
- **Status**: No dedicated ignore file system implemented as of current version
- **Community Request**: Active GitHub issue requesting `.q-ignore` functionality
- **Limitation**: No built-in way to exclude files/directories from Amazon Q operations
- **Impact**: All accessible files may be processed by Amazon Q

### Requested `.q-ignore` Functionality
Based on community feedback, the requested functionality would include:

#### Proposed File Location
- **File**: `.q-ignore` or `.amazonqignore` in project root
- **Syntax**: Similar to `.gitignore` syntax
- **Purpose**: Exclude files/directories from Amazon Q uploads and processing

#### Expected Benefits
- Reduce upload size to stay within 200MB limit
- Exclude unnecessary files (dependencies, build artifacts)
- Focus on relevant code and documentation
- Protect sensitive files from AI processing

## Proposed Ignore Patterns

### Common Exclusion Patterns
Based on the community request, typical patterns would include:

#### Dependencies and Modules
```gitignore
# Node.js dependencies
node_modules/
.pnpm-store/
.yarn/

# Python virtual environments
venv/
.venv/
__pycache__/

# Ruby gems
vendor/bundle/

# Go modules cache
go.mod
go.sum
```

#### Build Artifacts
```gitignore
# Build outputs
build/
dist/
out/
target/

# Compiled binaries
*.exe
*.dll
*.so
*.dylib

# Archive files
*.zip
*.tar.gz
*.rar
```

#### Development Files
```gitignore
# IDE and editor files
.vscode/
.idea/
*.swp
*.swo

# OS specific files
.DS_Store
Thumbs.db
desktop.ini

# Log files
*.log
logs/
```

#### Data and Media Files
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
*.png
*.jpg
*.jpeg
*.gif

# Large test files
test-data/
fixtures/large-*
```

#### Security-Sensitive Files
```gitignore
# Environment files
.env
.env.*
!.env.example

# Secrets and credentials
*.pem
*.key
*.crt
secrets/
credentials/

# Configuration files
config/production/
config/secrets/
```

### Project-Specific Patterns
```gitignore
# Legacy code
legacy-code/
deprecated/

# Generated documentation
docs/generated/
api-docs/

# Temporary directories
tmp/
temp/
.tmp/

# Backup files
*.bak
*.backup
```

## Current Workarounds

### 1. File Organization
Structure projects to naturally separate relevant from irrelevant files:

```
project/
├── src/              # Source code (relevant)
├── docs/             # Documentation (relevant)
├── tests/            # Test files (relevant)
├── build/            # Build artifacts (exclude)
├── node_modules/     # Dependencies (exclude)
└── data/             # Large data files (exclude)
```

### 2. Context Management
Use Amazon Q's context management to selectively include files:

```bash
# Add specific files/directories to context
/context add file://src/
/context add file://docs/

# Remove unwanted context
/context rm file://build/
/context clear
```

### 3. Agent Configuration
Configure agents to focus on specific resource patterns:

```json
{
   "name": "focused-agent",
   "resources": [
     "file://src/**/*.js",
     "file://src/**/*.ts",
     "file://docs/**/*.md",
     "file://README.md"
   ]
}
```

## Implementation Expectations

### Expected File Format
When implemented, the ignore file would likely follow `.gitignore` syntax:

```gitignore
# Comments start with hash
# Blank lines are ignored

# Exclude specific files
config/secrets.json
api-keys.txt

# Exclude directories
node_modules/
build/
dist/

# Exclude file patterns
*.log
*.tmp
*.cache

# Exclude paths with wildcards
**/temp/
data/**/*.csv

# Negation patterns (re-include)
!src/important.log
!docs/README.md
```

### Pattern Syntax
Expected to support standard gitignore patterns:
- `*` - Match any characters except `/`
- `?` - Match single character
- `**` - Match zero or more directories
- `/` at start - Root-relative path
- `/` at end - Directory match only
- `!` at start - Negation (re-include)

## Best Practices (Future)

### Security Considerations
When ignore functionality becomes available:

```gitignore
# Always exclude secrets
.env*
*.pem
*.key
secrets/
credentials/

# Exclude sensitive config
config/production/
database.yml
aws-credentials.json
```

### Performance Optimization
```gitignore
# Exclude large files
*.zip
*.tar.gz
*.mp4
*.avi

# Exclude build artifacts
build/
dist/
target/
out/

# Exclude dependencies
node_modules/
vendor/
venv/
```

### Development Workflow
```gitignore
# Exclude temporary files
*.tmp
*.swp
*.swo
.DS_Store

# Exclude IDE specific
.vscode/settings.json
.idea/workspace.xml

# Exclude logs
*.log
logs/
debug/
```

## Alternative Solutions

### 1. Git Integration
Currently, Amazon Q may respect some Git ignore patterns in certain contexts:
- Files ignored by Git may be naturally excluded
- Not a complete solution but provides some filtering

### 2. Selective File Operations
Manually control which files Amazon Q processes:
- Use specific file paths in commands
- Leverage context management features
- Configure agent resources carefully

### 3. Project Structure
Design project structure to minimize unwanted file exposure:
- Keep relevant files in dedicated directories
- Isolate build artifacts and dependencies
- Use clear naming conventions

## Monitoring and Feedback

### Community Involvement
- GitHub Issue: Track progress on `.q-ignore` implementation
- Feature Requests: Provide feedback on desired functionality
- Use Cases: Share specific needs and requirements

### Current Limitations
- No automatic file exclusion
- Manual context management required
- Potential for processing unwanted files
- Size limits may be reached with large projects

## Implementation Timeline

### Current Status
- **Requested**: Community has requested ignore file functionality
- **Acknowledged**: AWS team is aware of the request
- **Timeline**: No official timeline provided
- **Priority**: High community interest but not yet implemented

### Expected Features
When implemented, likely features include:
- Standard gitignore-like syntax
- Project-root placement
- Automatic file exclusion
- Integration with existing context system
- Performance optimizations for large projects

## Migration Planning

### Preparing for Implementation
When ignore functionality becomes available:

1. **Document Current Workarounds**: Note current file management strategies
2. **Identify Exclusion Needs**: List files/patterns to exclude
3. **Plan Migration**: Prepare for transition to native ignore system
4. **Team Training**: Educate team on new functionality

### Backward Compatibility
Expected to maintain compatibility with:
- Existing context management
- Current agent configurations  
- Manual file selection workflows

## Summary

Amazon Q Developer CLI ignore file specification:

- **Current State**: No native ignore file support implemented
- **Community Request**: Active demand for `.q-ignore` functionality  
- **Workarounds**: Context management and agent configuration
- **Expected Implementation**: Gitignore-like syntax and behavior
- **Benefits**: Improved performance, security, and relevance
- **Timeline**: Requested but not yet scheduled for implementation

Until native ignore functionality is available, developers should use context management, agent configuration, and careful project structure to control which files Amazon Q processes. The community continues to advocate for this important feature to improve the tool's usability and security.