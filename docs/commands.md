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
- `-f, --features <features>`: Comma-separated list of features to generate (rules, commands, mcp, ignore, subagents) or `*` for all
- `--all`: ⚠️ **[DEPRECATED]** Generate for all supported AI tools (use `--targets *` instead)
- `--delete`: Remove existing generated files before creating new ones
- `--verbose`, `-v`: Show detailed generation process
- `--config <path>`: Use specific configuration file
- `--no-config`: Disable configuration file loading
- `--base-dir <paths>`: Generate in specific directories (comma-separated)

**Validation and Error Handling (Enhanced in v0.59.0):**
- Validates that at least one target is specified
- Prevents mixing `*` with specific tool names
- Shows clear error messages for invalid tool names
- Provides deprecation warnings for legacy syntax
- Validates tool names against supported target list

**Target Specification (New in v0.59.0):**
The `--targets` flag is now the preferred way to specify which tools to generate for:
- **Single tool**: `--targets copilot`
- **Multiple tools**: `--targets copilot,cursor,cline`
- **All tools**: `--targets *` (preferred) or `--targets all`
- **Validation**: Cannot mix `*` with specific tools (e.g., `--targets *,copilot` is invalid)

**Feature Specification (New in v0.63.0):**
The `--features` flag allows selective generation of specific feature types:
- **Single feature**: `--features rules`
- **Multiple features**: `--features rules,commands,mcp`
- **All features**: `--features *` (default when not specified)
- **Available features**: `rules`, `commands`, `mcp`, `ignore`, `subagents`
- **Validation**: Cannot mix `*` with specific features
- **Backward compatibility**: Defaults to all features when not specified (shows warning)

**Available Tools (19 total):**
`agentsmd`, `amazonqcli`, `augmentcode`, `augmentcode-legacy`, `claudecode`, `cline`, `codexcli`, `copilot`, `cursor`, `geminicli`, `junie`, `kiro`, `opencode`, `qwencode`, `roo`, `windsurf`

**Available Features (5 total):**
- **`rules`**: Core AI assistant rules and instructions
- **`commands`**: Custom slash commands for supported tools
- **`mcp`**: Model Context Protocol server configurations
- **`ignore`**: Ignore files for controlling AI file access
- **`subagents`**: Specialized AI assistants with specific behaviors (Claude Code only)

**Special Target Values:**
- `*` - All supported tools (preferred syntax)
- `all` - All supported tools (alternative syntax)

**Special Feature Values:**
- `*` - All supported features (default when not specified)

**Feature Compatibility:**
- **`rules`**: All tools support rule generation
- **`commands`**: Currently supported by Claude Code, Cursor, Cline, Gemini CLI, Roo Code
- **`mcp`**: Supported by tools with MCP integration (Amazon Q CLI, Claude Code, Cursor, etc.)
- **`ignore`**: Most tools support ignore files (except those using permission systems like OpenCode)

**Validation Rules:**
- Cannot combine `*` with specific tools
- Cannot combine `*` with specific features
- Tool names must be from the supported list above
- Feature names must be from the supported list above
- At least one target must be specified
- Features default to `*` (all) when not specified (with warning)

**⚠️ Deprecated Tool-Specific Flags (v0.59.0+):**
Individual tool flags are deprecated and show warnings. Use `--targets` instead for cleaner syntax:
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
# Generate all features for all tools (new preferred syntax)
npx rulesync generate --targets * --features *

# Generate all features for all tools (backward compatible)
npx rulesync generate --targets *  # Shows warning about missing --features

# Generate specific features for all tools
npx rulesync generate --targets * --features rules,mcp
npx rulesync generate --targets * --features rules  # Only rules, no MCP/ignore files

# Generate specific features for specific tools (recommended)
npx rulesync generate --targets copilot,cursor,cline --features rules,commands
npx rulesync generate --targets claudecode --features rules,mcp
npx rulesync generate -t copilot,cursor -f rules
# Generate subagents (Claude Code only)
npx rulesync generate --targets claudecode --features subagents
npx rulesync generate --targets claudecode --features rules,subagents,mcp

# Generate only rules (fastest option)
npx rulesync generate --targets * --features rules

# Generate only MCP configurations
npx rulesync generate --targets amazonqcli,claudecode --features mcp

# Clean generation with specific features
npx rulesync generate --targets copilot,cursor --features rules,ignore --delete --verbose

# Generate for monorepo packages with specific features
npx rulesync generate --targets * --features rules,mcp --base-dir ./packages/frontend,./packages/backend

