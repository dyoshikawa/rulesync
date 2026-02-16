## Getting Started

```bash
# Create necessary directories, sample rule files, and configuration file
rulesync init

# Install official skills (recommended)
rulesync fetch dyoshikawa/rulesync --features skills

# Generate unified configurations with all features
rulesync generate --targets "*" --features "*"
```

If you already have AI tool configurations:

```bash
# Import existing files (to .rulesync/**/*)
rulesync import --targets claudecode    # From CLAUDE.md
rulesync import --targets cursor        # From .cursorrules
rulesync import --targets copilot       # From .github/copilot-instructions.md
```

See [Quick Start guide](https://dyoshikawa.github.io/rulesync/getting-started/quick-start) for more details.
