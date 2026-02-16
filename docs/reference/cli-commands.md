# CLI Commands

## Quick Commands

```bash
# Initialize new project (recommended: organized rules structure)
rulesync init

# Import existing configurations (to .rulesync/rules/ by default)
rulesync import --targets claudecode --features rules,ignore,mcp,commands,subagents,skills

# Fetch configurations from a Git repository
rulesync fetch owner/repo
rulesync fetch owner/repo@v1.0.0 --features rules,commands
rulesync fetch https://github.com/owner/repo --conflict skip

# Generate all features for all tools (new preferred syntax)
rulesync generate --targets "*" --features "*"

# Generate specific features for specific tools
rulesync generate --targets copilot,cursor,cline --features rules,mcp
rulesync generate --targets claudecode --features rules,subagents

# Generate only rules (no MCP, ignore files, commands, or subagents)
rulesync generate --targets "*" --features rules

# Generate simulated commands and subagents
rulesync generate --targets copilot,cursor,codexcli --features commands,subagents --simulate-commands --simulate-subagents

# Dry run: show changes without writing files
rulesync generate --dry-run --targets claudecode --features rules

# Check if files are up to date (for CI/CD pipelines)
rulesync generate --check --targets "*" --features "*"

# Install skills from declarative sources in rulesync.jsonc
rulesync install

# Force re-resolve all source refs (ignore lockfile)
rulesync install --update

# Fail if lockfile is missing or out of sync (for CI)
rulesync install --frozen

# Install then generate (typical workflow)
rulesync install && rulesync generate

# Add generated files to .gitignore
rulesync gitignore

# Update rulesync to the latest version (single-binary installs)
rulesync update

# Check for updates without installing
rulesync update --check

# Force update even if already at latest version
rulesync update --force
```

## Fetch Command

The `fetch` command allows you to fetch configuration files directly from a Git repository (GitHub/GitLab).

> [!NOTE]
> This feature is in development and may change in future releases.

**Note:** The fetch command searches for feature directories (`rules/`, `commands/`, `skills/`, `subagents/`, etc.) directly at the specified path, without requiring a `.rulesync/` directory structure. This allows fetching from external repositories like `vercel-labs/agent-skills` or `anthropics/skills`.

### Source Formats

```bash
# Full URL format
rulesync fetch https://github.com/owner/repo
rulesync fetch https://github.com/owner/repo/tree/branch
rulesync fetch https://github.com/owner/repo/tree/branch/path/to/subdir
rulesync fetch https://gitlab.com/owner/repo  # GitLab (planned)

# Prefix format
rulesync fetch github:owner/repo
rulesync fetch gitlab:owner/repo              # GitLab (planned)

# Shorthand format (defaults to GitHub)
rulesync fetch owner/repo
rulesync fetch owner/repo@ref        # Specify branch/tag/commit
rulesync fetch owner/repo:path       # Specify subdirectory
rulesync fetch owner/repo@ref:path   # Both ref and path
```

### Options

| Option                  | Description                                                                                | Default                          |
| ----------------------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| `--target, -t <target>` | Target format to interpret files as (e.g., 'rulesync', 'claudecode')                       | `rulesync`                       |
| `--features <features>` | Comma-separated features to fetch (rules, commands, subagents, skills, ignore, mcp, hooks) | `*` (all)                        |
| `--output <dir>`        | Output directory relative to project root                                                  | `.rulesync`                      |
| `--conflict <strategy>` | Conflict resolution: `overwrite` or `skip`                                                 | `overwrite`                      |
| `--ref <ref>`           | Git ref (branch/tag/commit) to fetch from                                                  | Default branch                   |
| `--path <path>`         | Subdirectory in the repository                                                             | `.` (root)                       |
| `--token <token>`       | Git provider token for private repositories                                                | `GITHUB_TOKEN` or `GH_TOKEN` env |

### Examples

```bash
# Fetch skills from external repositories
rulesync fetch vercel-labs/agent-skills --features skills
rulesync fetch anthropics/skills --features skills

# Fetch all features from a public repository
rulesync fetch dyoshikawa/rulesync --path .rulesync

# Fetch only rules and commands from a specific tag
rulesync fetch owner/repo@v1.0.0 --features rules,commands

# Fetch from a private repository (uses GITHUB_TOKEN env var)
export GITHUB_TOKEN=ghp_xxxx
rulesync fetch owner/private-repo

# Or use GitHub CLI to get the token
GITHUB_TOKEN=$(gh auth token) rulesync fetch owner/private-repo

# Preserve existing files (skip conflicts)
rulesync fetch owner/repo --conflict skip

# Fetch from a monorepo subdirectory
rulesync fetch owner/repo:packages/my-package
```
