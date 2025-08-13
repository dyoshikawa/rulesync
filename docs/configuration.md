# Configuration Guide

## Overview

This comprehensive guide covers all aspects of rulesync configuration, from basic rule file structure to advanced configuration options. Learn how to create effective rules, manage team configurations, and optimize performance.

## Rule File Structure

### File Format

Rule files are Markdown documents with optional YAML frontmatter located in the `.rulesync/` directory:

```markdown
---
root: false                           # Rule level (true for project overview)
targets: ["*"]                        # Target AI tools
description: "Rule description"        # Brief description
globs: ["**/*"]                       # File patterns
cursorRuleType: "always"              # Cursor-specific rule type
windsurfActivationMode: "always"      # Windsurf-specific activation
tags: ["security", "typescript"]      # Rule categorization
---

# Rule Title

Your Markdown content describing the rule goes here.

## Examples
```javascript
// Code examples
```

## Requirements
- Specific requirements
- Implementation guidelines
```

### Frontmatter Schema (v0.56.0+)

All frontmatter fields are **optional** with sensible defaults:

#### Core Fields
```yaml
root: false                    # Default: false (only one root rule allowed)
targets: ["*"]                 # Default: ["*"] (all tools)
description: "Auto-generated"  # Default: generated from filename
globs: ["**/*"]               # Default: ["**/*"] (all files)
```

#### Tool-Specific Fields
```yaml
# Cursor-specific rule behavior
cursorRuleType: "always"       # Options: always, manual, specificFiles, intelligently

# Windsurf-specific activation
windsurfActivationMode: "always"     # Options: always, manual, model-decision, glob
windsurfOutputFormat: "directory"    # Options: single-file, directory

# AugmentCode-specific type
augmentCodeType: "always"      # Options: always, auto, manual
```

#### Optional Fields
```yaml
tags: ["tag1", "tag2"]         # Rule categorization for complex projects
priority: 1                    # Rule priority (future feature)
```

## Rule Hierarchy

### Root Rules (`root: true`)
Project overview and high-level guidelines. **Only one root rule allowed per project.**

```yaml
---
root: true
targets: ["*"]
description: "Project overview and core development principles"
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

### Detail Rules (`root: false`)
Specific implementation guidelines and detailed standards. Multiple detail rules allowed.

```yaml
---
root: false
targets: ["cursor", "claudecode"]
description: "TypeScript development standards"
globs: ["**/*.ts", "**/*.tsx"]
---

# TypeScript Standards

## Type Safety
- Use strict TypeScript configuration
- Avoid `any` type - use `unknown` if necessary
- Define explicit return types for functions
- Use type guards for runtime type checking

## Code Organization
- Use interfaces for object shapes
- Prefer union types over enums for simple cases
- Implement barrel exports for clean module imports
- Follow consistent naming conventions
```

## Target Configuration

### Valid Tool Names
```yaml
targets: [
  "claudecode",     # Claude Code
  "cursor",         # Cursor
  "copilot",        # GitHub Copilot
  "cline",          # Cline (formerly Claude Dev)
  "codexcli",       # OpenAI Codex CLI
  "augmentcode",    # AugmentCode
  "roo",           # Roo Code
  "geminicli",     # Gemini CLI
  "junie",         # JetBrains Junie
  "kiro",          # Kiro IDE
  "windsurf",      # Windsurf AI Code Editor
  "*"              # All tools (wildcard)
]
```

### Target Strategies
```yaml
# Universal rules - apply to all tools
targets: ["*"]

# Specific tools only
targets: ["cursor", "claudecode"]

# Exclude specific tools (use multiple rules)
# Rule 1: Most tools
targets: ["cursor", "claudecode", "copilot", "windsurf"]
# Rule 2: Different rule for other tools  
targets: ["cline", "roo"]
```

## Glob Patterns

### Pattern Syntax
Uses standard glob pattern syntax similar to `.gitignore`:

```yaml
globs: [
  "**/*.ts",           # All TypeScript files anywhere
  "src/**/*.tsx",      # React files in src directory
  "!**/*.test.*",      # Exclude test files
  "!node_modules/**",  # Exclude node_modules
  "components/**/*",   # All files in components directory
  "**/api/**",         # All files in any api directory
]
```

### Common Patterns
```yaml
# Language-specific patterns
globs: ["**/*.ts", "**/*.tsx"]          # TypeScript
globs: ["**/*.js", "**/*.jsx"]          # JavaScript
globs: ["**/*.py"]                      # Python
globs: ["**/*.go"]                      # Go
globs: ["**/*.rs"]                      # Rust
globs: ["**/*.java"]                    # Java

