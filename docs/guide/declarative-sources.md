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
   - **Local inputs win within one source tree** — Rules and skills outside `.curated/` take precedence over a same-named curated artifact in that input root. Across multiple `inputRoots`, root order remains primary: a later root replaces an earlier root's effective artifact even when the later artifact is curated.
   - **First-declared source wins** — If two sources provide an artifact with the same name, the one declared first in the `sources` array is used.
5. **Output** — Fetched rules are written to `.rulesync/rules/.curated/<rule-name>.md`; fetched skills are written to `.rulesync/skills/.curated/<skill-name>/`. Both directories are automatically added to `.gitignore` by `rulesync gitignore`.

## Install Modes

`rulesync install` supports three install modes via `--mode <mode>`:

| Mode       | Manifest input               | Lockfile                                                     | Output layout                                                                                                      |
| ---------- | ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `rulesync` | `rulesync.jsonc` `sources`   | `rulesync.lock` (+ `rulesync-npm.lock.json` for npm sources) | `.rulesync/rules/.curated/<name>.md`, `.rulesync/skills/.curated/<name>/` (then re-emitted by `rulesync generate`) |
| `apm`      | `apm.yml` `dependencies.apm` | `rulesync-apm.lock.yaml`                                     | `.github/instructions/`, `.github/skills/` (APM v1 layout)                                                         |
| `gh`       | `rulesync.jsonc` `sources`   | GitHub CLI installed metadata (no Rulesync lockfile)         | Native `gh skill install` destinations                                                                             |

When `--mode` is omitted, rulesync defaults to `rulesync` mode. If `apm.yml` is present and `sources` is also defined, you must pass `--mode apm` or `--mode rulesync` to disambiguate.

### `--mode gh`: installation through GitHub CLI

