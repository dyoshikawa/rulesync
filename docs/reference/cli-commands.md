# CLI Commands

## Quick Commands

```bash
# Initialize new project (recommended: organized rules structure)
rulesync init

# Import existing configurations (to .rulesync/rules/ by default)
rulesync import --targets claudecode --features rules,mcp,commands,subagents,skills,permissions

# Import components from an existing plugin directory
rulesync import --targets claudecode-plugin --features skills,hooks --output-root ./plugins/review-tools

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

# Generate components inside an existing plugin directory
rulesync generate --targets antigravity-plugin --features rules,mcp,subagents,skills,hooks --output-roots ./plugins/review-tools

# Generate only rules (no MCP, permissions, commands, or subagents)
rulesync generate --targets "*" --features rules

# Generate simulated commands and subagents
rulesync generate --targets copilot,cursor,codexcli --features commands,subagents --simulate-commands --simulate-subagents

# Dry run: show changes without writing files
rulesync generate --dry-run --targets claudecode --features rules

# Check if files are up to date (for CI/CD pipelines)
rulesync generate --check --targets "*" --features "*"

# Generate from a shared source tree (without cd-ing into it)
rulesync generate --input-roots ~/.aiglobal/.rulesync --targets "*" --features rules

# Install rules and skills from declarative sources in rulesync.jsonc
rulesync install

# Add a source to rulesync.jsonc, update the lockfile, and install it
rulesync add anthropics/skills --skills skill-creator

# Add a rule source without selecting skills
rulesync add acme/ai-standards --rules testing-guidelines

# Force re-resolve all source refs (ignore lockfile)
rulesync install --update

# Fail if lockfile is missing or out of sync (for CI); fetch missing artifacts using locked refs
rulesync install --frozen

# Install then generate (typical workflow)
rulesync install && rulesync generate

# Add generated files to .gitignore
rulesync gitignore

# Add only specific tool entries to .gitignore
rulesync gitignore --targets claudecode,copilot

# Add only specific feature entries to .gitignore
rulesync gitignore --targets copilot --features rules,commands

# Diagnose the configuration files for common problems (read-only)
rulesync doctor

# Diagnose and fail CI on warnings too
rulesync doctor --strict

# Print GitHub release notes for a repository (latest 10 by default)
rulesync release-notes dyoshikawa/rulesync

# Print the most recent 5 releases
rulesync release-notes dyoshikawa/rulesync --latest 5

# Update rulesync to the latest version (single-binary installs)
rulesync update

# Check for updates without installing
rulesync update --check

# Force update even if already at latest version
rulesync update --force
```

> **Deprecated feature:** `ignore` remains available to existing projects throughout Rulesync 14.x, but new projects should use `permissions`. Any removal will be decided separately and will not occur before a future major release.

## Generate Command

The `generate` command reads source files from one or more rulesync source trees (default: `<cwd>/.rulesync`; configurable via `--input-roots`) and writes AI tool configuration files to the output directories.

### Options

| Option                      | Description                                                                                                                                                                                                                                                                                                                                                                               | Default               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `--targets, -t <tools>`     | Comma-separated list of tools (e.g. `claudecode,copilot` or `*`)                                                                                                                                                                                                                                                                                                                          | From `rulesync.jsonc` |
| `--features, -f <features>` | Comma-separated list of features (rules, commands, subagents, skills, mcp, hooks, permissions, checks; deprecated: ignore)                                                                                                                                                                                                                                                                | From `rulesync.jsonc` |
| `--input-roots <paths...>`  | Ordered list of rulesync source-tree directories (e.g. `.rulesync`, `.rulesync.local`). Each entry is a source tree itself — no `.rulesync/` join is applied. The first root is required; later roots are optional overlays and may be absent. Later entries override earlier ones for the same relative source path (currently `generate` only). Cannot be combined with `--input-root`. | `<cwd>/.rulesync`     |
| `--input-root <path>`       | **Deprecated.** Path to the PARENT directory of a `.rulesync/` source tree; kept for backward compatibility and expands internally to `--input-roots <path>/.rulesync`. Prefer `--input-roots`. Cannot be combined with it.                                                                                                                                                               | CWD                   |
| `--dry-run`                 | Show what would change without writing files                                                                                                                                                                                                                                                                                                                                              | `false`               |
| `--check`                   | Like `--dry-run` but exits with code 1 if files are not up to date                                                                                                                                                                                                                                                                                                                        | `false`               |
| `--global`                  | Generate for global (user-scope) configuration files                                                                                                                                                                                                                                                                                                                                      | `false`               |
| `--simulate-commands`       | Generate simulated commands for tools that do not support them natively                                                                                                                                                                                                                                                                                                                   | `false`               |
| `--simulate-subagents`      | Generate simulated subagents for tools that do not support them natively                                                                                                                                                                                                                                                                                                                  | `false`               |
| `--simulate-skills`         | Generate simulated skills for tools that do not support them natively                                                                                                                                                                                                                                                                                                                     | `false`               |
| `--delete`                  | Delete existing generated files before writing                                                                                                                                                                                                                                                                                                                                            | From `rulesync.jsonc` |
| `--watch, -w`               | Keep running and regenerate whenever rulesync source files change                                                                                                                                                                                                                                                                                                                         | `false`               |

