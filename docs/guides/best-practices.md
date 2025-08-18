# Best Practices

## Overview

This guide provides proven strategies and best practices for effectively using rulesync in development teams. These practices are based on real-world usage across various project types and team sizes.

## Rule Organization

### Rule Hierarchy Design

#### Single Root Rule
- **One Project Overview**: Maintain exactly one root rule per project
- **High-Level Context**: Include project purpose, tech stack, and core principles
- **Team Guidelines**: Focus on shared understanding and collaboration standards

**Example Root Rule Structure**:
```yaml
---
root: true
targets: ["*"]
description: "Core project context and development philosophy"
globs: ["**/*"]
---

# Project: E-commerce Platform

Modern, scalable e-commerce solution built with React and Node.js.

## Mission
Provide fast, secure, and user-friendly online shopping experience.

## Tech Stack
- Frontend: React 18 + TypeScript + Tailwind CSS
- Backend: Node.js + Express + PostgreSQL
- Infrastructure: Docker + AWS + CDN

## Core Principles
1. Security-first development
2. Performance optimization
3. Accessibility compliance (WCAG 2.1)
4. Mobile-first design
```

#### Focused Detail Rules
- **Single Responsibility**: Each rule covers one specific aspect
- **Clear Boundaries**: Avoid overlap between rule files
- **Descriptive Names**: Use clear, descriptive filenames

**Rule Organization Examples**:
```
.rulesync/
├── overview.md                  # Root rule (project context)
├── security-guidelines.md       # Security rules
├── typescript-standards.md      # Language-specific rules
├── testing-requirements.md      # Testing standards
├── api-design-patterns.md       # Backend patterns
├── ui-component-guidelines.md   # Frontend patterns
└── deployment-procedures.md     # DevOps guidelines
```

### Content Structure Standards

#### Consistent Formatting
```markdown
# Rule Title

**Description**: Brief description of the rule's purpose and scope

## Core Requirements
- Mandatory practices that must always be followed
- Non-negotiable standards and security requirements

## Guidelines
- Recommended practices for better code quality
- Performance optimizations and best practices

## Examples
```language
// Code examples demonstrating correct implementation
```

## Anti-patterns
- What NOT to do
- Common mistakes to avoid
```

#### Actionable Content
- **Specific Instructions**: Provide concrete, actionable guidance
- **Code Examples**: Include relevant code snippets and patterns
- **Clear Expectations**: Define what success looks like
- **Measurable Criteria**: Include quantifiable standards where possible

### Rule Scope and Targeting

#### Strategic Tool Targeting
```yaml
# Security-critical rules for all tools
---
targets: ["*"]
description: "Security requirements for all development"
globs: ["**/*"]
---

# Performance-specific rules for specific tools
---
targets: ["cursor", "windsurf"]
description: "Performance optimization patterns"
globs: ["**/*.ts", "**/*.tsx"]
---

# Manual tools for specialized tasks
---
targets: ["claudecode"]
cursorRuleType: "manual"
description: "Deployment and infrastructure management"
---
```

#### Glob Pattern Best Practices
```yaml
# Good: Specific and purposeful
globs: [
  "src/**/*.ts",           # TypeScript files in src
  "components/**/*.tsx",   # React components
  "!**/*.test.*",          # Exclude test files
  "!**/node_modules/**"    # Exclude dependencies
]

# Avoid: Too broad or meaningless
globs: [
  "**/*",                  # Too broad (unless intentional)
  "*.js",                  # Missing src directory context
  "**/*.{js,ts,jsx,tsx}"   # Complex patterns without clear purpose
]
```

## Team Collaboration

### Version Control Strategy

#### Rule File Management
```bash
# Include rule files in version control
git add .rulesync/
git add rulesync.jsonc

# Consider ignoring generated files
.cursor/rules/
.claude/memories/
.github/instructions/
CLAUDE.md
GEMINI.md
codex.md

# Keep MCP configurations under version control
.rulesync/.mcp.json
```

#### Change Management Process
1. **Rule Changes**: Include rule modifications in pull requests
2. **Team Review**: Require review for significant rule changes
3. **Documentation**: Update commit messages with rule change rationale
4. **Testing**: Test rule changes with actual AI tools before merging

### Team Adoption Strategy

#### Gradual Rollout
```
Phase 1: Core Team Setup (1-2 developers)
├── Initial rule creation
├── Tool integration testing
├── Workflow refinement
└── Documentation creation

Phase 2: Team Expansion (small team)
├── Onboard 2-3 additional team members
├── Collect feedback and iterate
├── Refine development workflow
└── Establish team standards

Phase 3: Full Adoption (entire team)
├── All team members using rulesync
├── Integrated into development process
├── Continuous improvement process
└── Knowledge sharing established
```

