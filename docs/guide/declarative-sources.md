# Declarative Sources

Rulesync can fetch rules and skills from external repositories using the `install` command. Instead of manually running `fetch` for each source, declare it in your `rulesync.jsonc` and run `rulesync install` to resolve and fetch its selected artifacts. Then `rulesync generate` processes them as curated inputs. Typical workflow: `rulesync install && rulesync generate`.

To add one source without editing JSONC by hand, run `rulesync add <source>`. It preserves existing comments, appends the source entry, installs it, and updates the appropriate lockfile:

```bash
rulesync add anthropics/skills --skills skill-creator

# Add one rule without selecting any skills
rulesync add acme/ai-standards --rules testing-guidelines
```

The command fetches only the source being added. Existing sources must already be locked and installed; run `rulesync install` first when they are not. If the new source fails, Rulesync restores the manifest, source lockfiles, curated rules, and curated skills to their previous state.

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

    // Fetch only specific skills by name
    { "source": "anthropics/skills", "skills": ["skill-creator"] },

    // Fetch only specific .md rules from rules/ (no skills)
    {
      "source": "acme/ai-standards",
      "rules": ["testing-guidelines", "typescript-conventions"],
    },

    // Rules and skills can be selected from the same source
    {
      "source": "acme/ai-assets",
      "rules": ["*"],
      "rulesPath": "exports/rules",
      "skills": ["review-pr"],
      "path": "exports/skills",
    },

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

    // Git transport against a single-skill repo whose SKILL.md is at the root
    {
      "source": "https://github.com/feature-sliced/skills",
      "transport": "git",
      "path": ".",
    },

    // npm transport (EXPERIMENTAL) — fetch a package from an npm-compatible
    // registry (npmjs.org, JFrog Artifactory, Sonatype Nexus, Verdaccio, ...)
    {
      "source": "@acme/skill-package",
      "transport": "npm",
      "registry": "https://acme.jfrog.io/artifactory/api/npm/npm-local/",
      "tokenEnv": "ACME_REGISTRY_TOKEN",
    },
  ],
}
```

Each entry in `sources` accepts:

| Property    | Type       | Description                                                                                                                                                                                                           |
| ----------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`    | `string`   | Repository source. For GitHub transport: `owner/repo` or `owner/repo@ref:path`. For git transport: a full git URL. For npm transport: a package name (`pkg` or `@scope/pkg`).                                         |
| `skills`    | `string[]` | Optional skill names to fetch. `"*"` selects all skills. When both `skills` and `rules` are omitted, all skills are fetched for backward compatibility.                                                               |
| `rules`     | `string[]` | Optional rule names to fetch. Names may include or omit `.md`; `"*"` selects every direct `.md` file under `rulesPath`. Setting only `rules` fetches no skills.                                                       |
| `transport` | `string`   | `"github"` (default) uses the GitHub REST API. `"git"` uses git CLI and works with any git remote. `"npm"` (experimental) fetches a package from an npm-compatible registry.                                          |
| `ref`       | `string`   | Branch, tag, or ref to fetch from. Defaults to the remote's default branch. For GitHub transport, use the `@ref` source syntax. For npm transport: an exact version or dist-tag (defaults to `latest`).               |
| `path`      | `string`   | Path to the skills directory within the repository. Defaults to `"skills"`. Set to `""`, `"."`, or `"./"` to target the entire repository root (see note below). For GitHub transport, use the `:path` source syntax. |
| `rulesPath` | `string`   | Path to the rules directory within the repository or package. Defaults to `"rules"`. This is independent from the skills-only `path` field.                                                                           |
| `registry`  | `string`   | npm transport only. Base URL of the npm-compatible registry. Defaults to `https://registry.npmjs.org`.                                                                                                                |
| `tokenEnv`  | `string`   | npm transport only. Name of the environment variable holding the registry token. Defaults to `NPM_TOKEN`.                                                                                                             |

Rules are flat source files: only direct `.md` children of `rulesPath` are discovered. Nested rule files are not installed. Fetched rules are written to `.rulesync/rules/.curated/<rule-name>.md`; during generation they behave as if they were ordinary files directly under `.rulesync/rules/`.