# Directory-specific patterns
globs: ["src/**/*"]                     # Source directory
globs: ["components/**/*"]              # Components only
globs: ["!test/**", "!**/*.test.*"]     # Exclude tests
globs: ["!node_modules/**"]             # Exclude dependencies

# File type patterns
globs: ["**/*.md"]                      # Documentation
globs: ["**/*.json", "**/*.yaml"]       # Configuration files
globs: ["**/*.css", "**/*.scss"]        # Stylesheets
```

## Tool-Specific Configuration

### Cursor Rule Types

Cursor supports four distinct rule application modes:

```yaml
# Always-applied rules (persistent context)
---
targets: ["cursor"]
cursorRuleType: "always"
description: "Project-wide standards applied constantly"
globs: ["**/*"]
---

# File-specific rules (automatic application)
---
targets: ["cursor"] 
cursorRuleType: "specificFiles"
globs: ["**/*.tsx", "**/*.jsx"]
description: "React component development rules"
---

# Intelligent rules (AI-determined relevance)
---
targets: ["cursor"]
cursorRuleType: "intelligently"
description: "Database operation guidelines"
# Note: Empty globs for intelligent rules
---

# Manual rules (explicit invocation only)
---
targets: ["cursor"]
cursorRuleType: "manual"
description: "Deployment procedures and checklists"
# Note: Empty globs and description for manual rules
---
```

### Windsurf Activation Modes

Windsurf provides flexible rule activation patterns:

```yaml
# Always-on rules
---
targets: ["windsurf"]
windsurfActivationMode: "always"
windsurfOutputFormat: "directory"
description: "Core project guidelines"
---

# File pattern-based activation
---
targets: ["windsurf"]
windsurfActivationMode: "glob"
globs: ["**/*.tsx", "**/*.jsx"]
tags: ["ui", "react"]
---

# AI-determined activation
---
targets: ["windsurf"]
windsurfActivationMode: "model-decision"
description: "Security guidelines for sensitive operations"
---

# Manual activation only
---
targets: ["windsurf"]
windsurfActivationMode: "manual"
description: "Complex deployment procedures"
---
```

### AugmentCode Types

AugmentCode supports three rule types:

```yaml
# Always-applied rules
---
targets: ["augmentcode"]
augmentCodeType: "always"
description: "Project-wide development standards"
---

# Auto-applied rules (AI determines relevance)
---
targets: ["augmentcode"]
augmentCodeType: "auto"
description: "TypeScript-specific coding guidelines and best practices"
---

# Manual-only rules
---
targets: ["augmentcode"]
augmentCodeType: "manual"
description: "Deployment and infrastructure management"
---
```

## Configuration Files

### Configuration File Types

rulesync supports multiple configuration file formats:

1. `rulesync.jsonc` (recommended - supports comments)
2. `rulesync.ts` (TypeScript with type checking)
3. `rulesync.config.ts`
4. `rulesync.config.jsonc`
5. `package.json` (in `rulesync` field)

### JSONC Configuration

**`rulesync.jsonc`**:
```jsonc
{
  // Target tools to generate configurations for
  "targets": ["cursor", "claudecode", "copilot", "windsurf"],
  
  // Tools to exclude from generation (overrides targets)
  "exclude": ["roo"],
  
  // Custom output paths for specific tools
  "outputPaths": {
    "copilot": ".github/custom-instructions.md",
    "cursor": ".cursor/custom-rules/"
  },
  
  // Base directory or directories for generation
  "baseDir": "./packages",
  
  // Delete existing files before generating
  "delete": false,
  
  // Enable verbose output
  "verbose": true,
  
  // Directory containing rule files
  "aiRulesDir": ".rulesync",
  
  // Directory containing command files (optional)
  "aiCommandsDir": ".rulesync/commands",
  
  // Watch configuration
  "watch": {
    "enabled": false,
    "interval": 1000,
    "ignore": ["node_modules/**", ".git/**", "dist/**", "build/**"]
  }
}
```

### TypeScript Configuration

**`rulesync.ts`**:
```typescript
import type { ConfigOptions } from "rulesync";