#### Training and Documentation
1. **Installation Guide**: Team-specific setup instructions
2. **Usage Examples**: Real project examples and scenarios
3. **Tool Integration**: How to use with team's preferred AI tools
4. **Troubleshooting**: Common issues and solutions

### Communication and Feedback

#### Regular Rule Reviews
```markdown
# Monthly Rule Review Agenda

## Effectiveness Review
- Which rules are most helpful?
- Which rules are being ignored?
- Are there gaps in current rules?

## Content Updates
- New technologies or frameworks adopted?
- Changes in team practices or standards?
- Updates from AI tool feature releases?

## Process Improvements
- Workflow optimization opportunities?
- Tool integration improvements?
- Automation possibilities?
```

## Performance Optimization

### Rule File Size Management

#### Content Optimization
- **Concise Language**: Use clear, brief language without unnecessary detail
- **Focused Scope**: Keep each rule file focused on specific topics
- **Remove Duplication**: Avoid repeating information across rules
- **Reference External Docs**: Link to detailed external documentation

#### Size Guidelines
```
Optimal Sizes:
- Root rule: 500-1500 words
- Detail rules: 200-800 words per file
- Total project rules: Under 5000 words

Performance Impact:
- <2000 words: Minimal impact on AI response time
- 2000-5000 words: Slight increase in processing time
- >5000 words: Noticeable performance impact
```

### Generation Optimization

#### Selective Generation
```bash
# Generate only for tools you actually use
npx rulesync generate --cursor --claudecode

# Use configuration file for consistent settings
# rulesync.jsonc
{
  "targets": ["cursor", "claudecode", "windsurf"],
  "exclude": ["roo", "augmentcode"],
  "delete": true,
  "verbose": false
}
```

#### Automated Workflows
```yaml
# .github/workflows/rulesync.yml
name: Update AI Configurations

on:
  push:
    branches: [main]
    paths: ['.rulesync/**']

jobs:
  update-configs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - run: npm install -g rulesync
      - run: npx rulesync generate
      
      - name: Commit updated configurations
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add .
          git diff --staged --quiet || git commit -m "Update AI tool configurations"
          git push
```

## Security and Privacy

### Sensitive Information Handling

#### Secret Management
```yaml
# Good: Environment variable reference
env:
  API_KEY: "${GITHUB_TOKEN}"
  DATABASE_URL: "${DATABASE_URL}"

# Bad: Hardcoded secrets
env:
  API_KEY: "ghp_xxxxxxxxxxxx"
  DATABASE_URL: "postgresql://user:password@host/db"
```

#### Rule Content Security
```markdown
# Good: General security guidance
## API Security
- Use environment variables for all API keys
- Implement rate limiting on public endpoints
- Validate all inputs with proper schemas

# Bad: Specific internal information
## API Security
- Use our internal API key: abc123xyz
- Database password is stored in vault-secret-123
- Production server IP: 192.168.1.100
```

### Ignore File Best Practices

#### Security-First Exclusions
```gitignore
# .rulesyncignore - Security patterns
*.pem
*.key
*.crt
*.p12
*.pfx
.env*
!.env.example

# Secrets directories
secrets/
credentials/
**/private/**

# Database files
*.db
*.sqlite
*.dump

# Backup files
*.backup
*.bak
*-backup.*
```

#### Performance Exclusions
```gitignore
# Large data files
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
*.gif

# Build artifacts
dist/
build/
node_modules/
```

### Permission-Based Security (OpenCode)

OpenCode revolutionizes AI security with granular permission controls instead of traditional ignore files:

#### Permission Level Strategy
```jsonc
{
  "permission": {
    // Start restrictive, gradually relax
    "read": {
      "default": "ask",           // Require confirmation for reads
      "patterns": {
        "*.md": "allow",          // Documentation is safe
        "src/**/*.ts": "allow",   // Source code allowed
        ".env*": "deny",          // Secrets always denied
        "secrets/**": "deny"      // Sensitive directories denied
      }
    },
    "write": {
      "default": "ask",           // Confirm all write operations
      "patterns": {
        "*.md": "allow",          // Documentation updates allowed
        "package.json": "ask",    // Package changes need confirmation
        "src/**/*.test.ts": "allow", // Test files safe to modify
        ".env*": "deny",          // Never modify environment files
        "dist/**": "deny"         // Never modify build outputs
      }
    },
    "run": {
      "default": "ask",           // Confirm all command execution
      "patterns": {
        "npm test": "allow",      // Test commands are safe
        "npm run build": "allow", // Build commands allowed
        "rm *": "deny",          // Destructive commands denied
        "sudo *": "deny"         // Elevated commands denied
      }
    }
  }
}
```

