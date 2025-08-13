# Getting Started with rulesync

## Overview

This comprehensive guide walks you through setting up rulesync from initial installation to advanced usage patterns. Whether you're starting fresh or migrating from existing AI tool configurations, this guide provides step-by-step instructions for success.

## Prerequisites

### System Requirements
- **Node.js**: Version 20.0.0 or higher
- **Package Manager**: npm, pnpm, or yarn
- **Operating System**: Windows, macOS, or Linux
- **Git**: For version control (recommended)

### Development Environment
- **Code Editor**: VS Code, Cursor, or your preferred editor
- **Terminal**: Command line interface access
- **AI Development Tools**: At least one supported AI tool installed

## Installation

### Global Installation (Recommended)
```bash
# Using npm
npm install -g rulesync

# Using pnpm (faster)
pnpm add -g rulesync

# Using yarn
yarn global add rulesync

# Verify installation
rulesync --version
```

### Project-Specific Installation
```bash
# Using npm
npm install --save-dev rulesync

# Using pnpm
pnpm add -D rulesync

# Using yarn
yarn add --dev rulesync

# Run via npx/pnpx
npx rulesync --version
```

## Quick Start (New Project)

### Step 1: Initialize Your Project
```bash
# Navigate to your project directory
cd your-project

# Initialize rulesync
npx rulesync init
```

This creates:
```
.rulesync/
├── overview.md              # Project overview (root rule)
├── coding-standards.md      # Coding rules example
└── commands/                # Custom commands (optional)
    └── example-command.md   # Example command
```

### Step 2: Configure Your Project Rules

#### Edit the Overview File
**`.rulesync/overview.md`**:
```yaml
---
root: true
targets: ["*"]
description: "Project overview and core development principles"
globs: ["**/*"]
---

# Your Project Name

Brief description of your project and its purpose.

## Technology Stack
- Primary language: TypeScript/JavaScript/Python/etc.
- Framework: React/Vue/Angular/Express/etc.
- Database: PostgreSQL/MongoDB/etc.
- Testing: Jest/Vitest/Pytest/etc.

## Development Philosophy
- Clean code principles
- Test-driven development
- Security-first approach
- Performance optimization

## Team Guidelines
- Code reviews required for all changes
- Consistent formatting with Prettier/Black/etc.
- Semantic versioning for releases
- Documentation-driven development
```

#### Add Specific Rules
**`.rulesync/coding-standards.md`**:
```yaml
---
targets: ["*"]
description: "Coding standards and best practices"
globs: ["src/**/*", "lib/**/*"]
---

# Coding Standards

## Code Quality
- Use meaningful variable names
- Write self-documenting code
- Keep functions small and focused
- Handle errors appropriately

## Language-Specific Guidelines
### TypeScript/JavaScript
- Use strict TypeScript configuration
- Prefer const over let, avoid var
- Use async/await over promises
- Implement proper error boundaries

### Python
- Follow PEP 8 style guidelines
- Use type hints for functions
- Write comprehensive docstrings
- Use virtual environments
```

### Step 3: Generate Tool Configurations
```bash
# Generate for all supported tools
npx rulesync generate

# Or generate for specific tools
npx rulesync generate --cursor --claudecode --copilot
```

### Step 4: Verify Generated Files
Check that configurations were created:
```bash
# Check generated files
ls -la .cursor/rules/
ls -la .claude/memories/
ls -la .github/instructions/

# Validate your rules
npx rulesync validate
```

## Migration (Existing AI Tool Configurations)

### Step 1: Audit Existing Configurations
```bash
# Check what AI tool configurations you have
ls -la .cursorrules .cursor/
ls -la CLAUDE.md .claude/
ls -la .github/copilot-instructions.md .github/instructions/
ls -la .cline/instructions.md
ls -la GEMINI.md .gemini/
```

### Step 2: Import Existing Configurations
```bash
# Import from Claude Code
npx rulesync import --claudecode

# Import from Cursor
npx rulesync import --cursor

# Import from GitHub Copilot
npx rulesync import --copilot

# Import from other tools
npx rulesync import --cline
npx rulesync import --geminicli
npx rulesync import --junie
```

### Step 3: Review Imported Content
```bash
# Check imported files
ls -la .rulesync/

# Review and edit content
cat .rulesync/claudecode-overview.md
cat .rulesync/cursor-custom-rules.md
```

### Step 4: Consolidate and Organize
1. **Remove Duplicates**: Identify and merge duplicate rules
2. **Organize Content**: Structure rules logically
3. **Update Metadata**: Ensure frontmatter is correct
4. **Add Missing Rules**: Fill in gaps from your development practices

### Step 5: Generate Unified Configurations
```bash
# Generate for all tools
npx rulesync generate

# Validate everything is working
npx rulesync validate
```