const config: ConfigOptions = {
  targets: ["cursor", "claudecode", "windsurf"],
  exclude: ["roo"],
  outputPaths: {
    copilot: ".github/copilot-instructions.md"
  },
  baseDir: ["./packages/frontend", "./packages/backend"],
  delete: false,
  verbose: process.env.NODE_ENV === "development",
  aiRulesDir: ".rulesync",
  aiCommandsDir: ".rulesync/commands"
};

export default config;
```

### Package.json Configuration

**`package.json`**:
```json
{
  "name": "my-project",
  "scripts": {
    "rules:generate": "rulesync generate",
    "rules:validate": "rulesync validate"
  },
  "rulesync": {
    "targets": ["cursor", "claudecode"],
    "delete": true,
    "verbose": false
  }
}
```

## Configuration Options

### Core Options

#### `targets`
Array of tools to generate configurations for.
```jsonc
"targets": ["cursor", "claudecode", "windsurf"]  // Specific tools
"targets": ["*"]                                 // All tools (default)
```

#### `exclude`
Array of tools to exclude from generation (overrides `targets`).
```jsonc
"exclude": ["roo", "augmentcode"]
```

#### `baseDir`
Base directory or directories for generation. Useful for monorepos.
```jsonc
"baseDir": "./packages"                                    // Single directory
"baseDir": ["./packages/frontend", "./packages/backend"]   // Multiple directories
```

#### `delete`
Delete existing generated files before creating new ones.
```jsonc
"delete": false  // Default: preserve existing files
"delete": true   // Clean generation
```

#### `verbose`
Enable verbose output during operations.
```jsonc
"verbose": false  // Default: minimal output
"verbose": true   // Detailed logging
```

### Directory Options

#### `aiRulesDir`
Directory containing rule files.
```jsonc
"aiRulesDir": ".rulesync"      // Default
"aiRulesDir": ".ai-rules"      // Custom directory
"aiRulesDir": "config/rules"   // Nested directory
```

#### `aiCommandsDir`
Directory containing custom command files.
```jsonc
"aiCommandsDir": ".rulesync/commands"  // Default
"aiCommandsDir": ".commands"           // Custom directory
```

#### `outputPaths`
Custom output paths for specific tools.
```jsonc
"outputPaths": {
  "copilot": ".github/custom-instructions.md",
  "cursor": ".cursor/custom-rules/",
  "claudecode": "CLAUDE_CUSTOM.md"
}
```

### Watch Options

#### `watch`
File watching configuration for automatic regeneration.
```jsonc
"watch": {
  "enabled": true,                    // Enable file watching
  "interval": 1000,                   // Watch interval in milliseconds
  "ignore": [                         // Patterns to ignore
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    "**/*.tmp"
  ]
}
```

## Environment-Specific Configuration

### Development Configuration
**`rulesync.dev.jsonc`**:
```jsonc
{
  "targets": ["cursor", "claudecode"],
  "delete": true,
  "verbose": true,
  "watch": {
    "enabled": true,
    "interval": 500
  }
}
```

### Production Configuration
**`rulesync.prod.jsonc`**:
```jsonc
{
  "targets": ["*"],
  "exclude": [],
  "delete": false,
  "verbose": false
}
```

### Usage
```bash
# Development
npx rulesync generate --config rulesync.dev.jsonc

# Production
npx rulesync generate --config rulesync.prod.jsonc
```

## Command Configuration

### Custom Commands

Commands are defined in `.rulesync/commands/` with simplified frontmatter:

```yaml
---
targets: ["claudecode", "geminicli"]  # Target tools (optional)
description: "Command description"     # Brief description (optional)
---

# Command Content

Your command instructions here.

Use $ARGUMENTS (Claude Code) or {{args}} (Gemini CLI) for argument injection.
```

### Command Organization

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
└── analysis/
    ├── performance.md     # /analysis:performance
    ├── security.md        # /analysis:security
    └── dependencies.md    # /analysis:dependencies
```

## MCP Configuration

### MCP Server Configuration

Define MCP servers in `.rulesync/.mcp.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxx"
      },
      "targets": ["*"]
    },
    "filesystem": {
      "command": "npx", 
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "targets": ["claudecode", "cursor"]
    },
    "database": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "PGHOST=localhost",
        "-e", "PGUSER=developer", 
        "-e", "PGPASSWORD=secret",
        "ghcr.io/modelcontextprotocol/postgres-mcp:latest"
      ],
      "targets": ["claudecode"]
    }
  }
}
```