# Legacy syntax (deprecated, shows warning)
npx rulesync generate --all
npx rulesync generate --cursor --claudecode

# ❌ Invalid syntax (will show error)
npx rulesync generate --targets *,copilot    # Error: cannot mix * with specific tools
npx rulesync generate --features *,rules     # Error: cannot mix * with specific features
npx rulesync generate                        # Error: no tools specified
```

**Migration Examples (v0.59.0+ and v0.63.0+):**
```bash
# Old syntax (deprecated, shows warning)
npx rulesync generate --all

# New syntax (preferred)
npx rulesync generate --targets * --features *

# Old syntax (deprecated, shows warning)
npx rulesync generate --copilot --cursor --cline

# New syntax (preferred)
npx rulesync generate --targets copilot,cursor,cline --features *

# Old syntax (deprecated, shows warning)
npx rulesync generate --claudecode --verbose

# New syntax (preferred)
npx rulesync generate --targets claudecode --features * --verbose

# Backward compatibility maintained
# All old syntax still works but shows deprecation warnings
# Use --targets and --features for clean output and future compatibility

# Error examples (will show helpful error messages)
npx rulesync generate --targets invalid-tool
npx rulesync generate --targets *,cursor
npx rulesync generate --features invalid-feature
npx rulesync generate --features *,rules
npx rulesync generate  # Error: no tools specified
```

**Generated Output:**
| Tool | Generated Files |
|------|----------------|
| Claude Code | `CLAUDE.md`, `.claude/memories/*.md`, `.claude/commands/*.md`, `.claude/subagents/*.md` |
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

**Options:**
- `-t, --targets <tools>`: Comma-separated list of tools to import from (recommended)
- `--features <features>`: Comma-separated list of features to import (rules, commands, mcp, ignore, subagents) or `*` for all
- `--legacy`: Import to legacy directory structure (`.rulesync/*.md`)
- `--verbose`, `-v`: Show detailed import process

**⚠️ Deprecated Tool-Specific Import Flags (use --targets instead):**
- `--claudecode` → `--targets claudecode`: Import from Claude Code (`CLAUDE.md`, `.claude/memories/`, `.claude/commands/`, `.claude/subagents/`)
- `--cursor` → `--targets cursor`: Import from Cursor (`.cursorrules`, `.cursor/rules/`, `.cursor/mcp.json`)
- `--copilot` → `--targets copilot`: Import from GitHub Copilot (`.github/copilot-instructions.md`, `.github/instructions/`)
- `--cline` → `--targets cline`: Import from Cline (`.cline/instructions.md`, `.clinerules/`)
- `--augmentcode` → `--targets augmentcode`: Import from AugmentCode (`.augment/rules/`)
- `--augmentcode-legacy` → `--targets augmentcode-legacy`: Import from legacy AugmentCode (`.augment-guidelines`)
- `--roo` → `--targets roo`: Import from Roo Code (`.roo/instructions.md`, `.roo/rules/`)
- `--geminicli` → `--targets geminicli`: Import from Gemini CLI (`GEMINI.md`, `.gemini/memories/`, `.gemini/commands/`)
- `--qwencode` → `--targets qwencode`: Import from Qwen Code (`QWEN.md`, `.qwen/memories/`)
- `--junie` → `--targets junie`: Import from JetBrains Junie (`.junie/guidelines.md`)
- `--windsurf` → `--targets windsurf`: Import from Windsurf (`.windsurf/rules/`, `.windsurf-rules`)
- `--agentsmd` → `--targets agentsmd`: Import from AgentsMd (`AGENTS.md`, `.agents/memories/*.md`)

**General Options:**
- `--legacy`: Import to legacy directory structure (`.rulesync/*.md`)
- `--verbose`, `-v`: Show detailed import process
- `--config <path>`: Use specific configuration file
- `--base-dir <path>`: Import from specific directory

**Examples:**
```bash
# Import from Claude Code (to .rulesync/rules/)
npx rulesync import --targets claudecode

# Import from multiple tools
npx rulesync import --targets claudecode,cursor,copilot

# Import specific features
npx rulesync import --targets cursor --features rules,commands

# Import to legacy location (.rulesync/*.md)
npx rulesync import --targets claudecode --legacy

# Import with verbose output
npx rulesync import --targets claudecode --verbose --features *

# Import legacy AugmentCode format
npx rulesync import --targets augmentcode-legacy

# Legacy syntax (deprecated, shows warnings)
npx rulesync import --claudecode
npx rulesync import --cursor --copilot
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