## Declarative Skill Sources

Rulesync can automatically fetch skills from external GitHub repositories as part of the `generate` command. Instead of manually running `fetch` for each skill source, declare them in your `rulesync.jsonc` and they'll be resolved and pulled in every time you generate.

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

When `generate` runs and `sources` is configured (with the `skills` feature enabled):

1. **Lockfile resolution** — Each source's ref is resolved to a commit SHA and stored in `.rulesync/sources-lock.json`. On subsequent runs the locked SHA is reused for deterministic builds.
2. **Remote skill listing** — The `skills/` directory (or the path specified in the source URL) is listed from the remote repository.
3. **Filtering** — If `skills` is specified, only matching skill directories are fetched.
4. **Precedence rules**:
   - **Local skills always win** — Skills in `.rulesync/skills/` (not in `.curated/`) take precedence; a remote skill with the same name is skipped.
   - **First-declared source wins** — If two sources provide a skill with the same name, the one declared first in the `sources` array is used.
5. **Output** — Fetched skills are written to `.rulesync/skills/.curated/<skill-name>/`. This directory is automatically added to `.gitignore` by `rulesync gitignore`.

### CLI Options

Two flags on the `generate` command control source behavior:

| Flag               | Description                                                                           |
| ------------------ | ------------------------------------------------------------------------------------- |
| `--skip-sources`   | Skip source fetching entirely (use whatever is already on disk).                      |
| `--update-sources` | Force re-resolve all source refs, ignoring the lockfile (useful to pull new updates). |

```bash
# Normal generate — fetches sources using locked refs
npx rulesync generate

# Skip source fetching (e.g., offline or CI cache)
npx rulesync generate --skip-sources

# Force update to latest refs
npx rulesync generate --update-sources
```

### Lockfile

The lockfile at `.rulesync/sources-lock.json` records the resolved commit SHA for each source so that builds are reproducible. It is safe to commit this file. An example:

```json
{
  "sources": {
    "owner/skill-repo": {
      "resolvedRef": "abc123def456...",
      "skills": ["my-skill", "another-skill"]
    }
  }
}
```

To update locked refs, run `npx rulesync generate --update-sources`.

### Authentication

Source fetching uses the `GITHUB_TOKEN` or `GH_TOKEN` environment variable for authentication. This is required for private repositories and recommended for better rate limits.

```bash
# Using environment variable
export GITHUB_TOKEN=ghp_xxxx
npx rulesync generate

# Or using GitHub CLI
GITHUB_TOKEN=$(gh auth token) npx rulesync generate
```

> [!NOTE]
> Unlike the `fetch` command, the `generate` command does not accept a `--token` flag. Authentication for declarative sources relies on environment variables.

### Curated vs Local Skills

| Location                            | Type    | Precedence | Committed to Git |
| ----------------------------------- | ------- | ---------- | ---------------- |
| `.rulesync/skills/<name>/`          | Local   | Highest    | Yes              |
| `.rulesync/skills/.curated/<name>/` | Curated | Lower      | No (gitignored)  |

When both a local and a curated skill share the same name, the local skill is used and the remote one is not fetched.
