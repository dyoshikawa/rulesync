# Commands Reference

## Overview

This comprehensive reference covers all rulesync CLI commands, options, and usage patterns. Commands are organized by functionality with detailed examples and common usage scenarios.

## Installation Commands

### Global Installation
```bash
# Install rulesync globally (recommended)
npm install -g rulesync
pnpm add -g rulesync
yarn global add rulesync

# Verify installation
rulesync --version
```

### Project-Specific Installation
```bash
# Install as development dependency
npm install --save-dev rulesync
pnpm add -D rulesync
yarn add --dev rulesync

# Use via npx
npx rulesync --version
```

## Core Commands

### `init` - Initialize Project

Initialize a new rulesync project with sample rule files.

```bash
npx rulesync init [options]
```

**Options:**
- `--legacy`: Use legacy directory structure (`.rulesync/*.md`)
- `--verbose`, `-v`: Show detailed output during initialization

**Examples:**
```bash
# Basic initialization (recommended: .rulesync/rules/)
npx rulesync init

# Initialize with legacy structure (.rulesync/*.md)
npx rulesync init --legacy

# Initialize with verbose output
npx rulesync init --verbose
```

**Generated Structure (Default):**
```
.rulesync/
├── rules/                   # Rule files (recommended)
│   ├── overview.md         # Project overview (root rule)
│   └── coding-standards.md # Example coding standards
└── commands/               # Custom commands directory
    └── example-command.md  # Example command
```

**Generated Structure (Legacy):**
```
.rulesync/
├── overview.md              # Project overview (root rule)
├── coding-standards.md      # Example coding standards
└── commands/                # Custom commands directory
    └── example-command.md   # Example command
```

### `generate` - Generate Configurations

Generate AI tool configuration files from rulesync rules.

```bash
npx rulesync generate [options]
```

**Options:**
- `-t, --targets <tools>`: Comma-separated list of tools to generate for (recommended)
- `--all`: Generate for all supported AI tools
- `--delete`: Remove existing generated files before creating new ones
- `--verbose`, `-v`: Show detailed generation process
- `--config <path>`: Use specific configuration file
- `--no-config`: Disable configuration file loading
- `--base-dir <paths>`: Generate in specific directories (comma-separated)

**Target Specification:**
Use the `--targets` flag to specify which tools to generate for:
- **Single tool**: `--targets copilot`
- **Multiple tools**: `--targets copilot,cursor,cline`
- **All tools**: `--targets all` (same as `--all`)

**Available Tools:**
`agentsmd`, `amazonqcli`, `augmentcode`, `augmentcode-legacy`, `copilot`, `cursor`, `cline`, `claudecode`, `codexcli`, `opencode`, `qwencode`, `roo`, `geminicli`, `kiro`, `junie`, `windsurf`

**⚠️ Deprecated Tool-Specific Flags:**
The following individual flags are deprecated and will be removed in a future version. Use `--targets` instead:
- `--agentsmd` → `--targets agentsmd`
- `--amazonqcli` → `--targets amazonqcli`
- `--augmentcode` → `--targets augmentcode`
- `--augmentcode-legacy` → `--targets augmentcode-legacy`
- `--claudecode` → `--targets claudecode`
- `--cline` → `--targets cline`
- `--codexcli` → `--targets codexcli`
- `--copilot` → `--targets copilot`
- `--cursor` → `--targets cursor`
- `--geminicli` → `--targets geminicli`
- `--junie` → `--targets junie`
- `--kiro` → `--targets kiro`
- `--opencode` → `--targets opencode`
- `--qwencode` → `--targets qwencode`
- `--roo` → `--targets roo`
- `--windsurf` → `--targets windsurf`

**Examples:**
```bash
# Generate for all tools
npx rulesync generate --all
# or
npx rulesync generate --targets all

# Generate for specific tools (recommended new syntax)
npx rulesync generate --targets copilot,cursor,cline
npx rulesync generate --targets claudecode
npx rulesync generate -t copilot,cursor

# Clean generation (delete existing files first)
npx rulesync generate --targets copilot,cursor --delete --verbose

# Generate for monorepo packages
npx rulesync generate --targets all --base-dir ./packages/frontend,./packages/backend

# Legacy syntax (deprecated but still works)
npx rulesync generate --cursor --claudecode  # Shows deprecation warning
```

**Migration Examples:**
```bash
# Old syntax (deprecated)
npx rulesync generate --copilot --cursor --cline

# New syntax (recommended)
npx rulesync generate --targets copilot,cursor,cline

# Old syntax (deprecated)
npx rulesync generate --claudecode --verbose

# New syntax (recommended)
npx rulesync generate --targets claudecode --verbose
```

