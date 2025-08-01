---
root: false
targets: ["*"]
description: "AugmentCode ignore files specification for controlling AI file access"
globs: []
---

# AugmentCode Ignore Files Specification

## Overview
AugmentCode uses ignore files to control which files are uploaded to the cloud index and made available to the AI. The system uses a two-tier approach combining Git ignore patterns with Augment-specific exclusions.

## File Types and Processing Order

### 1. .gitignore (First Pass)
- **Purpose**: Standard Git ignore patterns
- **Processing**: Evaluated first, identical to Git behavior
- **Location**: Repository root (and subdirectories as per Git rules)
- **Scope**: Excludes files from both Git and Augment indexing

### 2. .augmentignore (Second Pass)
- **Purpose**: Augment-specific exclusions and re-inclusions
- **Processing**: Evaluated after .gitignore patterns
- **Location**: Repository root only
- **Scope**: AI-specific file visibility control

## File Location and Naming

### .augmentignore Placement
- **Primary location**: Repository root as `.augmentignore`
- **Scope**: Applies to entire workspace
- **Version control**: Should be committed to repository for team consistency
- **Single file**: No support for nested .augmentignore files

### File Discovery
```text
<repository-root>/
├── .gitignore              # Standard Git ignore
├── .augmentignore          # Augment-specific ignore
├── src/
│   └── components/
└── docs/
```

## Syntax and Pattern Matching

### Pattern Syntax (Identical to Git)
AugmentCode uses exactly the same glob syntax as Git:

#### Basic Patterns
- **Blank lines**: Ignored (used as separators)
- **Comments**: Lines starting with `#`
- **Wildcards**:
  - `*`: Matches any characters except `/`
  - `?`: Matches any single character except `/`
  - `[abc]`: Matches any character in the set
  - `[a-z]`: Matches any character in the range

#### Path Patterns
- **Leading `/`**: Anchors pattern to repository root
  - `/build` matches only build directory at root
  - `build` matches any build directory at any level
- **Trailing `/`**: Matches only directories
  - `logs/` matches directories named logs
  - `logs` matches both files and directories named logs
- **Double asterisk `**`**: Matches zero or more directories
  - `**/test` matches test anywhere in the tree
  - `docs/**` matches everything under docs
  - `**/*.log` matches all .log files at any depth

### Negation Patterns (Re-inclusion)
- **Leading `!`**: Negates a pattern and re-includes previously excluded items
- **Evaluation order**: Last matching rule wins
- **Use case**: Re-include specific files that were excluded by broader patterns

## Evaluation Logic

### Processing Flow
1. **Git ignore evaluation**: All .gitignore patterns applied first
2. **Augment ignore evaluation**: .augmentignore patterns applied second
3. **Final determination**: Last matching rule determines file visibility

### Rule Precedence
```text
File path: src/components/Button.tsx

1. .gitignore contains: src/**
   → File excluded

2. .augmentignore contains: !src/components/*.tsx
   → File re-included (negation overrides exclusion)

Result: File is indexed by Augment
```

## Common Ignore Patterns

### Security and Secrets
```gitignore
# Environment files
.env*

# Private keys and certificates
*.pem
*.key
*.p12
*.crt
*.der

# SSH keys
id_rsa*
id_dsa*

# AWS credentials
.aws/
aws-exports.js

# API keys and tokens
**/apikeys/
**/*_token*
**/*_secret*
```

### Build Artifacts and Dependencies
```gitignore
# Build outputs
dist/
build/
out/
target/

# Dependencies
node_modules/
venv/
*.egg-info/

# Logs
*.log
logs/

# Temporary files
*.tmp
*.swp
*.swo
*~
```

### Large Files and Media
```gitignore
# Binary files
*.jar
*.png
*.jpg
*.jpeg
*.gif
*.mp4
*.avi
*.zip
*.tar.gz
*.rar

# Database files
*.sqlite
*.db
*.mdb

# Data files
*.csv
*.tsv
*.xlsx
```

## Re-inclusion Patterns

### Selective Re-inclusion
Use negation patterns to include specific files that were previously excluded:

```gitignore
# Exclude all node_modules
node_modules/

# But include specific documentation
!node_modules/some-package/README.md
!node_modules/*/types.d.ts

# Exclude all build artifacts
dist/**

# But include type definitions
!dist/**/*.d.ts
```

### Configuration Files
```gitignore
# Exclude all config files
config/**

# Re-include example configurations
!config/example.*
!config/sample-*
!config/*.template.*
```

## Team Collaboration

### Version Control Best Practices
1. **Commit .augmentignore**: Include in repository for team consistency
2. **Document patterns**: Add comments explaining complex rules
3. **Regular reviews**: Audit ignore patterns during code reviews
4. **Test patterns**: Verify rules work as expected before committing

