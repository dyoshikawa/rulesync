## Getting Started

```bash
# Install rulesync globally
npm install -g rulesync

# Create necessary directories, sample rule files, and configuration file
rulesync init

# Install official skills (recommended)
rulesync fetch dyoshikawa/rulesync --features skills
```

On the other hand, if you already have AI tool configurations:

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