> **Note on `--delete` and shared output directories:** Several targets write
> into one directory on purpose — `.agents/agents/`, `.agents/skills/`, and the
> rest of the cross-vendor roots. The orphan sweep runs only after every target
> and every feature in the run has written, and it skips any path the run itself
> produced, so one target never deletes a sibling's freshly written file and an
> already-synchronized tree stays a no-op under `--check`. What is swept is
> unchanged: a file in a generated directory that no `.rulesync/` source
> produces.

### Examples

```bash
# Generate all features for all configured tools
rulesync generate

# Generate rules for all tools
rulesync generate --targets "*" --features rules

# Generate from a shared source tree without cd-ing into it
rulesync generate --input-roots ~/.aiglobal/.rulesync --targets "*" --features rules

# Dry run: preview changes without writing
rulesync generate --dry-run --targets claudecode --features rules

# CI check: fail if generated files are not up to date
rulesync generate --check --targets "*" --features "*"

# Watch mode: regenerate on every change to the sources
rulesync generate --watch
```

### Watch mode

`generate --watch` runs one generation immediately and then keeps running, regenerating whenever the rulesync sources change. It is meant for iterating on rules, commands, subagents or skills without re-running the command by hand.

- **What is watched**: the `.rulesync/` source tree (recursively) plus the configuration files next to it (`rulesync.jsonc` and `rulesync.local.jsonc`, or the file passed to `--config`). Generated output is never watched, so a regeneration cannot re-trigger the watcher.
- **Debouncing**: bursts of file-system events (editor save storms, `git checkout` switching many files) are coalesced into a single regeneration after a short quiet period. Changes that arrive while a generation is running trigger exactly one follow-up run.
- **Errors keep the watcher alive**: a failing generation (e.g. invalid frontmatter saved mid-edit) is reported and watching continues; the process does not exit.
- **Configuration changes**: editing the configuration file triggers a regeneration, and the new values apply to it because the configuration is re-resolved on every run. The **set of watched paths is fixed at startup**, so changing `inputRoot`/`inputRoots` (or the location of the configuration file itself) requires restarting the command. A warning is printed whenever the configuration file changes as a reminder.
- **Incompatible flags**: `--watch` cannot be combined with `--check`, `--dry-run` or `--json`. The first two are one-shot verification modes and `--json` emits a single result document when the command exits, which never happens while watching.
- **Stopping**: `Ctrl+C` (`SIGINT`) or `SIGTERM` closes the watchers and exits normally.

### Tool home overrides win over the output root in global scope

Two tools read their profile location from an environment variable: Hermes Agent (`HERMES_HOME`) and Kimi Code (`KIMI_CODE_HOME`). When one of them is set, `generate --global` and `convert --global` write that tool's output under it, **overriding both `outputRoots` and an explicit `--output-roots`** for that target. See [Supported Tools](./supported-tools.md) for what each profile root contains. This is deliberate — the variable names where the tool itself looks, so honoring the flag instead would produce files the tool never reads. Every other target still uses the configured output root.

The override must be a usable directory: an empty value is ignored (the default profile location applies), and a value that is the filesystem root or an unnormalized path is rejected with an error naming the variable.

### Shared config files are never created empty