### Team Workflow
```gitignore
# Team-specific .augmentignore example

# Exclude large generated files that slow indexing
assets/generated/**
public/build/**

# Exclude test fixtures with sensitive data
tests/fixtures/real-data/**

# Re-include important documentation
!vendor/*/README.md
!third-party/*/LICENSE

# Exclude personal IDE settings
.vscode/settings.json
.idea/workspace.xml

# But include shared team settings
!.vscode/extensions.json
!.idea/codeStyles/
```

## Performance Considerations

### Optimization Guidelines
- **Exclude large files**: Binary files, media, and large datasets slow indexing
- **Exclude generated code**: Build outputs provide little value for AI context
- **Include relevant libraries**: Sometimes library source helps with completions
- **Monitor index size**: Use workspace context view to check indexed content

### File Size Impact
```gitignore
# Exclude files that are too large for effective AI processing
**/*.{mp4,avi,mov,mkv}
**/*.{zip,tar,gz,rar}
**/*.{pdf,doc,docx}
**/logs/**/*.log

# But include small configuration files
!**/config.{json,yaml,yml}
```

## Troubleshooting

### Debugging Ignore Rules
1. **View indexed content**:
   - VS Code: "Augment: Show Workspace Context"
   - Vim: ":Augment status"

2. **Check rule conflicts**:
   - Look for later rules that may re-include files
   - Verify pattern syntax and paths

3. **Test patterns**:
   - Use Git's `git check-ignore -v path/to/file` to test patterns
   - Check if .gitignore rules are affecting files unexpectedly

### Common Issues

#### File Still Indexed Despite Ignore Rule
- **Cause**: Later negation rule re-includes the file
- **Solution**: Review all patterns, ensure exclusions come after re-inclusions

#### Expected File Not Indexed  
- **Cause**: Earlier pattern excludes the file
- **Solution**: Add negation pattern in .augmentignore to override

#### Pattern Not Working
- **Cause**: Incorrect syntax or path matching
- **Solution**: Test with Git tools, verify pattern matches intended paths

## Integration with Development Workflow

### Workspace Indexing
- **Initial index**: Created when workspace opens
- **Re-indexing**: Triggered by file changes and ignore rule updates
- **Manual re-index**: Available through command palette

### Commands for Index Management
```bash
# VS Code Command Palette
> Augment: Show Workspace Context
> Augment: Re-index workspace

# Check what's currently indexed
> Augment: View Index Status
```

### Privacy and Security

#### Data Protection
- Files matching ignore patterns are never uploaded to Augment's cloud
- Local processing only for excluded files
- Tenant-isolated backend with secure token authentication
- Regular security audits of ignore rule effectiveness

#### Sensitive File Protection
```gitignore
# Critical security exclusions
.env*
*.pem
*.key
*.p12
secrets/**
credentials/**

# Personal information
personal-notes/**
private/**
confidential/**

# Internal company data
internal-docs/**
proprietary/**
```

## Best Practices Summary

### Organization
1. **Logical grouping**: Group related patterns with comments
2. **Security first**: Place security exclusions at the top
3. **Team consensus**: Agree on ignore patterns as a team
4. **Documentation**: Comment complex or non-obvious patterns

### Maintenance
1. **Regular review**: Audit patterns during project evolution
2. **Performance monitoring**: Check impact on indexing speed
3. **Rule validation**: Test patterns before committing
4. **Cleanup**: Remove obsolete patterns

### Security
1. **Secrets protection**: Always exclude credential files
2. **Privacy compliance**: Exclude files with personal data
3. **Access control**: Use patterns to enforce data access policies
4. **Audit trail**: Track changes to ignore rules

## Advanced Patterns

### Conditional Inclusion by Directory
```gitignore
# Exclude all vendor code
vendor/**

# But include specific vendors we want AI to understand
!vendor/critical-lib/**
!vendor/our-fork/**
```

### Environment-Specific Rules
```gitignore
# Exclude production configurations
config/production/**
deploy/prod/**

# Include development and staging
!config/development/**
!config/staging/**
```

### File Type-Based Exclusions
```gitignore
# Exclude all images except SVGs
*.png
*.jpg
*.gif
!*.svg

# Exclude all data files except small samples
data/**/*.csv
data/**/*.json
!data/samples/**
```

## Summary

AugmentCode's ignore file system provides comprehensive control over AI file access through:

- **Two-tier processing**: Git ignore patterns followed by Augment-specific rules
- **Standard syntax**: Familiar Git glob patterns and negation rules
- **Team collaboration**: Version-controlled ignore rules for consistency
- **Security focus**: Protection of sensitive files and credentials
- **Performance optimization**: Exclusion of large files and build artifacts
- **Flexible re-inclusion**: Granular control over file visibility

The system balances security, performance, and AI effectiveness by allowing teams to precisely control what context the AI can access while maintaining familiar Git-like syntax and workflow integration.