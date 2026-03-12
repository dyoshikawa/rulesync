# Declarative Sources

Rulesync can fetch skills, rules, commands, and subagents from external repositories using the `install` command. Instead of manually running `fetch` for each source, declare them in your `rulesync.jsonc` and run `rulesync install` to resolve and fetch them. Then `rulesync generate` picks them up alongside local items. Typical workflow: `rulesync install && rulesync generate`.

## Configuration

Add a `sources` array to your `rulesync.jsonc`:

```jsonc
{
  "$schema": "https://github.com/dyoshikawa/rulesync/releases/latest/download/config-schema.json",
  "targets": ["copilot", "claudecode"],
  "features": ["rules", "skills"],
  "sources": [
    // Fetch all skills from a GitHub repository (default transport)
    { "source": "owner/repo" },

    // Fetch skills, rules, and commands from a source
    { "source": "owner/repo", "features": ["skills", "rules", "commands"] },

    // Fetch all supported features using the wildcard
    { "source": "owner/repo", "features": ["*"] },

    // Fetch only specific skills by name
    { "source": "anthropics/skills", "skills": ["skill-creator"] },

    // With ref pinning and subdirectory path (same syntax as fetch command)
    { "source": "owner/repo@v1.0.0:path/to/skills" },

    // Git transport — works with any git remote (Azure DevOps, Bitbucket, etc.)
    {
      "source": "https://dev.azure.com/org/project/_git/repo",
      "transport": "git",
      "ref": "main",
      "path": "exports/skills",
    },

    // Git transport with a local repository
    { "source": "file:///path/to/local/repo", "transport": "git" },
  ],
}
```

Each entry in `sources` accepts:

| Property    | Type       | Description                                                                                                                      |
| ----------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `source`    | `string`   | Repository source. For GitHub transport: `owner/repo` or `owner/repo@ref:path`. For git transport: a full git URL.               |
| `features`  | `string[]` | Features to fetch: `"skills"`, `"rules"`, `"commands"`, `"subagents"`, or `"*"` for all. Defaults to `["skills"]`.               |
| `skills`    | `string[]` | Optional list of skill names to fetch. If omitted, all skills are fetched. Only applies when `features` includes `"skills"`.     |
| `transport` | `string`   | `"github"` (default) uses the GitHub REST API. `"git"` uses git CLI and works with any git remote.                               |
| `ref`       | `string`   | Branch, tag, or ref to fetch from. Defaults to the remote's default branch. For GitHub transport, use the `@ref` source syntax.  |
| `path`      | `string`   | Path to the skills directory within the repository. Defaults to `"skills"`. For GitHub transport, use the `:path` source syntax. |

## How It Works

When `rulesync install` runs and `sources` is configured:

1. **Lockfile resolution** — Each source's ref is resolved to a commit SHA and stored in `rulesync.lock` (at the project root). On subsequent runs the locked SHA is reused for deterministic builds.
2. **Remote listing** — For each enabled feature, the corresponding directory (`skills/`, `rules/`, `commands/`, `subagents/`) is listed from the remote repository.
3. **Filtering** — If `skills` is specified on the source entry, only matching skill directories are fetched. Other features fetch all items.
4. **Precedence rules**:
   - **Local items always win** — Items in the main `.rulesync/<feature>/` directory (not in the remote subdirectory) take precedence; a remote item with the same name is skipped.
   - **First-declared source wins** — If two sources provide an item with the same name for a feature, the one declared first in the `sources` array is used.
5. **Output** — Fetched items are written to the feature's remote subdirectory:
   - Skills: `.rulesync/skills/.curated/<skill-name>/`
   - Rules: `.rulesync/rules/.remote/<rule-name>.md`
   - Commands: `.rulesync/commands/.remote/<command-name>.md`
   - Subagents: `.rulesync/subagents/.remote/<subagent-name>.md`

These remote directories are automatically added to `.gitignore` by `rulesync gitignore`.

## CLI Options

The `install` command accepts these flags:

| Flag              | Description                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--update`        | Force re-resolve all source refs, ignoring the lockfile (useful to pull new updates).                                                                       |
| `--frozen`        | Fail if lockfile is missing or out of sync. Fetches missing items using locked refs without updating the lockfile. Useful for CI to ensure reproducibility. |
| `--token <token>` | GitHub token for private repositories.                                                                                                                      |

```bash
# Install using locked refs
rulesync install

# Force update to latest refs
rulesync install --update

# Strict CI mode — fail if lockfile doesn't cover all sources (missing locked items are fetched)
rulesync install --frozen

# Install then generate
rulesync install && rulesync generate

# Skip source installation — just don't run install
rulesync generate
```

## Lockfile

The lockfile at `rulesync.lock` (at the project root) records the resolved commit SHA and per-item integrity hashes for each source so that builds are reproducible. It is safe to commit this file. An example:

```json
{
  "lockfileVersion": 1,
  "sources": {
    "owner/skill-repo": {
      "requestedRef": "main",
      "resolvedRef": "abc123def456...",
      "resolvedAt": "2025-01-15T12:00:00.000Z",
      "skills": {
        "my-skill": { "integrity": "sha256-abcdef..." },
        "another-skill": { "integrity": "sha256-123456..." }
      },
      "rules": {
        "coding-standards.md": { "integrity": "sha256-789abc..." }
      }
    }
  }
}
```

To update locked refs, run `rulesync install --update`.

## Authentication

GitHub transport uses the `GITHUB_TOKEN` or `GH_TOKEN` environment variable for authentication. This is required for private repositories and recommended for better rate limits. Git transport relies on your local git credential configuration (SSH keys, credential helpers, etc.).

```bash
# Using environment variable
export GITHUB_TOKEN=ghp_xxxx
npx rulesync install

# Or using GitHub CLI
GITHUB_TOKEN=$(gh auth token) npx rulesync install
```

> [!TIP]
> The `install` command also accepts a `--token` flag for explicit authentication: `rulesync install --token ghp_xxxx`.

## Remote vs Local Items

| Location                                | Type   | Precedence | Committed to Git |
| --------------------------------------- | ------ | ---------- | ---------------- |
| `.rulesync/skills/<name>/`              | Local  | Highest    | Yes              |
| `.rulesync/skills/.curated/<name>/`     | Remote | Lower      | No (gitignored)  |
| `.rulesync/rules/<name>.md`             | Local  | Highest    | Yes              |
| `.rulesync/rules/.remote/<name>.md`     | Remote | Lower      | No (gitignored)  |
| `.rulesync/commands/<name>.md`          | Local  | Highest    | Yes              |
| `.rulesync/commands/.remote/<name>.md`  | Remote | Lower      | No (gitignored)  |
| `.rulesync/subagents/<name>.md`         | Local  | Highest    | Yes              |
| `.rulesync/subagents/.remote/<name>.md` | Remote | Lower      | No (gitignored)  |

When both a local and a remote item share the same name, the local item is used and the remote one is skipped.

> [!NOTE]
> Skills use `.curated/` as the remote subdirectory for historical reasons. New features use `.remote/`.
