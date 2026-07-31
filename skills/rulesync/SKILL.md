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

Rulesync generates and synchronizes AI rule configuration files across 20+ coding tools (Claude Code, Cursor, Copilot, Cline, Gemini CLI, and more) from a single set of unified rule files in `.rulesync/`.

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
| `rulesync fetch owner/repo`                      | Fetch skills from a remote repository            |
| `rulesync install`                               | Install skill sources declared in rulesync.jsonc |
| `rulesync generate --check`                      | CI check that generated files are up to date     |
| `rulesync generate --dry-run`                    | Preview changes without writing files            |
| `rulesync generate --watch`                      | Regenerate whenever source files change          |
| `rulesync docs [document]`                       | Print bundled documentation                      |
| `rulesync docs --search <text>`                  | Search the bundled documentation                 |

## Detailed Reference

The complete Rulesync documentation is bundled with the CLI. **Consult it with
`rulesync docs` before answering Rulesync-specific questions or performing
unfamiliar Rulesync operations** — it is the canonical detailed reference.

- `rulesync docs` — list every available document identifier
- `rulesync docs <document>` — print one document, e.g. `rulesync docs faq` or
  `rulesync docs guide/configuration`
- `rulesync docs --search <text>` — ranked full-text search across the
  documentation, e.g. `rulesync docs --search "global mode"`

Useful starting points: `getting-started/quick-start`, `guide/configuration`,
`reference/cli-commands`, `reference/supported-tools`, `reference/file-formats`,
`faq`.