**Generated Output:**
| Tool | Generated Files |
|------|----------------|
| Claude Code | `CLAUDE.md`, `.claude/memories/*.md`, `.claude/commands/*.md` |
| Cursor | `.cursor/rules/*.mdc`, `.cursorignore` |
| GitHub Copilot | `.github/instructions/*.instructions.md`, `.copilotignore` |
| Cline | `.cline/instructions.md`, `.clinerules/*.md`, `.clineignore` |
| OpenAI Codex CLI | `codex.md`, `*.md`, `.codex/mcp-config.json`, `.codexignore` |
| AugmentCode | `.augment/rules/*.md`, `.augmentignore` |
| Roo Code | `.roo/instructions.md`, `.roo/rules/*.md`, `.rooignore` |
| Gemini CLI | `GEMINI.md`, `.gemini/memories/*.md`, `.gemini/commands/*.md` |
| Qwen Code | `QWEN.md`, `.qwen/memories/*.md`, `.qwen/settings.json` |
| JetBrains Junie | `.junie/guidelines.md`, `.aiignore` |
| Kiro IDE | `.kiro/steering/*.md`, `.aiignore` |
| Windsurf | `.windsurf/rules/*.md`, `.codeiumignore` |
| AgentsMd | `AGENTS.md`, `.agents/memories/*.md` |

### `validate` - Validate Rules

Validate rule file syntax, structure, and configuration.

```bash
npx rulesync validate [options]
```

**Options:**
- `--verbose`, `-v`: Show detailed validation information
- `--config <path>`: Use specific configuration file
- `--base-dir <path>`: Validate rules in specific directory

**Examples:**
```bash
# Validate all rule files
npx rulesync validate

# Validate with detailed output
npx rulesync validate --verbose

# Validate specific directory
npx rulesync validate --base-dir ./packages/frontend
```

**Validation Checks:**
- ✅ YAML frontmatter syntax
- ✅ Required fields (in pre-v0.56.0)
- ✅ Single root rule requirement
- ✅ Valid tool names in targets
- ✅ Valid glob patterns
- ✅ File accessibility and permissions

**Example Output:**
```bash
✅ Validation completed successfully

Summary:
- 5 rule files validated
- 1 root rule found
- 4 detail rules found
- 0 errors found
```

### `import` - Import Existing Configurations

Import existing AI tool configurations into rulesync format.

```bash
npx rulesync import [options]
```

**Tool-Specific Import Flags:**
- `--claudecode`: Import from Claude Code (`CLAUDE.md`, `.claude/memories/`, `.claude/commands/`)
- `--cursor`: Import from Cursor (`.cursorrules`, `.cursor/rules/`, `.cursor/mcp.json`)
- `--copilot`: Import from GitHub Copilot (`.github/copilot-instructions.md`, `.github/instructions/`)
- `--cline`: Import from Cline (`.cline/instructions.md`, `.clinerules/`)
- `--augmentcode`: Import from AugmentCode (`.augment/rules/`)
- `--augmentcode-legacy`: Import from legacy AugmentCode (`.augment-guidelines`)
- `--roo`: Import from Roo Code (`.roo/instructions.md`, `.roo/rules/`)
- `--geminicli`: Import from Gemini CLI (`GEMINI.md`, `.gemini/memories/`, `.gemini/commands/`)
- `--qwencode`: Import from Qwen Code (`QWEN.md`, `.qwen/memories/`)
- `--junie`: Import from JetBrains Junie (`.junie/guidelines.md`)
- `--windsurf`: Import from Windsurf (`.windsurf/rules/`, `.windsurf-rules`)
- `--agentsmd`: Import from AgentsMd (`AGENTS.md`, `.agents/memories/*.md`)

**General Options:**
- `--legacy`: Import to legacy directory structure (`.rulesync/*.md`)
- `--verbose`, `-v`: Show detailed import process
- `--config <path>`: Use specific configuration file
- `--base-dir <path>`: Import from specific directory

**Examples:**
```bash
# Import from Claude Code (to .rulesync/rules/)
npx rulesync import --claudecode

# Import to legacy location (.rulesync/*.md)
npx rulesync import --claudecode --legacy

# Import from multiple tools (run separately)
npx rulesync import --cursor
npx rulesync import --copilot
npx rulesync import --cline

# Import with verbose output
npx rulesync import --claudecode --verbose

# Import legacy AugmentCode format
npx rulesync import --augmentcode-legacy
```

**Import Features (v0.58.0+):**
- ✅ Overwrite protection for existing `.rulesync/` files
- ✅ Tool-specific prefixes to avoid filename conflicts
- ✅ Custom command import for supported tools
- ✅ MCP configuration import
- ✅ Ignore pattern import and conversion