#### Security Benefits over Traditional Ignore Files
- **Granular Control**: Separate permissions for read, write, and execute operations
- **Pattern-Based**: Fine-grained control over specific file patterns and commands
- **Dynamic Security**: Permissions can be adjusted per operation type
- **Audit Trail**: Clear visibility into what AI can and cannot access
- **Future-Proof**: Extensible permission model for new security requirements

#### Best Practices for Permission Configuration
```jsonc
{
  "permission": {
    // 1. Start with restrictive defaults
    "read": { "default": "ask" },
    "write": { "default": "ask" },
    "run": { "default": "ask" },
    
    // 2. Allow safe, common operations
    "patterns": {
      "*.md": "allow",              // Documentation
      "src/**/*.ts": "allow",       // Source code reading
      "npm run test": "allow",      // Safe commands
      "npm run lint": "allow"
    },
    
    // 3. Explicitly deny dangerous operations
    "patterns": {
      ".env*": "deny",              // Environment files
      "rm -rf *": "deny",           // Destructive commands
      "sudo *": "deny",             // Elevated privileges
      "production/**": "deny"       // Production code
    },
    
    // 4. Use environment-specific configurations
    "development": {
      "write": { "default": "allow" }, // More permissive in dev
      "run": { "default": "allow" }
    },
    "production": {
      "write": { "default": "deny" },  // Restrictive in prod
      "run": { "default": "deny" }
    }
  }
}
```

## Development Workflow Integration

### Continuous Integration

#### Pre-commit Validation
```bash
#!/bin/sh
# .git/hooks/pre-commit

# Validate rules before committing
if ! npx rulesync validate --quiet; then
    echo "❌ rulesync validation failed. Fix errors before committing."
    npx rulesync validate  # Show errors
    exit 1
fi

# Regenerate configurations
npx rulesync generate --quiet

# Stage any updated generated files
git add .cursor/rules/ .claude/memories/ .github/instructions/

echo "✅ rulesync validation passed and configurations updated."
```

#### CI Pipeline Integration
```yaml
# Validation job
validate-rules:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: npm install -g rulesync
    - run: npx rulesync validate

# Generation verification job
verify-generation:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: npm install -g rulesync
    - run: npx rulesync generate
    - name: Check for uncommitted changes
      run: |
        if ! git diff --exit-code; then
          echo "Generated files are out of sync. Run 'npx rulesync generate' locally."
          exit 1
        fi
```

### Local Development Setup

#### Editor Configuration
**VS Code** (`.vscode/settings.json`):
```json
{
  "files.associations": {
    ".rulesync/*.md": "markdown"
  },
  "yaml.schemas": {
    "https://rulesync.dev/schemas/rule.json": ".rulesync/*.md"
  },
  "markdown.extension.toc.updateOnSave": true,
  "files.autoSave": "onFocusChange"
}
```

#### Development Scripts
**`package.json`**:
```json
{
  "scripts": {
    "rules:validate": "rulesync validate",
    "rules:generate": "rulesync generate",
    "rules:clean": "rulesync generate --delete",
    "rules:status": "rulesync status",
    "rules:watch": "rulesync watch"
  }
}
```

## Advanced Patterns

### Multi-Environment Rules

#### Environment-Specific Configurations
```yaml
# .rulesync/environment-guidelines.md
---
targets: ["*"]
description: "Environment-specific development guidelines"
globs: ["**/*"]
---

# Environment Guidelines

## Development Environment
- Enable verbose logging and debug modes
- Use local development databases
- Allow experimental features and rapid prototyping
- Relaxed performance constraints for development speed

## Staging Environment
- Production-like configuration with test data
- Enable monitoring and performance profiling
- Comprehensive automated testing
- Security testing and vulnerability scanning

## Production Environment
- Minimal logging for performance optimization
- Strict error handling and graceful degradation
- Performance monitoring and alerting
- Security hardening and access controls
```

### Monorepo Management

#### Package-Specific Rules
```bash
# Generate for different packages with specific configurations
npx rulesync generate --base-dir ./packages/frontend --config frontend.jsonc
npx rulesync generate --base-dir ./packages/backend --config backend.jsonc
npx rulesync generate --base-dir ./packages/shared --config shared.jsonc
```

**Frontend Configuration** (`frontend.jsonc`):
```jsonc
{
  "targets": ["cursor", "claudecode"],
  "aiRulesDir": "./packages/frontend/.rulesync",
  "outputPaths": {
    "cursor": "./packages/frontend/.cursor/rules/",
    "claudecode": "./packages/frontend/CLAUDE.md"
  }
}
```

### Custom Command Libraries