### MCP Configuration Fields

#### Required Fields
- **`command`**: Executable command for STDIO transport
- **`url`**: URL for HTTP/SSE transport (alternative to command)

#### Optional Fields
- **`args`**: Command arguments array
- **`env`**: Environment variables object
- **`targets`**: Target tools array (default: all tools)
- **`headers`**: HTTP headers for remote servers
- **Tool-specific fields**: e.g., `kiroAutoApprove`, `kiroAutoBlock` for Kiro IDE

## Ignore File Configuration

### .rulesyncignore

Exclude rule files from processing using gitignore-style patterns:

```gitignore
# Ignore draft and temporary files
**/draft-*.md
**/*-draft.md
**/*.tmp
**/*.temp

# Ignore test rule files
**/*.test.md
**/test-rules/

# Ignore user-specific files
**/*-personal.md
**/local-*.md

# Ignore archived rules
archive/
deprecated/
```

### Generated Ignore Files

When `.rulesyncignore` exists, tool-specific ignore files are generated:

| Tool | Ignore File | Purpose |
|------|-------------|---------|
| Cursor | `.cursorignore` | Exclude files from Cursor context |
| Cline | `.clineignore` | Exclude files from Cline access |
| Roo Code | `.rooignore` | Exclude files from Roo Code |
| GitHub Copilot | `.copilotignore` | Exclude files from Copilot (community) |
| Gemini CLI | `.aiexclude` | Exclude files from Gemini CLI |
| Kiro IDE | `.aiignore` | Exclude files from AI access |
| Windsurf | `.codeiumignore` | Exclude files from Cascade AI |
| Claude Code | `.claude/settings.json` | Permission deny rules |

## Performance Optimization

### Rule File Size Management

```yaml
# Good: Focused, specific rules (500-800 words)
---
targets: ["cursor"]
description: "TypeScript React component patterns"
globs: ["src/components/**/*.tsx"]
---

# Avoid: Overly broad, verbose rules (>2000 words)
---
targets: ["*"]
description: "Everything about everything"
globs: ["**/*"]
---
```

### Strategic Tool Targeting

```yaml
# Performance-sensitive tools get lighter rules
---
targets: ["cursor"]
description: "Essential coding standards"
globs: ["**/*.ts"]
---

# Comprehensive tools get detailed rules  
---
targets: ["claudecode"]
description: "Comprehensive development guidelines with examples"
globs: ["**/*"]
---
```

### Generation Optimization

```jsonc
{
  // Generate only for tools you use
  "targets": ["cursor", "claudecode"],
  
  // Use clean generation to avoid file accumulation
  "delete": true,
  
  // Target specific directories in monorepos
  "baseDir": ["./src", "./components"]
}
```

## Validation and Quality Control

### Validation Rules

Automatic validation checks:
- ✅ YAML frontmatter syntax
- ✅ Single root rule requirement
- ✅ Valid tool names in targets
- ✅ Valid glob pattern syntax
- ✅ File accessibility and permissions
- ✅ Content structure and quality

### Custom Validation

```bash
# Basic validation
npx rulesync validate

# Detailed validation with context
npx rulesync validate --verbose

# Validate specific directory
npx rulesync validate --base-dir ./packages/frontend
```

## Best Practices

### Rule Organization
1. **Single Responsibility**: Each rule file covers one specific topic
2. **Clear Hierarchy**: Use root/detail rule structure effectively
3. **Descriptive Names**: Use clear, descriptive filenames
4. **Consistent Format**: Maintain similar structure across files

### Configuration Management
1. **Version Control**: Commit configuration files to repository
2. **Environment Specific**: Use different configs for dev/staging/prod
3. **Team Consistency**: Ensure all team members use same configuration
4. **Regular Review**: Update configuration as project evolves

### Performance Considerations
1. **Size Management**: Keep rule files focused and concise
2. **Tool Targeting**: Target only tools your team uses
3. **Pattern Specificity**: Use specific glob patterns when possible
4. **Generation Strategy**: Use clean generation in CI/CD

This comprehensive configuration guide provides everything needed to effectively set up and manage rulesync for projects of any size and complexity.