Some outputs are files Rulesync merges into rather than owns, because the tool (or you) keeps unrelated settings there: `.amp/settings.json(c)`, `.antigravity/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, `.codex/config.toml`, `.copilot/settings.json`, `.devin/config.json`, `.factory/settings.json`, `.github/copilot/settings.json`, `.grok/config.toml`, `.vibe/config.toml`, `.vscode/settings.json`, `.zed/settings.json`, `kilo.json(c)`, `opencode.json(c)`, and `reasonix.toml`. These are deliberately **not** added to `.gitignore` by `rulesync gitignore`, so that settings you hand-author in them stay version-controlled.

Because they stay committable, `generate` will not **create** one of them just to hold an empty payload: if Rulesync has nothing to contribute (e.g. no permissions map to that tool), the file is left absent instead of being written as `{}`. A file that already exists is always rewritten as usual, so nothing you authored is dropped. Every other generated file is written even when empty, since for a file Rulesync owns its existence is part of the output.

## Gitignore Command

The `gitignore` command adds generated AI tool configuration files to `.gitignore`. By default, it emits entries only for the tools listed in the `targets` of your `rulesync.jsonc` (controlled by the `gitignoreTargetsOnly` option, which defaults to `true`). Set `gitignoreTargetsOnly` to `false` to emit entries for all supported tools instead. You can also filter the output per-invocation with `--targets` / `--features`, which take precedence over the config.

You can route entries to `.gitattributes` instead by setting `gitignoreDestination` to `"gitattributes"` at root, tool, or tool × feature level. More specific settings take precedence.

> **No `rulesync.jsonc` in the project?** Entries for all supported tools are emitted. `gitignoreTargetsOnly` is only applied when a config file exists, so users without a config still get useful `.gitignore` coverage.

> **`agentsmd` entries are always included.** Even when `gitignoreTargetsOnly` is `true` and `agentsmd` is not listed in `targets`, entries for `AGENTS.md` (and related paths) are appended automatically. Because `AGENTS.md` is a de facto standard file read by many AI tools regardless of the target set, its gitignore entries are emitted unconditionally to prevent accidental commits of generated rule files. To opt out of this behavior, pass an explicit `--targets` option that omits `agentsmd`.

### Options

| Option                      | Description                                                                                                  | Default                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `--targets, -t <tools>`     | Comma-separated list of tools to include (e.g., `claudecode,copilot` or `*` for all)                         | Derived from `targets` / `gitignoreTargetsOnly` |
| `--features, -f <features>` | Comma-separated list of features to include (rules, commands, subagents, skills, ignore, mcp, hooks, checks) | `*` (all)                                       |

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

- **Common entries** (e.g., `.rulesync/rules/.curated/`, `.rulesync/skills/.curated/`, `rulesync.local.jsonc`) are always included regardless of filters.
- **General entries** (e.g., memories, settings) are always included when their target is selected.
- When re-running, all previously generated rulesync entries are removed before writing the new filtered set.

## Add Command

The `add` command can scaffold one Rulesync feature file or append one declarative source to `rulesync.jsonc`.

### Feature scaffolding

Use a feature keyword to create a valid, editable starter file:

```bash
# Named Markdown features
rulesync add rule --name overview
rulesync add command --name review-pr.md
rulesync add subagent --name planner
rulesync add skill --name project-context
rulesync add check --name security

# Singleton features
rulesync add mcp
rulesync add hooks
rulesync add permissions

# Deprecated compatibility scaffold; prefer permissions
rulesync add ignore
```

Named features accept a name with or without the `.md` suffix. Skills use the directory layout `.rulesync/skills/<name>/SKILL.md`; the other named features create `<name>.md` in their canonical Rulesync directory. Names cannot contain path separators.

When the target file exists, interactive execution asks before replacing it. Declining leaves the file unchanged. JSON, silent, and non-interactive execution fail safely; pass `--force` to overwrite explicitly. Singleton scaffolds recognize supported JSONC and legacy variants and replace the effective existing file instead of creating a shadowed canonical file.

Feature keywords are reserved when no source-specific option is present. To add a source whose identifier is also a feature keyword, provide a source option that makes the intent explicit, such as `rulesync add skill --transport npm`.

### Declarative sources

For any other source identifier, `add` appends one source to `rulesync.jsonc` and immediately runs the declarative source resolver. It preserves JSONC comments, installs selected rules into `.rulesync/rules/.curated/`, installs selected skills into `.rulesync/skills/.curated/`, and updates `rulesync.lock` or `rulesync-npm.lock.json`.

```bash
# GitHub source (default transport)
rulesync add anthropics/skills --skills skill-creator

