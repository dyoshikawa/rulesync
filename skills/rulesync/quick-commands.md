## Quick Commands

```bash
# Initialize new project (recommended: organized rules structure)
npx rulesync init

# Import existing configurations (to .rulesync/rules/ by default)
npx rulesync import --targets claudecode --features rules,ignore,mcp,commands,subagents,skills

# Fetch configurations from a Git repository
npx rulesync fetch owner/repo
npx rulesync fetch owner/repo@v1.0.0 --features rules,commands
npx rulesync fetch https://github.com/owner/repo --conflict skip

# Generate all features for all tools (new preferred syntax)
npx rulesync generate --targets "*" --features "*"

# Generate specific features for specific tools
npx rulesync generate --targets copilot,cursor,cline --features rules,mcp
npx rulesync generate --targets claudecode --features rules,subagents

# Generate only rules (no MCP, ignore files, commands, or subagents)
npx rulesync generate --targets "*" --features rules

# Generate simulated commands and subagents
npx rulesync generate --targets copilot,cursor,codexcli --features commands,subagents --simulate-commands --simulate-subagents

# Dry run: show changes without writing files
npx rulesync generate --dry-run --targets claudecode --features rules

# Check if files are up to date (for CI/CD pipelines)
npx rulesync generate --check --targets "*" --features "*"

# Add generated files to .gitignore
npx rulesync gitignore

# Update rulesync to the latest version (single-binary installs)
npx rulesync update

# Check for updates without installing
npx rulesync update --check

# Force update even if already at latest version
npx rulesync update --force
```