> **Repository-root paths (`path: "."`):** When `path` is `""`, `"."`, or `"./"` (with the `git` transport), rulesync disables sparse-checkout and fetches the **entire** repository tree, then groups each top-level directory as a skill. This is useful for single-skill repositories whose `SKILL.md` lives at the repo root (`<repo>/SKILL.md`) rather than under a `skills/` container. Because the whole tree is fetched, prefer a narrower `path` for large repositories; the fetch is still bounded by rulesync's file-count, total-size, and depth limits.

## npm Transport (Experimental)

> [!WARNING]
> The `npm` transport is **experimental**. Its configuration surface and lockfile format may change in a future release.

The `npm` transport fetches skills from any registry that implements the npm registry API. Because JFrog Artifactory, Sonatype Nexus, Verdaccio, GitHub Packages, and similar private registries all expose an npm-compatible API, a single transport with a configurable `registry` URL covers them all. This lets enterprises whose build environments cannot reach public GitHub distribute skills internally as npm packages.

How a package is fetched:

1. The package metadata (packument) is fetched from `<registry>/<package>` using the abbreviated `application/vnd.npm.install-v1+json` form.
2. The declared `ref` (an **exact version** or a **dist-tag** such as `latest` or `beta` — semver ranges are not supported) is resolved to a concrete version.
3. The version's tarball is downloaded and verified against the registry's `dist.integrity` / `dist.shasum` metadata.
4. The tarball is extracted **in memory** with a hardened minimal tar reader: only regular files are materialized (symlinks, hardlinks, and device entries are skipped), path traversal is rejected, and extraction is capped at 10,000 files / 100 MB to prevent decompression bombs.

Package layout: skills are discovered the same way as for the git transports. Skill directories under `skills/` (or the configured `path`) are installed as `.rulesync/skills/.curated/<name>/`. Direct `.md` files under `rules/` (or the configured `rulesPath`) can be selected with `rules` and are installed under `.rulesync/rules/.curated/`. A single-skill package with `SKILL.md` at the package root is installed as one skill named after the package's base name (`@acme/my-skill` installs as `my-skill`); note that this root fallback installs the package's root-level files only, so prefer the `skills/<name>/` layout for skills that carry subdirectories such as `references/`.

Authentication uses a bearer token from an environment variable: `NPM_TOKEN` by default, or the variable named by the per-source `tokenEnv` field. The token is sent as `Authorization: Bearer <token>` to the registry (and to the tarball host only when it matches the registry host). `.npmrc` files are intentionally **not** read.

Resolved versions are pinned in `rulesync-npm.lock.json` (next to `rulesync.lock`), which records the resolved version, the tarball integrity, and per-artifact content hashes. Commit it for reproducible installs; `--update` and `--frozen` behave the same as for git sources.

## How It Works

When `rulesync install` runs and `sources` is configured:

1. **Lockfile resolution** — Each source's ref is resolved to a commit SHA and stored in `rulesync.lock` (at the project root). On subsequent runs the exact locked SHA is checked out for deterministic builds. npm-transport sources are pinned in a separate `rulesync-npm.lock.json` (resolved version + tarball integrity).
2. **Remote artifact listing** — The configured skills and rules directories are listed from the remote source.
3. **Filtering** — Only the names selected by `skills` and `rules` are fetched. Omitting both fields retains the historical behavior of fetching all skills.
4. **Precedence rules**:
   - **Local inputs always win** — Rules and skills outside `.curated/` take precedence over a remote artifact with the same name.
   - **First-declared source wins** — If two sources provide an artifact with the same name, the one declared first in the `sources` array is used.
5. **Output** — Fetched rules are written to `.rulesync/rules/.curated/<rule-name>.md`; fetched skills are written to `.rulesync/skills/.curated/<skill-name>/`. Both directories are automatically added to `.gitignore` by `rulesync gitignore`.

## Install Modes

`rulesync install` supports three install modes via `--mode <mode>`:

