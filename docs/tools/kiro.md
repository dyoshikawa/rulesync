# Kiro IDE Integration

## Overview

Kiro IDE features built-in project management with core steering files. rulesync provides **Custom Steering Documents** and **AI Ignore Files** that complement Kiro's native project management system without duplicating core functionality.

## Generated Files

| File Type | Output Path | Description |
|-----------|-------------|-------------|
| **Custom Steering** | `.kiro/steering/*.md` | Additional steering documents |
| **AI Ignore Rules** | `.aiignore` | File exclusion patterns for AI access |
| **MCP Configuration** | `.kiro/mcp.json` | Model Context Protocol servers |

## Division of Responsibility

### What rulesync Provides
- **Custom Steering Documents**: Additional `.md` files in `.kiro/steering/` directory
- **AI Ignore Files**: `.aiignore` file for excluding sensitive files from AI
- **Project-Specific Rules**: Team coding standards, security guidelines
- **Rule Synchronization**: Consistent rules across team members
- **Pattern-Based Exclusions**: Intelligent ignore pattern generation

### What Kiro IDE Handles Directly  
- **Core Steering Files**: `product.md` (requirements), `structure.md` (architecture), `tech.md` (stack)
- **Spec Management**: Feature specifications in `.kiro/specs/`
- **Agent Hooks**: Automated context application
- **Project Initialization**: Built-in project setup and management

## Usage Examples

### Generate Kiro Configuration

```bash
# Generate only for Kiro IDE
npx rulesync generate --kiro

# Generate with verbose output
npx rulesync generate --kiro --verbose

# Generate in specific directory
npx rulesync generate --kiro --base-dir ./packages/frontend
```

### Import Existing Configuration

```bash
# Import from existing Kiro setup (limited)
npx rulesync import --kiro

# Note: Kiro's core files are managed by IDE itself
```

## File Organization

### Standard Structure
```
.kiro/
├── steering/
│   ├── coding-standards.md     # Custom steering (rulesync)
│   ├── security-guidelines.md  # Custom steering (rulesync)
│   ├── deployment-process.md   # Custom steering (rulesync)
│   ├── product.md             # Core steering (Kiro IDE)
│   ├── structure.md           # Core steering (Kiro IDE)
│   └── tech.md                # Core steering (Kiro IDE)
├── specs/                     # Feature specs (Kiro IDE)
└── mcp.json                   # MCP configuration (rulesync)

.aiignore                      # AI ignore patterns (rulesync)
```

### Custom Steering Examples

**Coding Standards** (`.kiro/steering/coding-standards.md`):
```markdown
# Team Coding Standards

## TypeScript Guidelines
- Use strict TypeScript configuration
- Prefer interfaces over types for object shapes
- Implement comprehensive error handling
- Write descriptive variable names

## Code Organization
- One component per file
- Co-locate tests with components
- Use barrel exports for clean imports
- Follow feature-based directory structure

## Quality Requirements
- Maintain 80%+ test coverage
- Use ESLint and Prettier for formatting
- Write JSDoc comments for public APIs
- Follow semantic versioning
```

**Security Guidelines** (`.kiro/steering/security-guidelines.md`):
```markdown
# Security Standards

## Data Protection
- Never commit secrets or API keys to repository
- Use environment variables for all configuration
- Validate and sanitize all user inputs
- Implement proper error handling without information disclosure

## Authentication & Authorization
- Use secure session management
- Implement role-based access control
- Log all security-relevant events
- Regular dependency security updates

## Infrastructure Security
- Use HTTPS for all external communications
- Implement proper CORS policies
- Configure secure headers
- Regular security assessments
```

## AI Ignore File Features

### Security-First Exclusions

rulesync automatically generates comprehensive ignore patterns:

```gitignore
# Automatically excluded sensitive files
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

# Configuration with secrets
config/secrets/
**/database.yml
aws-credentials.json
gcp-service-account*.json
```

### Data File Exclusions
```gitignore
# Large data files that might confuse AI
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

### Sensitive Documentation
```gitignore
# Internal documentation
confidential/
internal-docs/
company-secrets/
strategy/
financial/