`--mode gh` reads `rulesync.jsonc.sources` and runs the installed [GitHub CLI's skill installer](https://cli.github.com/manual/gh_skill_install). Install a current `gh` with `gh skill` support and authenticate with `gh auth login`, `GH_TOKEN`, or `GITHUB_TOKEN`. Rulesync's `--token` is passed to the child process as `GH_TOKEN`, never as a command argument. GitHub CLI's skills commands are in preview; its installed implementation determines discovery, placement, metadata, and update behavior.

Rulesync provides the declaration; GitHub CLI owns the installed state. It writes source tracking into `SKILL.md` under `metadata.github-repo`, `metadata.github-ref`, `metadata.github-tree-sha`, and `metadata.github-path`, and maintains its own user-level `~/.agents/.skill-lock.json`. Rulesync does not read or write a gh-mode lockfile.

| Field                        | Behavior in gh mode                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`                     | GitHub repository: `owner/repo`, `owner/repo@ref`, or a GitHub URL.                                                                                                                         |
| `skills`                     | Skill names or repository-relative skill paths accepted by `gh skill install`. Prefer exact paths ending in `SKILL.md` for large repositories. Missing skills fail the source installation. |
| `ref`                        | Install from this branch, tag, or commit, overriding an inline source ref. Passed as `skill@ref`. Without a ref, gh selects the latest release, falling back to the default branch.         |
| `agent`                      | Any agent ID supported by the installed gh; defaults to `github-copilot`. The legacy Rulesync value `gemini` maps to `gemini-cli`.                                                          |
| `scope`                      | `project` (default) or `user`, passed to gh. Project placement follows gh's Git repository root discovery, falling back to the working directory outside Git.                               |
| `transport`                  | Omit or use `github`. Other transports require `--mode rulesync`.                                                                                                                           |
| `path`, `rules`, `rulesPath` | Rejected. Select individual skill paths with `skills`; install declarative rules with `--mode rulesync`.                                                                                    |

Omitting `skills`, using an empty array, or including `"*"` installs all skills. Without a ref this delegates to `gh skill install --all`, including gh's supported discovery conventions. With an explicit ref, Rulesync discovers the existing `skills/<name>/SKILL.md` layout through `gh api`, then installs each exact path at that ref. GitHub CLI does not allow `--all` with `skill@ref`; declare explicit skill paths for other layouts at a specified ref.

```jsonc
{
  "sources": [
    { "source": "acme/skills", "skills": ["git-commit"], "agent": "universal" },
    {
      "source": "acme/skills",
      "ref": "main",
      "skills": ["skills/git-commit/SKILL.md"],
      "agent": "claude-code",
      "scope": "user",
    },
  ],
}
```

Each `rulesync install --mode gh` reinstalls the declarations with `gh skill install --force`. Sources run in declaration order, so later sources can overwrite earlier installations at the same destination. Reinstallation refreshes the declared ref and overwrites files supplied by that source. It does not prune removed declarations or extra files; manage those explicitly. GitHub CLI owns the destination layout, including shared destinations such as `.agents/skills` for several agents.

#### Updates and fixed revisions

Use [`gh skill list`](https://cli.github.com/manual/gh_skill_list) and [`gh skill update`](https://cli.github.com/manual/gh_skill_update) directly:

```bash
rulesync install --mode gh
gh skill list --json skillName,sourceURL,version,pinned,path
gh skill update --dry-run --all
gh skill update --all

# Limit the native update to one installation directory
gh skill update --dir .agents/skills --dry-run --all
```

GitHub CLI 2.102.0 selects the latest release or default branch when updating, even if installation used `skill@branch`. The recorded `github-ref` describes the installation, not a branch-tracking policy. Inline `@ref` does not set `github-pinned`; gh skips persistent pins created with its own pin flag. Native updates can therefore move a skill away from a Rulesync-declared ref. Re-run `rulesync install --mode gh` to restore that declaration. See the [current ref resolution](https://github.com/cli/cli/blob/v2.102.0/internal/skills/discovery/discovery.go) and [update implementation](https://github.com/cli/cli/blob/v2.102.0/pkg/cmd/skills/update/update.go); preview behavior can change.

Rulesync rejects `--update` in gh mode: use the native updater for its update policy, or plain install to reapply the declared refs. It also rejects `--frozen` before starting gh. There is no gh-mode frozen-install guarantee. For a fixed source revision, declare a full commit SHA in `ref`; branches and movable tags are not immutable, and a subsequent native update can still replace that installation. Use `--mode rulesync` when you need Rulesync's lockfile and frozen-install contract.

#### Migrating earlier gh-mode installations

Earlier Rulesync versions wrote top-level `source`, `repository`, and `ref` fields that gh's updater does not recognize. Merely appearing in `gh skill list` did not establish update compatibility.

1. Review your source declarations. If you need the old recorded revision for the migration, copy the relevant `resolved_commit` from `rulesync-gh.lock.yaml` into the corresponding source's `ref` before installing. Otherwise migration resolves the declared ref anew.
2. Run `rulesync install --mode gh`. The old lock is ignored, including malformed files, and gh overwrites the declared skills with its own metadata. Local edits to source-owned files are overwritten.
3. Verify the source and version with `gh skill list` and inspect `gh skill update --dry-run --all`.
4. Remove `rulesync-gh.lock.yaml` from the project and version control after successful migration. Remove obsolete `--frozen`/`--update` gh-mode invocations from CI and scripts. Skills no longer declared and files no longer supplied by the source need explicit cleanup; the old lock's `deployed_files` can help identify them.

GitHub CLI 2.102.0's installer retains extra files on forced reinstall. Its updater replaces a changed skill's directory contents, including removal of extra files. Rulesync delegates those behaviors to gh and does not maintain a second ownership ledger.

## CLI Options

The `install` command accepts these flags:

| Flag              | Description                                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--mode <mode>`   | Install mode: `rulesync` (default), `apm`, or `gh`. See **Install Modes** above.                                                                                                                          |
| `--update`        | Force re-resolve source refs, ignoring the lockfile. Rejected in gh mode; use `gh skill update`.                                                                                                          |
| `--frozen`        | Fail if a lockfile is missing or does not cover declared sources and their skill and rule selections. Fetches missing locked artifacts without updating the lockfile. Useful for CI. Rejected in gh mode. |
| `--outdated`      | Report which sources are behind in the lockfile without installing or writing anything. See **Checking for Outdated Sources** below.                                                                      |
| `--token <token>` | GitHub token for private repositories.                                                                                                                                                                    |

```bash
# Install rules and skills using locked refs
rulesync install

# Force update to latest refs
rulesync install --update

# Strict CI mode — fail if lockfile doesn't cover all sources and selections
rulesync install --frozen

# Report sources whose lockfile entry is behind (read-only)
rulesync install --outdated

# Install then generate
rulesync install && rulesync generate

# Skip source installation — just don't run install
rulesync generate
```

## Lockfile

The lockfile at `rulesync.lock` (at the project root) records the resolved commit SHA, the skill and rule selections each entry was written for, and per-artifact integrity hashes for each source so that builds are reproducible. Rulesync verifies cached rule content against these hashes before reusing it. It is safe to commit this file. An example:

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
      "skillSelection": ["*"],
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

### Checking for Outdated Sources

`rulesync install --outdated` answers "is my lockfile behind its sources?" without changing anything: it writes no lockfile, fetches no rules or skills, and touches no files. For each declared source it resolves the ref the same way `--update` would — the `ref` declared in `rulesync.jsonc` (or in the source string, such as `owner/repo@v1`), or the default branch when none is declared (the `latest` dist-tag for npm sources) — and compares the result with the commit SHA (`resolvedRef`) or package version (`resolvedVersion`) in the lockfile. Each source is reported as up to date, outdated, not locked (declared but missing from the lockfile), or failed (its ref could not be resolved, for example because the network or the registry is unreachable, or a token is missing).

The exit code makes the check usable in CI and scripts:

| Exit code | Meaning                                                                                 |
| --------- | --------------------------------------------------------------------------------------- |
| `0`       | Every source is locked at the ref it resolves to now.                                   |
| `1`       | At least one source is outdated or not locked; `rulesync install --update` moves it on. |
| `2`       | At least one source could not be resolved, so its status is unknown.                    |

With the global `--json` flag, the per-source report (`source`, `transport`, `status`, `requestedRef`, `lockedRef`, `latestRef`, `error`) is returned as `data.sources` on success and as `error.details.sources` when the command exits non-zero. Any other error — an invalid flag combination or an unreadable configuration file, for example — also exits with code `1`, as it does for every command; with `--json`, only an outdated result carries `error.details.sources`. `--outdated` works only in the default `rulesync` mode and cannot be combined with `--update` or `--frozen`. It checks refs only; whether the lockfile covers each source's `skills` and `rules` selection is what `--frozen` checks.

Changing a source's `skills` or `rules` selection in `rulesync.jsonc` (for example, adding a skill name to an explicit list, or switching to `"*"`) is picked up by the next plain `rulesync install`: the entry is refetched at its locked ref and the lockfile records the new selection. Under `--frozen`, a selection the lockfile does not cover fails the install instead. A lockfile written before `skillSelection` was recorded is fetched again once, at its locked ref, by the next plain `rulesync install`, which then records the selection; commit the updated lockfile so `--frozen` installs keep reusing the cache.

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
      "skillSelection": ["my-skill"],
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

| Location                             | Type    | Precedence within one root | Committed to Git |
| ------------------------------------ | ------- | -------------------------- | ---------------- |
| `.rulesync/skills/<name>/`           | Local   | Higher                     | Yes              |
| `.rulesync/skills/.curated/<name>/`  | Curated | Lower                      | No (gitignored)  |
| `.rulesync/rules/<name>.md`          | Local   | Higher                     | Yes              |
| `.rulesync/rules/.curated/<name>.md` | Curated | Lower                      | No (gitignored)  |

When a local and curated artifact in the same source tree share a name, the local artifact is used and the remote one is not fetched. With multiple input roots, this per-root selection happens before the roots are merged in order; see [Separate Input Root](./separate-input-root.md#merge-rules-per-feature).