## Configuration Customization

### Configuration File Setup
Create a `rulesync.jsonc` file for persistent settings:

```jsonc
{
  // Target tools to generate configurations for
  "targets": ["cursor", "claudecode", "copilot", "windsurf"],
  
  // Tools to exclude from generation
  "exclude": [],
  
  // Custom output paths (optional)
  "outputPaths": {
    "copilot": ".github/custom-instructions.md"
  },
  
  // Enable verbose output
  "verbose": true,
  
  // Delete existing files before generating
  "delete": false,
  
  // Custom directories
  "aiRulesDir": ".rulesync",
  "aiCommandsDir": ".rulesync/commands"
}
```

### Environment-Specific Configuration
For different environments (dev/staging/prod):

**Development** (`rulesync.dev.jsonc`):
```jsonc
{
  "targets": ["cursor", "claudecode"],
  "verbose": true,
  "delete": true
}
```

**Production** (`rulesync.prod.jsonc`):
```jsonc
{
  "targets": ["*"],
  "verbose": false,
  "delete": false
}
```

Usage:
```bash
# Development
npx rulesync generate --config rulesync.dev.jsonc

# Production
npx rulesync generate --config rulesync.prod.jsonc
```

## Advanced Setup

### Monorepo Configuration
For projects with multiple packages:

```bash
# Generate for different packages
npx rulesync generate --base-dir ./packages/frontend,./packages/backend,./packages/shared

# Or use configuration file
```

**`rulesync.jsonc`**:
```jsonc
{
  "baseDir": ["./packages/frontend", "./packages/backend", "./packages/shared"],
  "targets": ["cursor", "claudecode"]
}
```

### Custom Commands Setup
Create custom slash commands in `.rulesync/commands/`:

**`.rulesync/commands/deploy.md`**:
```yaml
---
targets: ["claudecode", "geminicli"]
description: "Deploy application to staging/production"
---

# Deploy Application

Deploy the application following our deployment checklist:

## Pre-deployment
1. Run all tests: `npm test`
2. Build application: `npm run build`
3. Check bundle size: `npm run analyze`
4. Review recent changes: `git log --oneline -10`

## Deployment Steps
1. Choose environment (staging/production)
2. Update version numbers if needed
3. Run deployment command
4. Verify deployment health
5. Monitor for issues

## Post-deployment
1. Check application status
2. Run smoke tests
3. Monitor error rates
4. Update team on deployment status

Please confirm environment and proceed with deployment checklist.
```

### MCP Server Integration
Configure Model Context Protocol servers in `.rulesync/.mcp.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_your_token_here"
      },
      "targets": ["claudecode", "cursor"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "targets": ["*"]
    }
  }
}
```

## Development Workflow Integration

### Git Integration
Add rulesync files to version control:

```bash
# Track rule files
git add .rulesync/
git add rulesync.jsonc

# Optionally ignore generated files
npx rulesync gitignore
```

**`.gitignore` additions**:
```gitignore
# Generated AI tool configurations
.cursor/rules/
.claude/memories/
.github/instructions/
CLAUDE.md
GEMINI.md
codex.md
```

### Pre-commit Hooks
Add validation to pre-commit hooks:

```bash
#!/bin/sh
# .git/hooks/pre-commit

echo "🔍 Validating rulesync configuration..."
if ! npx rulesync validate; then
    echo "❌ Rule validation failed. Fix errors before committing."
    exit 1
fi

echo "🔄 Regenerating AI tool configurations..."
if ! npx rulesync generate; then
    echo "❌ Configuration generation failed."
    exit 1
fi

# Add any newly generated files
git add .cursor/rules/ .claude/memories/ .github/instructions/

echo "✅ rulesync validation and generation completed."
```

### CI/CD Integration
Add rulesync to your CI pipeline:

```yaml
# .github/workflows/rulesync.yml
name: Validate and Generate Rules

on:
  pull_request:
    paths:
      - '.rulesync/**'
      - 'rulesync.jsonc'

jobs:
  rulesync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install rulesync
        run: npm install -g rulesync
      
      - name: Validate rules
        run: npx rulesync validate
      
      - name: Generate configurations
        run: npx rulesync generate
      
      - name: Check for changes
        run: |
          if ! git diff --exit-code; then
            echo "❌ Generated files are out of sync. Run 'npx rulesync generate' locally."
            exit 1
          fi
```

## Team Adoption Strategy

### Phase 1: Individual Setup
1. **Single Developer**: One team member sets up rulesync
2. **Rule Creation**: Create initial rule set based on team practices
3. **Testing**: Test with their preferred AI tools
4. **Refinement**: Iterate on rules based on practical usage

