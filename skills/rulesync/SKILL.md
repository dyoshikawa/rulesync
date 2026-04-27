---
name: rulesync
description: >-
  Generates and syncs AI rule configuration files (.cursorrules, CLAUDE.md,
  copilot-instructions.md) across 20+ coding tools from a single source.
  Use when syncing AI rules, running rulesync commands, importing or
  generating rule files, or managing shared AI coding configurations.
targets: ["*"]
---

# Rulesync

Rulesync generates and synchronizes AI rule configuration files across 20+ coding tools (Claude Code, Cursor, Copilot, Windsurf, Cline, Gemini CLI, and more) from a single set of unified rule files in `.rulesync/`.

## Quick Start

```bash
# Install
npm install -g rulesync

# New project: initialize config, rules, and directory structure
rulesync init

# Import existing AI tool configs into unified format
rulesync import --targets claudecode    # From CLAUDE.md
rulesync import --targets cursor        # From .cursorrules
rulesync import --targets copilot       # From .github/copilot-instructions.md

# Generate tool-specific configs from unified rules
rulesync generate --targets "*" --features "*"
```

## Core Workflow

1. **Init** - `rulesync init` creates `rulesync.jsonc` config and `.rulesync/` directory with sample rules
2. **Write rules** - Add shared AI rules in `.rulesync/rules/`, MCP configs in `.rulesync/mcp/`, commands in `.rulesync/commands/`
3. **Generate** - `rulesync generate` produces tool-specific files (CLAUDE.md, .cursorrules, .github/copilot-instructions.md, etc.)
4. **Verify** - `rulesync generate --dry-run` previews changes; `--check` validates files are up to date (useful in CI)

## Key Commands

| Command                                          | Purpose                                          |
| ------------------------------------------------ | ------------------------------------------------ |
| `rulesync init`                                  | Scaffold project with config and sample rules    |
| `rulesync generate --targets "*" --features "*"` | Generate all tool configs from unified rules     |
| `rulesync import --targets <tool>`               | Import existing tool config into unified format  |
| `rulesync fetch owner/repo --features skills`    | Fetch rules or skills from a remote repository   |
| `rulesync install`                               | Install skill sources declared in rulesync.jsonc |
| `rulesync generate --check`                      | CI check that generated files are up to date     |
| `rulesync generate --dry-run`                    | Preview changes without writing files            |

## Detailed Reference

- [Installation](./installation.md), [Quick Start](./quick-start.md)
- [Why Rulesync?](./why-rulesync.md), [Configuration](./configuration.md), [Global Mode](./global-mode.md), [Separate Input Root](./separate-input-root.md), [Simulated Features](./simulated-features.md), [Declarative Sources](./declarative-sources.md), [Official Skills](./official-skills.md), [Dry Run](./dry-run.md), [Case Studies](./case-studies.md)
- [Supported Tools](./supported-tools.md), [CLI Commands](./cli-commands.md), [File Formats](./file-formats.md), [MCP Server](./mcp-server.md)
- [Programmatic API](./programmatic-api.md)
- [FAQ](./faq.md)