| Mode       | Manifest input               | Lockfile                                                     | Output layout                                                                                                      |
| ---------- | ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `rulesync` | `rulesync.jsonc` `sources`   | `rulesync.lock` (+ `rulesync-npm.lock.json` for npm sources) | `.rulesync/rules/.curated/<name>.md`, `.rulesync/skills/.curated/<name>/` (then re-emitted by `rulesync generate`) |
| `apm`      | `apm.yml` `dependencies.apm` | `rulesync-apm.lock.yaml`                                     | `.github/instructions/`, `.github/skills/` (APM v1 layout)                                                         |
| `gh`       | `rulesync.jsonc` `sources`   | `rulesync-gh.lock.yaml`                                      | Per-agent / per-scope dirs (matching `gh skill install`)                                                           |

When `--mode` is omitted, rulesync defaults to `rulesync` mode. If `apm.yml` is present and `sources` is also defined, you must pass `--mode apm` or `--mode rulesync` to disambiguate.

### `--mode gh` — gh-skill-install–compatible layout

`--mode gh` reads the same `sources` array from `rulesync.jsonc` but writes each discovered skill into the agent-specific directory expected by `gh skill install`. Each source supports two extra fields:

| Property | Type     | Default          | Description                                                                               |
| -------- | -------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `agent`  | `string` | `github-copilot` | One of `github-copilot`, `claude-code`, `cursor`, `codex`, `gemini`, `antigravity`.       |
| `scope`  | `string` | `project`        | `project` writes inside the project root; `user` writes inside the user's home directory. |

Agent → install directory mapping:

| Agent            | Project scope (relative to project root) | User scope (relative to home) |
| ---------------- | ---------------------------------------- | ----------------------------- |
| `github-copilot` | `.agents/skills`                         | `.copilot/skills`             |
| `claude-code`    | `.claude/skills`                         | `.claude/skills`              |
| `cursor`         | `.agents/skills`                         | `.cursor/skills`              |
| `codex`          | `.agents/skills`                         | `.agents/skills`              |
| `gemini`         | `.agents/skills`                         | `.gemini/skills`              |
| `antigravity`    | `.agents/skills`                         | `.gemini/antigravity/skills`  |

For each skill discovered as `skills/<name>/SKILL.md` in the remote repository, rulesync deploys the entire skill directory to `<install-dir>/<name>/` and injects a provenance frontmatter block (`source`, `repository`, `ref`) into the deployed `SKILL.md`. The lockfile `rulesync-gh.lock.yaml` records one entry per `(source, agent, scope, skill)` tuple.

Per-source field support in `--mode gh`:

| Field       | Status                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`    | Required. Must resolve to a GitHub repository (`owner/repo`, `owner/repo@ref`, or an `https://github.com/...` URL).                          |
| `skills`    | Optional. When set, only the listed skill names are installed; remote skills not in the list are skipped, and missing names log a warning.   |
| `rules`     | **Rejected.** Declarative rules are supported only in `--mode rulesync`.                                                                     |
| `rulesPath` | **Rejected.** Declarative rules are supported only in `--mode rulesync`.                                                                     |
| `ref`       | Optional. Pins a tag, branch, or commit SHA. When omitted, gh mode resolves to the latest release's tag, falling back to the default branch. |
| `agent`     | Optional. Defaults to `github-copilot`. See the agent table above.                                                                           |
| `scope`     | Optional. Defaults to `project`.                                                                                                             |
| `transport` | **Rejected.** gh mode is GitHub-only and does not honor the `git` transport. Drop the field or switch to `--mode rulesync`.                  |
| `path`      | **Rejected.** The remote layout is fixed to `skills/<name>/SKILL.md`. Repositories that store skills elsewhere are not supported in gh mode. |

The remote repository must use the layout `skills/<name>/SKILL.md` (one directory per skill, each containing a `SKILL.md`). Other layouts are not auto-discovered.

Example `rulesync.jsonc`:

```jsonc
{
  "targets": ["claudecode"],
  "features": ["rules"],
  "sources": [
    // Default: agent=github-copilot, scope=project -> .agents/skills/git-commit/
    { "source": "acme/skills", "skills": ["git-commit"] },

    // Same source, deployed for Claude Code at user scope -> ~/.claude/skills/git-commit/
    {
      "source": "acme/skills",
      "skills": ["git-commit"],
      "agent": "claude-code",
      "scope": "user",
    },
  ],
}
```

Run with `npx rulesync install --mode gh`.

## CLI Options

The `install` command accepts these flags:

| Flag              | Description                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--mode <mode>`   | Install mode: `rulesync` (default), `apm`, or `gh`. See **Install Modes** above.                                                                                     |
| `--update`        | Force re-resolve all source refs, ignoring the lockfile (useful to pull new updates).                                                                                |
| `--frozen`        | Fail if a lockfile is missing or does not cover declared sources and rule selections. Fetches missing locked artifacts without updating the lockfile. Useful for CI. |
| `--token <token>` | GitHub token for private repositories.                                                                                                                               |

```bash
# Install rules and skills using locked refs
rulesync install

# Force update to latest refs
rulesync install --update

# Strict CI mode — fail if lockfile doesn't cover all sources and selections
rulesync install --frozen

# Install then generate
rulesync install && rulesync generate

# Skip source installation — just don't run install
rulesync generate
```

## Lockfile

The lockfile at `rulesync.lock` (at the project root) records the resolved commit SHA, rule selection metadata, and per-artifact integrity hashes for each source so that builds are reproducible. Rulesync verifies cached rule content against these hashes before reusing it. It is safe to commit this file. An example:

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
        "testing-guidelines": { "integrity": "sha256-789abc..." }
      },
      "ruleSelection": ["*"],
      "rulesPath": "rules",
      "resolvedRuleNames": ["testing-guidelines"]
    }
  }
}
```

To update locked refs, run `rulesync install --update`.

npm-transport sources (experimental) are pinned in a separate `rulesync-npm.lock.json`, because they lock a resolved package version and tarball integrity instead of a commit SHA:

```json
{
  "lockfileVersion": 1,
  "sources": {
    "@acme/skill-package": {
      "registry": "https://acme.jfrog.io/artifactory/api/npm/npm-local",
      "requestedVersion": "latest",
      "resolvedVersion": "1.2.3",
      "integrity": "sha512-...",
      "resolvedAt": "2026-01-15T12:00:00.000Z",
      "skills": {
        "my-skill": { "integrity": "sha256-abcdef..." }
      },
      "rules": {
        "testing-guidelines": { "integrity": "sha256-789abc..." }
      },
      "ruleSelection": ["testing-guidelines"],
      "rulesPath": "rules",
      "resolvedRuleNames": ["testing-guidelines"]
    }
  }
}
```

It is safe (and recommended) to commit this file as well.

## Authentication

GitHub transport uses the `GITHUB_TOKEN` or `GH_TOKEN` environment variable for authentication. This is required for private repositories and recommended for better rate limits. Git transport relies on your local git credential configuration (SSH keys, credential helpers, etc.). npm transport (experimental) uses the `NPM_TOKEN` environment variable, or the variable named by the per-source `tokenEnv` field; `.npmrc` files are not read.

```bash
# Using environment variable
export GITHUB_TOKEN=ghp_xxxx
npx rulesync install

# Or using GitHub CLI
GITHUB_TOKEN=$(gh auth token) npx rulesync install
```

> [!TIP]
> The `install` command also accepts a `--token` flag for explicit authentication: `rulesync install --token ghp_xxxx`.

## Curated vs Local Inputs

| Location                             | Type    | Precedence | Committed to Git |
| ------------------------------------ | ------- | ---------- | ---------------- |
| `.rulesync/skills/<name>/`           | Local   | Highest    | Yes              |
| `.rulesync/skills/.curated/<name>/`  | Curated | Lower      | No (gitignored)  |
| `.rulesync/rules/<name>.md`          | Local   | Highest    | Yes              |
| `.rulesync/rules/.curated/<name>.md` | Curated | Lower      | No (gitignored)  |

When a local and curated artifact share the same name, the local artifact is used and the remote one is not fetched.