### Phase 2: Team Onboarding
1. **Share Configuration**: Commit `.rulesync/` directory to repository
2. **Documentation**: Update project README with rulesync usage
3. **Team Training**: Walk team through installation and basic usage
4. **Gradual Adoption**: Team members adopt tool by tool

### Phase 3: Team Optimization
1. **Feedback Collection**: Gather feedback on rule effectiveness
2. **Rule Refinement**: Improve rules based on team experience
3. **Process Integration**: Integrate rulesync into development workflow
4. **Advanced Features**: Add custom commands and MCP servers

### Phase 4: Continuous Improvement
1. **Regular Reviews**: Schedule periodic rule reviews
2. **Tool Updates**: Keep up with new AI tool features
3. **Best Practices**: Develop team-specific best practices
4. **Knowledge Sharing**: Share successful patterns with other teams

## Common Use Cases

### Frontend Development Team
```yaml
---
root: true
targets: ["cursor", "claudecode", "copilot"]
description: "React/TypeScript frontend development standards"
globs: ["src/**/*", "components/**/*"]
---

# Frontend Development Guidelines

## Tech Stack
- React 18 with TypeScript
- Vite for build tooling
- Tailwind CSS for styling
- React Query for state management
- Vitest for testing

## Component Standards
- Use functional components with hooks
- Implement proper TypeScript interfaces
- Follow atomic design principles
- Include accessibility attributes (ARIA)

## State Management
- Use React Query for server state
- Use React Context for app state
- Avoid prop drilling beyond 2 levels
- Implement proper error boundaries
```

### Backend API Team
```yaml
---
root: true
targets: ["*"]
description: "Node.js/Express API development standards"
globs: ["src/**/*", "api/**/*", "routes/**/*"]
---

# Backend API Development Guidelines

## Tech Stack
- Node.js 20+ with TypeScript
- Express.js framework
- PostgreSQL with Prisma ORM
- Jest for testing
- Docker for containerization

## API Design
- RESTful endpoint conventions
- Consistent error response format
- Proper HTTP status codes
- Comprehensive input validation

## Security
- Implement rate limiting
- Use helmet for security headers
- Validate all inputs with Joi/Zod
- Implement proper authentication/authorization
```

### Full-Stack Team
```yaml
---
root: true
targets: ["*"]
description: "Full-stack development standards"
globs: ["**/*"]
---

# Full-Stack Development Guidelines

## Monorepo Structure
- `/frontend` - React TypeScript application
- `/backend` - Node.js Express API
- `/shared` - Common types and utilities
- `/docs` - Project documentation

## Development Standards
- Clean architecture principles
- Comprehensive testing strategy
- Security-first implementation
- Performance optimization focus
```

## Troubleshooting Common Issues

### Installation Problems
```bash
# Permission issues
sudo npm install -g rulesync

# Node.js version issues
node --version  # Should be 20+
nvm install 20  # If using nvm
```

### Generation Issues
```bash
# Clear and regenerate
npx rulesync generate --delete

# Validate first
npx rulesync validate

# Check specific tool generation
npx rulesync generate --cursor --verbose
```

### Import Problems
```bash
# Check source files exist
ls -la .cursorrules .cursor/rules/

# Import with verbose output
npx rulesync import --cursor --verbose

# Validate after import
npx rulesync validate
```

## Next Steps

### Learning Resources
1. **[Configuration Guide](../configuration.md)**: Detailed frontmatter options
2. **[Tool Integrations](../tools/)**: Tool-specific features and configurations
3. **[Best Practices](./best-practices.md)**: Advanced usage patterns
4. **[Custom Commands](../features/custom-commands.md)**: Creating powerful automation

### Community and Support
1. **GitHub Issues**: Report bugs and feature requests
2. **Discussions**: Share patterns and ask questions
3. **Contributing**: Help improve rulesync
4. **Examples**: Real-world usage examples

### Advanced Topics
1. **MCP Integration**: Connect external services and APIs
2. **Custom Tool Development**: Extend rulesync for new tools
3. **Enterprise Deployment**: Large-scale team adoption strategies
4. **Performance Optimization**: Optimize for large projects

## Success Metrics

### Individual Success
- ✅ Consistent AI assistance across all your development tools
- ✅ Reduced time explaining context to AI assistants
- ✅ Improved code quality and consistency
- ✅ Streamlined development workflow

### Team Success
- ✅ Unified development standards across team members
- ✅ Faster onboarding for new team members
- ✅ Improved code review quality and speed
- ✅ Consistent AI assistance regardless of tool choice

### Organizational Success
- ✅ Standardized AI development practices across teams
- ✅ Reduced context switching and tool lock-in
- ✅ Improved development velocity and quality
- ✅ Future-proof AI tool adoption strategy

Congratulations! You're now ready to leverage rulesync for consistent, effective AI-assisted development across your entire toolchain.