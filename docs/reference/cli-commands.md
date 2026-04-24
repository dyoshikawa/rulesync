# CLI Commands

## Quick Commands

```bash
# Initialize new project (recommended: organized rules structure)
rulesync init

# Import existing configurations (to .rulesync/rules/ by default)
rulesync import --targets claudecode --features rules,ignore,mcp,commands,subagents,skills

# Convert configurations from one tool to other tools (skips .rulesync/)
rulesync convert --from cursor --to copilot,claudecode
rulesync convert --from cursor --to copilot,claudecode --features rules,mcp

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

# Generate from a shared rules directory (without cd-ing into it)
rulesync generate --input-root ~/.aiglobal --targets "*" --features rules

# Install skills from declarative sources in rulesync.jsonc
rulesync install

# Force re-resolve all source refs (ignore lockfile)
rulesync install --update

# Fail if lockfile is missing or out of sync (for CI); fetch missing skills using locked refs
rulesync install --frozen

# Install then generate (typical workflow)
rulesync install && rulesync generate

# Add generated files to .gitignore
rulesync gitignore

# Add only specific tool entries to .gitignore
rulesync gitignore --targets claudecode,copilot

# Add only specific feature entries to .gitignore
rulesync gitignore --targets copilot --features rules,commands

# Update rulesync to the latest version (single-binary installs)
rulesync update

# Check for updates without installing
rulesync update --check

# Force update even if already at latest version
rulesync update --force
```

## Generate Command

The `generate` command reads source files from `.rulesync/` and writes AI tool configuration files to the output directories.

### Options

| Option                      | Description                                                                               | Default               |
| --------------------------- | ----------------------------------------------------------------------------------------- | --------------------- |
| `--targets, -t <tools>`     | Comma-separated list of tools (e.g. `claudecode,copilot` or `*`)                          | From `rulesync.jsonc` |
| `--features, -f <features>` | Comma-separated list of features (rules, commands, subagents, skills, ignore, mcp, hooks) | From `rulesync.jsonc` |
| `--input-root <path>`       | Path to the directory containing `.rulesync/` source files                                | CWD                   |
| `--dry-run`                 | Show what would change without writing files                                              | `false`               |
| `--check`                   | Like `--dry-run` but exits with code 1 if files are not up to date                        | `false`               |
| `--global`                  | Generate for global (user-scope) configuration files                                      | `false`               |
| `--simulate-commands`       | Generate simulated commands for tools that do not support them natively                   | `false`               |
| `--simulate-subagents`      | Generate simulated subagents for tools that do not support them natively                  | `false`               |
| `--delete`                  | Delete existing generated files before writing                                            | From `rulesync.jsonc` |

### Examples

```bash
# Generate all features for all configured tools
rulesync generate

# Generate rules for all tools
rulesync generate --targets "*" --features rules

# Generate from a shared directory without cd-ing into it
rulesync generate --input-root ~/.aiglobal --targets "*" --features rules

# Dry run: preview changes without writing
rulesync generate --dry-run --targets claudecode --features rules

# CI check: fail if generated files are not up to date
rulesync generate --check --targets "*" --features "*"
```

## Gitignore Command

The `gitignore` command adds generated AI tool configuration files to `.gitignore`. By default, it emits entries only for the tools listed in the `targets` of your `rulesync.jsonc` (controlled by the `gitignoreTargetsOnly` option, which defaults to `true`). Set `gitignoreTargetsOnly` to `false` to emit entries for all supported tools instead. You can also filter the output per-invocation with `--targets` / `--features`, which take precedence over the config.

You can route entries to `.gitattributes` instead by setting `gitignoreDestination` to `"gitattributes"` at root, tool, or tool × feature level. More specific settings take precedence.

> **No `rulesync.jsonc` in the project?** Entries for all supported tools are emitted. `gitignoreTargetsOnly` is only applied when a config file exists, so users without a config still get useful `.gitignore` coverage.

> **`agentsmd` entries are always included.** Even when `gitignoreTargetsOnly` is `true` and `agentsmd` is not listed in `targets`, entries for `AGENTS.md` (and related paths) are appended automatically. Because `AGENTS.md` is a de facto standard file read by many AI tools regardless of the target set, its gitignore entries are emitted unconditionally to prevent accidental commits of generated rule files. To opt out of this behavior, pass an explicit `--targets` option that omits `agentsmd`.

### Options

| Option                      | Description                                                                                          | Default                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `--targets, -t <tools>`     | Comma-separated list of tools to include (e.g., `claudecode,copilot` or `*` for all)                 | Derived from `targets` / `gitignoreTargetsOnly` |
| `--features, -f <features>` | Comma-separated list of features to include (rules, commands, subagents, skills, ignore, mcp, hooks) | `*` (all)                                       |

### Examples

```bash
# Add all entries (default)
rulesync gitignore

# Add entries for Claude Code only
rulesync gitignore --targets claudecode

# Add entries for multiple tools
rulesync gitignore --targets claudecode,copilot,cursor

# Add only rules and commands entries for Copilot
rulesync gitignore --targets copilot --features rules,commands
```

### Behavior

- **Common entries** (e.g., `.rulesync/skills/.curated/`, `rulesync.local.jsonc`) are always included regardless of filters.
- **General entries** (e.g., memories, settings) are always included when their target is selected.
- When re-running, all previously generated rulesync entries are removed before writing the new filtered set.

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

## Convert Command

The `convert` command converts configuration files from one AI tool directly to one or more destination tools **without creating `.rulesync/` files on disk**. The intermediate rulesync representation is kept in memory only.

This is useful when you want to translate a one-shot tool-to-tool conversion (e.g., "I have Cursor rules, give me Claude Code and Copilot equivalents") without adopting rulesync's managed source-of-truth workflow.

### Options

| Option                      | Description                                                                                                       | Default   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------- |
| `--from <tool>`             | Source tool to convert from (single tool, e.g., `cursor`, `claudecode`)                                           | Required  |
| `--to <tools>`              | Comma-separated list of destination tools (e.g., `copilot,claudecode`)                                            | Required  |
| `--features, -f <features>` | Comma-separated list of features to convert (rules, commands, subagents, skills, ignore, mcp, hooks, permissions) | `*` (all) |
| `--verbose, -V`             | Verbose output                                                                                                    | `false`   |
| `--silent, -s`              | Suppress all output                                                                                               | `false`   |
| `--global, -g`              | Convert for global (user scope) configuration files                                                               | `false`   |
| `--dry-run`                 | Show changes without writing files                                                                                | `false`   |

### Examples

```bash
# Convert Cursor rules to Copilot and Claude Code
rulesync convert --from cursor --to copilot,claudecode --features rules

# Convert all features Cursor and Copilot both support
rulesync convert --from cursor --to copilot

# Convert MCP configuration from Claude Code to Cursor
rulesync convert --from claudecode --to cursor --features mcp

# Dry run to preview the conversion
rulesync convert --from cursor --to copilot,claudecode --dry-run
```

### Behavior

- The intermediate rulesync files produced during conversion are **never** written to disk. Only destination tool files are written.
- Features that exist for the source tool but are not supported by a given destination tool are skipped with a warning.
- When `--features` is omitted, the command attempts every feature the source tool supports.
- Passing the source tool inside `--to` is rejected, because converting a tool onto itself is lossy.
- With `--dry-run`, no destination files are written; the command prints a summary prefixed with `[DRY RUN]` listing what would have been converted.