# Customer data
customer-data/
pii/
gdpr/
**/*customer*.csv
**/*personal*.json
```

### Pattern-Based Exclusions

rulesync analyzes rule globs to identify AI-sensitive patterns:

```yaml
# Rule with security-related glob patterns
---
globs: ["**/auth/**", "**/security/**", "**/*.env*"]
---
```

Generates corresponding ignore patterns:
```gitignore
# AI-sensitive patterns from rule analysis
**/auth/**
**/security/**
**/*.env*
```

## MCP Integration

### MCP Configuration

Kiro IDE supports MCP servers through `.kiro/mcp.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "env": {
        "LOG_LEVEL": "info"
      }
    },
    "aws-tools": {
      "command": "python",
      "args": ["-m", "aws_mcp_server"],
      "env": {
        "AWS_PROFILE": "dev",
        "AWS_REGION": "us-east-1"
      },
      "kiroAutoApprove": ["describe_instances", "list_buckets"],
      "kiroAutoBlock": ["delete_bucket", "terminate_instances"]
    }
  }
}
```

### Kiro-Specific MCP Fields
- **`kiroAutoApprove`**: Array of tool names to automatically approve
- **`kiroAutoBlock`**: Array of tool names to automatically block
- **Enhanced Security**: Fine-grained control over MCP tool access

## Integration Benefits

### Complementary Enhancement
- **Extends Core Functionality**: Adds team-specific rules without duplicating Kiro's built-in features
- **Security Enhancement**: Provides comprehensive AI access control
- **Team Standardization**: Consistent custom rules across team members
- **Pattern Intelligence**: Smart ignore pattern generation from rule analysis

### Development Workflow
- **Focused AI Access**: AI only sees relevant, non-sensitive files
- **Context Preservation**: Custom steering provides additional project context
- **Security Baseline**: Comprehensive exclusion of sensitive patterns
- **Team Collaboration**: Shared custom steering documents

## Advanced Features

### Explicit Ignore Patterns

Support for manual ignore patterns in rule content:

```markdown
# Security Rules

## File Exclusions
The following patterns should be excluded from AI access:

# IGNORE: **/secrets/**
# aiignore: **/private-keys/**

Files matching these patterns contain sensitive information.
```

### Multi-Environment Support
```markdown
# Environment-Specific Guidelines

## Development Environment
- Use local configuration files
- Enable debug logging
- Allow experimental features

## Production Environment  
- Use secure configuration management
- Minimal logging for performance
- Strict access controls
```

### Custom Tool Integration
```markdown
# Custom Development Tools

## Build Tools
- Use custom build scripts in `/scripts`
- Validate builds in CI/CD pipeline
- Generate deployment artifacts

## Testing Framework
- Use custom testing utilities
- Implement performance benchmarks
- Generate coverage reports
```

## Best Practices

### Custom Steering Design
1. **Complement Core Files**: Don't duplicate product.md, structure.md, or tech.md content
2. **Team-Specific Focus**: Include rules specific to team practices and standards
3. **Security First**: Always include comprehensive security guidelines
4. **Regular Updates**: Keep custom steering current with project evolution

### Ignore File Management
1. **Security Baseline**: Start with comprehensive security exclusions
2. **Pattern Analysis**: Let rulesync identify AI-sensitive patterns from rules
3. **Regular Audits**: Review ignore patterns periodically
4. **Team Consistency**: Ensure all team members use same ignore patterns

### MCP Configuration
1. **Security Controls**: Use `kiroAutoApprove` and `kiroAutoBlock` appropriately
2. **Least Privilege**: Grant minimal necessary MCP tool access
3. **Environment Separation**: Use different MCP configs for dev/staging/prod
4. **Access Logging**: Monitor MCP tool usage for security

## Migration Strategies

### From Manual Steering
1. **Audit Existing**: Review current custom steering documents
2. **Categorize Content**: Organize into team standards vs core project info
3. **Security Analysis**: Identify sensitive patterns for ignore file
4. **rulesync Integration**: Convert to `.rulesync/` format

### From Other AI Tools
1. **Multi-Tool Import**: Import rules from various AI tools
2. **Kiro Adaptation**: Adapt content for Kiro's steering system
3. **Security Enhancement**: Add comprehensive ignore patterns
4. **Team Training**: Educate team on Kiro integration approach

## Troubleshooting

### Common Issues
1. **Core Files Overwritten**: Ensure rulesync doesn't modify core steering files
2. **Ignore Patterns Too Broad**: Review and refine `.aiignore` patterns
3. **MCP Access Denied**: Check `kiroAutoApprove` and security configurations
4. **Context Missing**: Balance ignore patterns with AI context needs

### Debugging Steps
1. **Check File Structure**: Verify custom steering files are in correct location
2. **Review Ignore Patterns**: Test ignore patterns against actual files
3. **Validate MCP Config**: Check MCP server configuration and permissions
4. **Monitor AI Access**: Verify AI has appropriate file access

## Security Considerations

### File Access Control
- **Default Deny**: Use comprehensive ignore patterns by default
- **Selective Access**: Only expose necessary files to AI
- **Sensitive Data Protection**: Exclude all potential sensitive information
- **Regular Audits**: Review and update ignore patterns regularly

### MCP Security
- **Tool Restrictions**: Use `kiroAutoBlock` for dangerous operations
- **Access Logging**: Monitor MCP tool invocations
- **Environment Isolation**: Separate MCP configs by environment
- **Principle of Least Privilege**: Grant minimal necessary access

## See Also

- [MCP Integration](../features/mcp.md) - Model Context Protocol configuration
- [Configuration](../configuration.md) - General configuration options
- [Best Practices](../guides/best-practices.md) - Steering document strategies