# Rules only; direct .md files are selected from rules/
rulesync add acme/ai-standards --rules testing-guidelines,typescript-conventions

# Rules and skills from separate paths in one source
rulesync add acme/ai-assets --rules "*" --rules-path exports/rules --skills review-pr --path exports/skills

# Any Git remote through the git CLI
rulesync add https://example.com/team/skills.git --transport git --ref main --path skills

# npm-compatible registry
rulesync add @acme/skill-package --transport npm --registry https://registry.npmjs.org
```

The selected configuration file must already exist. Run `rulesync init` first, or pass `--config <path>`. Adding a source whose normalized source identity is already present fails instead of silently creating duplicate lockfile entries; edit the existing entry when changing its options.

The operation fetches only the source being added; existing declarations are not re-fetched. Existing sources must already be locked and installed, otherwise run `rulesync install` first. The operation is transactional: if the new source fails to install, Rulesync restores the manifest, source lockfiles, curated rules, and curated skills to their pre-command state.

| Option                | Description                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `--name <name>`       | Name for a rule, command, subagent, skill, or check scaffold                                      |
| `--force`             | Replace an existing scaffold file without prompting                                               |
| `--skills <skills>`   | Comma-separated skill names. `*` selects all skills.                                              |
| `--rules <rules>`     | Comma-separated rule names. Names may omit `.md`; `*` selects direct `.md` files under rulesPath. |
| `--transport <type>`  | `github` (default), `git`, or experimental `npm`                                                  |
| `--ref <ref>`         | Git ref, npm version, or npm dist-tag                                                             |
| `--path <path>`       | Skills path within the source; defaults to `skills`                                               |
| `--rules-path <path>` | Rules path within the source; defaults to `rules`                                                 |
| `--registry <url>`    | npm-compatible registry URL                                                                       |
| `--token-env <name>`  | Environment variable containing the npm registry token                                            |
| `--token <token>`     | GitHub token for private repositories                                                             |
| `--config <path>`     | Configuration file to edit (default: `rulesync.jsonc`)                                            |

When neither `--skills` nor `--rules` is provided, all skills are installed for backward compatibility. Providing only `--rules` installs no skills.

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

| Option                  | Description                                                                                                                                                  | Default                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `--target, -t <target>` | Target format to interpret files as (e.g., 'rulesync', 'claudecode')                                                                                         | `rulesync`                       |
| `--features <features>` | Comma-separated features to fetch (rules, commands, subagents, skills, ignore, mcp, hooks, permissions, checks)                                              | `skills`                         |
| `--output <dir>`        | Output directory relative to project root                                                                                                                    | `.rulesync`                      |
| `--conflict <strategy>` | Conflict resolution: `overwrite` or `skip`                                                                                                                   | `overwrite`                      |
| `--ref <ref>`           | Git ref (branch/tag/commit) to fetch from                                                                                                                    | Default branch                   |
| `--path <path>`         | Subdirectory in the repository                                                                                                                               | `.` (root)                       |
| `--skills <skills>`     | Comma-separated skill names to fetch (requires the skills feature)                                                                                           | All skills                       |
| `--interactive, -i`     | Interactively select skills to fetch via a checkbox prompt; nothing is selected initially, press `<a>` to select all (requires the skills feature and a TTY) | Disabled                         |
| `--token <token>`       | Git provider token for private repositories                                                                                                                  | `GITHUB_TOKEN` or `GH_TOKEN` env |

### Examples

```bash
# Fetch skills from external repositories
rulesync fetch vercel-labs/agent-skills
rulesync fetch anthropics/skills

# Fetch only specific skills by name
rulesync fetch anthropics/skills --skills pdf,docx

# Interactively select which skills to fetch (checkbox prompt)
# Nothing is checked when the prompt opens: press <space> to select the
# highlighted skill, <a> to select all, <i> to invert, and <enter> to confirm.
rulesync fetch anthropics/skills --interactive

# Interactively select skills with some pre-checked
rulesync fetch anthropics/skills --interactive --skills pdf

# Fetch all features from a public repository
rulesync fetch dyoshikawa/rulesync --path .rulesync --features "*"

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

