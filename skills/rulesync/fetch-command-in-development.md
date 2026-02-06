## Fetch Command (In Development)

The `fetch` command allows you to fetch configuration files directly from a Git repository (GitHub/GitLab).

> [!NOTE]
> This feature is in development and may change in future releases.

**Note:** The fetch command searches for feature directories (`rules/`, `commands/`, `skills/`, `subagents/`, etc.) directly at the specified path, without requiring a `.rulesync/` directory structure. This allows fetching from external repositories like `vercel-labs/agent-skills` or `anthropics/skills`.

### Source Formats

```bash
# Full URL format
npx rulesync fetch https://github.com/owner/repo
npx rulesync fetch https://github.com/owner/repo/tree/branch
npx rulesync fetch https://github.com/owner/repo/tree/branch/path/to/subdir
npx rulesync fetch https://gitlab.com/owner/repo  # GitLab (planned)

# Prefix format
npx rulesync fetch github:owner/repo
npx rulesync fetch gitlab:owner/repo              # GitLab (planned)

# Shorthand format (defaults to GitHub)
npx rulesync fetch owner/repo
npx rulesync fetch owner/repo@ref        # Specify branch/tag/commit
npx rulesync fetch owner/repo:path       # Specify subdirectory
npx rulesync fetch owner/repo@ref:path   # Both ref and path
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
npx rulesync fetch vercel-labs/agent-skills --features skills
npx rulesync fetch anthropics/skills --features skills

# Fetch all features from a public repository
npx rulesync fetch dyoshikawa/rulesync --path .rulesync

# Fetch only rules and commands from a specific tag
npx rulesync fetch owner/repo@v1.0.0 --features rules,commands

# Fetch from a private repository (uses GITHUB_TOKEN env var)
export GITHUB_TOKEN=ghp_xxxx
npx rulesync fetch owner/private-repo

# Or use GitHub CLI to get the token
GITHUB_TOKEN=$(gh auth token) npx rulesync fetch owner/private-repo

# Preserve existing files (skip conflicts)
npx rulesync fetch owner/repo --conflict skip

# Fetch from a monorepo subdirectory
npx rulesync fetch owner/repo:packages/my-package
```
