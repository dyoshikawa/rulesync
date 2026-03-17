# Quick Start

## New Project

```bash
# Install rulesync globally
npm install -g rulesync

# Create necessary directories, sample rule files, and configuration file
rulesync init

# Install official skills (recommended)
rulesync fetch dyoshikawa/rulesync --features skills

# Or add skill sources to rulesync.jsonc and run 'rulesync install' (see "Declarative Skill Sources")
```

## Existing AI Tool Configurations

If you already have AI tool configurations:

```bash
# Import existing files (to .rulesync/**/*)
rulesync import --targets claudecode    # From CLAUDE.md
rulesync import --targets cursor        # From .cursorrules
rulesync import --targets copilot       # From .github/copilot-instructions.md
rulesync import --targets claudecode --features rules,mcp,commands,subagents

# And more tool supports

# Generate unified configurations with all features
rulesync generate --targets "*" --features "*"
```

## Quick Commands

For a comprehensive list of all commands and options, see [CLI Commands](/reference/cli-commands).