| Option                      | Description                                                                                                               | Default   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------- |
| `--from <tool>`             | Source tool to convert from (single tool, e.g., `cursor`, `claudecode`)                                                   | Required  |
| `--to <tools>`              | Comma-separated list of destination tools (e.g., `copilot,claudecode`)                                                    | Required  |
| `--features, -f <features>` | Comma-separated list of features to convert (rules, commands, subagents, skills, ignore, mcp, hooks, permissions, checks) | `*` (all) |
| `--verbose, -V`             | Verbose output                                                                                                            | `false`   |
| `--silent, -s`              | Suppress all output                                                                                                       | `false`   |
| `--global, -g`              | Convert for global (user scope) configuration files                                                                       | `false`   |
| `--dry-run`                 | Show changes without writing files                                                                                        | `false`   |

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

## Doctor Command

The `doctor` command runs read-only diagnostics against the configuration files (`rulesync.jsonc` and `rulesync.local.jsonc`) and reports problems grouped by severity (`error` / `warning` / `info`). It never writes files, which makes it a safe first step when generation does not behave as expected, and a cheap CI guard.

It is especially useful for catching **silently ignored configuration**: the config schema is non-strict, so a misspelled key such as `"target"` instead of `"targets"` is normally swallowed without any error. `doctor` reports every unknown key with a "did you mean" suggestion.

### Checks

- JSONC parse errors, reported with line and column.
- Unknown or misspelled top-level keys, with a "did you mean" suggestion.
- Unknown tool targets and features (array and object forms), with the nearest valid name suggested.
- Deprecated features (`ignore`, superseded by `permissions`).
- Object-form `targets` combined with `features` — including the case where the conflict only appears after merging `rulesync.jsonc` with `rulesync.local.jsonc`.
- Conflicting target pairs (e.g. `claudecode` + `claudecode-legacy`).
- `$schema` presence and whether it points at the current config schema URL.
- Structural schema violations on any other key (wrong types, malformed `sources` entries).
- `sources[].tokenEnv` naming an environment variable that is not set.
- `inputRoot` or the first `inputRoots` entry pointing at a directory that does not exist. Later `inputRoots` entries are optional overlays and may be absent.
- `inputRoot` or an `inputRoots` entry set to an empty string, which makes `generate` fail with `outputRoot cannot be an empty string` before it resolves any source tree.
- Duplicate entries in `inputRoots` (warning; duplicates are ignored at generate time).

### Options

| Option                | Description                       | Default          |
| --------------------- | --------------------------------- | ---------------- |
| `--config, -c <path>` | Path to configuration file        | `rulesync.jsonc` |
| `--strict`            | Treat warnings as errors (exit 1) | `false`          |
| `--verbose, -V`       | Verbose output                    | `false`          |
| `--silent, -s`        | Suppress all output               | `false`          |

### Examples

```bash
# Diagnose the project configuration
rulesync doctor

# Fail CI on warnings too
rulesync doctor --strict

# Machine-readable output for editors and CI
rulesync --json doctor

# Diagnose a configuration file at a custom location
rulesync doctor --config ./configs/rulesync.jsonc
```

### Behavior

- Exits with code `1` when any `error`-severity diagnostic is present (or any `warning` with `--strict`), and `0` otherwise.
- With the global `--json` flag, diagnostics and a severity summary are emitted as structured JSON: in `data` on success (exit 0), and in `error.details` of the standard error document (code `DOCTOR_FAILED`) on failure.
- A missing configuration file is reported as `info` only — rulesync runs fine with built-in defaults.

## Docs Command

The `docs` command prints the bundled Rulesync documentation to standard output, so both humans and coding agents can retrieve it directly in the terminal without browsing the repository or website. The documentation is embedded in the CLI at build time, so it works in installed npm distributions and compiled binaries alike.

Document identifiers follow the `docs/` hierarchy without the `docs/` prefix or the `.md` extension (both are accepted and stripped when supplied). Identifiers that try to escape the bundled tree — absolute paths, drive letters, `..` segments — are rejected.

### Usage

```bash
# List every available document identifier
rulesync docs

# Print a document (top-level or nested)
rulesync docs faq
rulesync docs guide/configuration

# Ranked full-text search across the bundled documentation
rulesync docs --search "global mode"
```

### Search