## Utility Commands

### `add` - Add New Rule File

Create a new rule file with basic template.

```bash
npx rulesync add <filename> [options]
```

**Options:**
- `--legacy`: Create in legacy directory structure (`.rulesync/*.md`)
- `--verbose`, `-v`: Show detailed output

**Examples:**
```bash
# Add new rule file (to .rulesync/rules/)
npx rulesync add typescript-rules

# Add to legacy location (.rulesync/*.md)
npx rulesync add typescript-rules --legacy

# Add with .md extension (handled automatically)
npx rulesync add security-guidelines.md

# Add with verbose output
npx rulesync add api-standards --verbose
```

**Generated Template:**
```yaml
---
root: false
targets: ["*"]
description: "Generated rule description"
globs: ["**/*"]
---

# Rule Title

Add your rule content here.
```

### `status` - Show Project Status

Display current project status and configuration summary.

```bash
npx rulesync status [options]
```

**Options:**
- `--verbose`, `-v`: Show detailed status information
- `--config <path>`: Use specific configuration file

**Examples:**
```bash
# Show basic status
npx rulesync status

# Show detailed status
npx rulesync status --verbose
```

**Example Output:**
```bash
rulesync Status

Configuration:
- Rules Directory: .rulesync/
- Commands Directory: .rulesync/commands/
- Config File: rulesync.jsonc

Rules:
- Total Rule Files: 5
- Root Rules: 1
- Detail Rules: 4
- Custom Commands: 3

Target Tools:
- claudecode ✅
- cursor ✅
- copilot ✅
- windsurf ✅

Generated Files:
- CLAUDE.md (1.2kb)
- .cursor/rules/ (3 files)
- .github/instructions/ (4 files)
- .windsurf/rules/ (5 files)
```

### `watch` - Watch for Changes

Monitor rule files for changes and automatically regenerate configurations.

```bash
npx rulesync watch [options]
```

**Options:**
- `--verbose`, `-v`: Show detailed watch information
- `--config <path>`: Use specific configuration file
- `--interval <ms>`: Set watch interval in milliseconds (default: 1000)

**Examples:**
```bash
# Start watching for changes
npx rulesync watch

# Watch with verbose output
npx rulesync watch --verbose

# Watch with custom interval
npx rulesync watch --interval 500
```

**Watch Behavior:**
- Monitors `.rulesync/` directory for file changes
- Automatically runs validation on changes
- Regenerates configurations if validation passes
- Ignores temporary files and hidden files
- Debounces rapid changes to avoid excessive generation

### `gitignore` - Add Generated Files to .gitignore

Add generated AI tool configuration files to `.gitignore`.

```bash
npx rulesync gitignore [options]
```

**Options:**
- `--verbose`, `-v`: Show detailed output

**Examples:**
```bash
# Add generated files to .gitignore
npx rulesync gitignore

# Add with verbose output
npx rulesync gitignore --verbose
```

**Added Patterns:**
```gitignore
# Generated AI tool configurations (rulesync)
.cursor/rules/
.claude/memories/
.github/instructions/
CLAUDE.md
GEMINI.md
codex.md
.cline/instructions.md
.clinerules/
.augment/rules/
.roo/instructions.md
.roo/rules/
.junie/guidelines.md
.kiro/steering/
.windsurf/rules/
.windsurf-rules
AGENTS.md
.agents/memories/

# Generated ignore files
.cursorignore
.clineignore
.rooignore
.copilotignore
.aiexclude
.aiignore
.codeiumignore
.codexignore

# Generated MCP configurations
.mcp.json
.cursor/mcp.json
.cline/mcp.json
.codex/mcp-config.json
.gemini/settings.json
.junie/mcp.json
.kiro/mcp.json
.roo/mcp.json
.windsurf/mcp.json
```

## Configuration Commands

### `config` - Manage Configuration

Display, create, or manage rulesync configuration files.

```bash
npx rulesync config [options]
```

**Options:**
- `--init`: Create new configuration file
- `--format <format>`: Specify format for new config (jsonc, ts)
- `--verbose`, `-v`: Show detailed configuration information

**Examples:**
```bash
# Show current configuration
npx rulesync config

# Initialize new JSONC configuration
npx rulesync config --init

# Initialize TypeScript configuration
npx rulesync config --init --format ts

# Show detailed configuration info
npx rulesync config --verbose
```

**Configuration File Precedence:**
1. `--config <path>` command line option
2. `rulesync.jsonc` 
3. `rulesync.ts`
4. `rulesync.config.ts`
5. `rulesync.config.jsonc`
6. `package.json` (`"rulesync"` field)

