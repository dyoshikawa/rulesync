## Getting Started

```bash
# Create necessary directories, sample rule files, and configuration file
npx rulesync init

# Install official skills (recommended)
npx rulesync fetch dyoshikawa/rulesync --features skills
```

On the other hand, if you already have AI tool configurations:

```bash
# Import existing files (to .rulesync/**/*)
npx rulesync import --targets claudecode    # From CLAUDE.md
npx rulesync import --targets cursor        # From .cursorrules
npx rulesync import --targets copilot       # From .github/copilot-instructions.md
npx rulesync import --targets claudecode --features rules,mcp,commands,subagents

# And more tool supports

# Generate unified configurations with all features
npx rulesync generate --targets "*" --features "*"
```