#### Command Organization
```
.rulesync/commands/
├── development/
│   ├── setup.md           # /development:setup
│   ├── test.md            # /development:test
│   └── debug.md           # /development:debug
├── deployment/
│   ├── build.md           # /deployment:build
│   ├── deploy.md          # /deployment:deploy
│   └── rollback.md        # /deployment:rollback
├── maintenance/
│   ├── cleanup.md         # /maintenance:cleanup
│   ├── backup.md          # /maintenance:backup
│   └── migrate.md         # /maintenance:migrate
└── analysis/
    ├── performance.md     # /analysis:performance
    ├── security.md        # /analysis:security
    └── dependencies.md    # /analysis:dependencies
```

#### Reusable Command Patterns
```markdown
# Command Template Structure
---
targets: ["claudecode", "geminicli"]
description: "Brief, clear description of command purpose"
---

# Command Name

Clear explanation of what this command does and when to use it.

## Prerequisites
- Required tools, permissions, or setup
- Environmental conditions needed

## Execution Steps
1. Specific step-by-step instructions
2. Include error handling guidance
3. Provide verification methods

## Expected Outcomes
- What should happen when command succeeds
- How to verify success
- What to do if something goes wrong

## Usage Examples
Provide concrete examples with actual parameters.
```

## Quality Assurance

### Rule Quality Metrics

#### Content Quality Checklist
- [ ] **Clarity**: Rules are easy to understand and follow
- [ ] **Specificity**: Rules provide concrete, actionable guidance
- [ ] **Completeness**: Rules cover all necessary aspects of the topic
- [ ] **Consistency**: Rules align with other rules and team practices
- [ ] **Maintainability**: Rules are easy to update as practices evolve

#### Technical Quality Checklist
- [ ] **Valid Frontmatter**: All YAML syntax is correct
- [ ] **Appropriate Targeting**: Rules target correct tools and file patterns
- [ ] **Performance Impact**: Rule size is appropriate for usage patterns
- [ ] **Security Compliance**: No sensitive information in rule content

### Testing and Validation

#### Automated Testing
```bash
# Validation pipeline
npx rulesync validate
npx rulesync generate --dry-run
npx rulesync status

# Custom validation scripts
./scripts/validate-rules.sh
./scripts/test-ai-integration.sh
```

#### Manual Testing
1. **AI Tool Testing**: Test rules with actual AI tools
2. **Code Generation Quality**: Evaluate AI output quality with new rules
3. **Team Feedback**: Collect feedback from team members using the rules
4. **Performance Impact**: Monitor AI response times and accuracy

## Troubleshooting and Maintenance

### Common Issues Prevention

#### Rule Conflicts
```bash
# Check for conflicting rules
npx rulesync validate --verbose

# Review rule overlap
grep -r "similar patterns" .rulesync/
```

#### Performance Issues
```bash
# Check rule file sizes
find .rulesync -name "*.md" -exec wc -w {} +

# Monitor generation time
time npx rulesync generate
```

#### Tool Integration Issues
```bash
# Test specific tool generation
npx rulesync generate --cursor --verbose
npx rulesync generate --claudecode --verbose
```

### Maintenance Schedule

#### Weekly Tasks
- [ ] Review AI tool performance with current rules
- [ ] Check for new features in supported AI tools
- [ ] Update rules based on recent development patterns

#### Monthly Tasks
- [ ] Comprehensive rule review and cleanup
- [ ] Performance optimization and size management
- [ ] Team feedback collection and incorporation
- [ ] Documentation updates

#### Quarterly Tasks
- [ ] Major rule reorganization if needed
- [ ] Tool integration updates and optimizations
- [ ] Team training and best practices sharing
- [ ] Strategic review of rule effectiveness

## Success Measurement

### Key Performance Indicators

#### Individual Developer Metrics
- **Consistency**: Reduced variation in code style and patterns
- **Productivity**: Faster development with better AI assistance
- **Quality**: Fewer code review comments and bug reports
- **Satisfaction**: Developer satisfaction with AI tool effectiveness

#### Team Metrics
- **Onboarding Time**: Reduced time for new developers to become productive
- **Code Review Efficiency**: Faster review process with fewer style issues
- **Knowledge Sharing**: Better documentation and practice consistency
- **Tool Adoption**: Higher usage rates of AI development tools

#### Project Metrics
- **Code Quality**: Improved static analysis scores and bug rates
- **Development Velocity**: Faster feature delivery and iteration cycles
- **Maintenance Cost**: Reduced time spent on code maintenance and refactoring
- **Technical Debt**: Better long-term code maintainability

By following these best practices, teams can maximize the value of rulesync while maintaining high code quality, effective collaboration, and optimal development workflows.