`--search <text>` builds an in-memory BM25+ index (via MiniSearch) over document paths, titles, headings, and body content, with stronger boosts for titles and headings. Up to 10 results are printed, one per line, as `<document> — <matching context>`. Matching is exact-term; no prefix or fuzzy expansion is applied.

### Behavior

- `rulesync docs` with no argument lists all document identifiers, one per line, sorted.
- A missing document, an invalid identifier, an empty search text, a search with no matches, or combining a document argument with `--search` each exit with code 1 and an explanatory error.
- Document output is printed verbatim, so it can be piped to other tools.
- The global `--json` flag is not supported (the command's output is raw Markdown, not a JSON document) and exits with code 1.

## Release Notes Command

The `release-notes` command prints GitHub release notes for any repository, so you can review what changed in an upstream AI coding tool — or in Rulesync itself — without leaving the terminal. Releases are fetched through the GitHub Releases API and rendered as Markdown on standard output, newest first.

The repository is given as `owner/repo` or a full `https://github.com/owner/repo` URL. Unlike `fetch`, ref (`@`) and path (`:`) suffixes are rejected — use `--tag` to select a single release. Only GitHub is supported; other Git providers have no equivalent Releases API.

### Usage

```bash
# Latest 10 releases (default)
rulesync release-notes dyoshikawa/rulesync

# Most recent N releases
rulesync release-notes dyoshikawa/rulesync --latest 5

# Releases published within a date range (either end may be omitted)
rulesync release-notes dyoshikawa/rulesync --since 2026-01-01 --until 2026-06-30

# A single release by tag name
rulesync release-notes dyoshikawa/rulesync --tag v16.11.0

# Every release between two tags, inclusive
rulesync release-notes dyoshikawa/rulesync --from v16.0.0 --to v16.11.0

# Include prereleases
rulesync release-notes dyoshikawa/rulesync --include-prereleases

# Machine-readable output
rulesync --json release-notes dyoshikawa/rulesync --latest 3
```

### Filtering

The four filtering modes — `--latest`, `--since`/`--until`, `--tag`, and `--from`/`--to` — are mutually exclusive; combining them exits with code 1. With no filter, the latest 10 releases are printed.

| Option                              | Description                                                                                                                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--latest <count>`                  | Print the most recent `<count>` releases. Must be a positive integer.                                                                                                                                                            |
| `--since <date>` / `--until <date>` | Print releases published within the range, both ends inclusive. Either end may be omitted for an open-ended range. Dates are parsed as ISO 8601, e.g. `2026-01-31`; a bare date given to `--until` covers that whole day in UTC. |
| `--tag <tag>`                       | Print a single release by tag name. Named `--tag` rather than `--version` because `--version` is the global flag that prints the Rulesync version.                                                                               |
| `--from <tag>` / `--to <tag>`       | Print every release between two tags, inclusive. Both are required.                                                                                                                                                              |
| `--include-prereleases`             | Include prereleases in the output.                                                                                                                                                                                               |
| `--token <token>`                   | GitHub token for private repositories or higher rate limits.                                                                                                                                                                     |

Tag ranges are resolved by position in the repository's release history, not by parsing semver, so non-semver tag names work and the order of `--from` and `--to` does not matter. A tag that does not appear in the history exits with code 1.

### Authentication

Requests are unauthenticated by default, which is enough for public repositories but subject to GitHub's stricter anonymous rate limit. Set `GITHUB_TOKEN` or `GH_TOKEN` (or pass `--token`) for private repositories and higher limits:

```bash
GITHUB_TOKEN=$(gh auth token) rulesync release-notes owner/private-repo
```

### Behavior

- Draft releases are never printed: they are unpublished and only visible to accounts with write access.
- Prereleases are excluded unless `--include-prereleases` is given, matching how GitHub itself resolves the "latest" release. `--tag` is the exception — an explicitly named tag is printed regardless of its prerelease status.
- A repository with no matching releases prints a warning and exits with code `0`.
- Range queries walk at most 10 API pages (1,000 releases); tags older than that are reported as not found.
- Date ranges scan the whole walked history rather than stopping at the first out-of-range release, because the API orders releases by creation date and a release published from a long-lived branch can appear out of publication order.
- Default output is Markdown on standard output, so it can be piped to other tools. With the global `--json` flag, the releases are emitted as structured `data` instead and no Markdown is printed; failures use the standard error document with code `RELEASE_NOTES_FAILED`.
