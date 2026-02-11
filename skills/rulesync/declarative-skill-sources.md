## Declarative Skill Sources

Rulesync can fetch skills from external GitHub repositories using the `install` command. Instead of manually running `fetch` for each skill source, declare them in your `rulesync.jsonc` and run `rulesync install` to resolve and fetch them. Then `rulesync generate` picks them up as local curated skills. Typical workflow: `rulesync install && rulesync generate`.

### Configuration

Add a `sources` array to your `rulesync.jsonc`:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/dyoshikawa/rulesync/refs/heads/main/config-schema.json",
  "targets": ["copilot", "claudecode"],
  "features": ["rules", "skills"],
  "sources": [
    // Fetch all skills from a repository
    { "source": "owner/repo" },

    // Fetch only specific skills by name
    { "source": "anthropics/skills", "skills": ["skill-creator"] },

    // With ref pinning and subdirectory path (same syntax as fetch command)
    { "source": "owner/repo@v1.0.0:path/to/skills" },
  ],
}
```

Each entry in `sources` accepts:

| Property | Type       | Description                                                                                                 |
| -------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `source` | `string`   | Repository source using the same format as the `fetch` command (`owner/repo`, `owner/repo@ref:path`, etc.). |
| `skills` | `string[]` | Optional list of skill names to fetch. If omitted, all skills are fetched.                                  |

### How It Works

When `rulesync install` runs and `sources` is configured:

1. **Lockfile resolution** — Each source's ref is resolved to a commit SHA and stored in `rulesync.lock` (at the project root). On subsequent runs the locked SHA is reused for deterministic builds.
2. **Remote skill listing** — The `skills/` directory (or the path specified in the source URL) is listed from the remote repository.
3. **Filtering** — If `skills` is specified, only matching skill directories are fetched.
4. **Precedence rules**:
   - **Local skills always win** — Skills in `.rulesync/skills/` (not in `.curated/`) take precedence; a remote skill with the same name is skipped.
   - **First-declared source wins** — If two sources provide a skill with the same name, the one declared first in the `sources` array is used.
5. **Output** — Fetched skills are written to `.rulesync/skills/.curated/<skill-name>/`. This directory is automatically added to `.gitignore` by `rulesync gitignore`.

### CLI Options

The `install` command accepts these flags:

| Flag              | Description                                                                           |
| ----------------- | ------------------------------------------------------------------------------------- |
| `--update`        | Force re-resolve all source refs, ignoring the lockfile (useful to pull new updates). |
| `--frozen`        | Fail if lockfile is missing or out of sync. Useful for CI to ensure reproducibility.  |
| `--token <token>` | GitHub token for private repositories.                                                |

```bash
# Install skills using locked refs
rulesync install

# Force update to latest refs
rulesync install --update

# Strict CI mode — fail if lockfile doesn't cover all sources
rulesync install --frozen

# Install then generate
rulesync install && rulesync generate

# Skip source installation — just don't run install
rulesync generate
```

### Lockfile

The lockfile at `rulesync.lock` (at the project root) records the resolved commit SHA and per-skill integrity hashes for each source so that builds are reproducible. It is safe to commit this file. An example:

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
      }
    }
  }
}
```

To update locked refs, run `rulesync install --update`.

### Authentication

Source fetching uses the `GITHUB_TOKEN` or `GH_TOKEN` environment variable for authentication. This is required for private repositories and recommended for better rate limits.

```bash
# Using environment variable
export GITHUB_TOKEN=ghp_xxxx
npx rulesync install

# Or using GitHub CLI
GITHUB_TOKEN=$(gh auth token) npx rulesync install
```

> [!TIP]
> The `install` command also accepts a `--token` flag for explicit authentication: `rulesync install --token ghp_xxxx`.

### Curated vs Local Skills

| Location                            | Type    | Precedence | Committed to Git |
| ----------------------------------- | ------- | ---------- | ---------------- |
| `.rulesync/skills/<name>/`          | Local   | Highest    | Yes              |
| `.rulesync/skills/.curated/<name>/` | Curated | Lower      | No (gitignored)  |

When both a local and a curated skill share the same name, the local skill is used and the remote one is not fetched.