## Global Options

These options are available for most commands:

### `--help`, `-h`
Show help information for the command.

```bash
npx rulesync --help
npx rulesync generate --help
npx rulesync import --help
```

### `--version`, `-V`
Show rulesync version information.

```bash
npx rulesync --version
```

### `--verbose`, `-v`
Enable verbose output with detailed information.

```bash
npx rulesync generate --verbose
npx rulesync validate --verbose
```

### `--config <path>`
Use specific configuration file instead of auto-detection.

```bash
npx rulesync generate --config custom-config.jsonc
npx rulesync validate --config dev-config.ts
```

### `--no-config`
Disable configuration file loading, use default settings only.

```bash
npx rulesync generate --no-config
npx rulesync validate --no-config
```

## Exit Codes

rulesync uses standard exit codes to indicate command results:

- **0**: Success - Command completed without errors
- **1**: Validation/Generation Error - Rule validation failed or generation encountered errors
- **2**: Configuration Error - Invalid configuration or missing files
- **3**: Network Error - Failed to download dependencies or access remote resources
- **4**: Permission Error - Insufficient permissions to read/write files
- **5**: Unknown Error - Unexpected error occurred

**Examples:**
```bash
# Check exit code in scripts
npx rulesync validate
if [ $? -eq 0 ]; then
  echo "Validation passed"
  npx rulesync generate
else
  echo "Validation failed"
  exit 1
fi
```

## Command Chaining and Workflows

### Basic Workflow
```bash
# 1. Initialize project
npx rulesync init

# 2. Edit rule files
# (Edit .rulesync/*.md files)

# 3. Validate rules
npx rulesync validate

# 4. Generate configurations
npx rulesync generate

# 5. Optional: Add to .gitignore
npx rulesync gitignore
```

### Development Workflow
```bash
# Development with file watching
npx rulesync watch &
WATCH_PID=$!

# Make changes to rule files
# Configurations automatically regenerate

# Stop watching when done
kill $WATCH_PID
```

### CI/CD Integration
```bash
#!/bin/bash
# CI validation script

echo "Validating rulesync configuration..."
npx rulesync validate --verbose

if [ $? -ne 0 ]; then
  echo "❌ Rule validation failed"
  exit 1
fi

echo "Generating configurations..."
npx rulesync generate --verbose

echo "Checking for uncommitted changes..."
if ! git diff --exit-code; then
  echo "❌ Generated files are out of sync"
  echo "Run 'npx rulesync generate' locally and commit changes"
  exit 1
fi

echo "✅ rulesync validation passed"
```

### Migration Workflow
```bash
#!/bin/bash
# Migration from existing AI tool configs

echo "Starting migration to rulesync..."

# Import from existing tools
npx rulesync import --claudecode --verbose
npx rulesync import --cursor --verbose
npx rulesync import --copilot --verbose
npx rulesync import --agentsmd --verbose

# Validate imported rules
npx rulesync validate --verbose

# Generate unified configurations
npx rulesync generate --delete --verbose

echo "✅ Migration complete"
echo "Review imported files in .rulesync/ directory"
```

## Command Aliases and Scripts

### Package.json Scripts
Add common rulesync commands to your `package.json`:

```json
{
  "scripts": {
    "rules:init": "rulesync init",
    "rules:validate": "rulesync validate",
    "rules:generate": "rulesync generate",
    "rules:clean": "rulesync generate --delete",
    "rules:watch": "rulesync watch",
    "rules:status": "rulesync status",
    "rules:import": "rulesync import",
    "rules:add": "rulesync add",
    "rules:gitignore": "rulesync gitignore"
  }
}
```

### Shell Aliases
Add convenient aliases to your shell configuration:

```bash
# Add to ~/.bashrc or ~/.zshrc
alias rs='npx rulesync'
alias rsgen='npx rulesync generate'
alias rsval='npx rulesync validate'
alias rswatch='npx rulesync watch'
alias rsstatus='npx rulesync status'
```

### Git Hooks Integration
```bash
#!/bin/sh
# .git/hooks/pre-commit

echo "🔍 Validating rulesync rules..."
npx rulesync validate --quiet

if [ $? -ne 0 ]; then
  echo "❌ Rule validation failed. Fix errors before committing."
  npx rulesync validate
  exit 1
fi

echo "🔄 Updating generated configurations..."
npx rulesync generate --quiet

# Stage any updated generated files
git add .cursor/rules/ .claude/memories/ .github/instructions/

echo "✅ rulesync validation and generation completed"
```

This comprehensive command reference provides everything needed to effectively use rulesync in any development environment or workflow.