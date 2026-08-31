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

## JSON Output

The global `--json` flag makes a command print a single result document and nothing else. Because that document is the whole of the output, warnings that would otherwise go to standard error are carried inside it, as a top-level `warnings` array of strings:

```json
{
  "success": true,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "command": "import",
  "version": "x.y.z",
  "warnings": [".factory/settings.local.json is a machine-local overrides file …"],
  "data": { "…": "…" }
}
```

The key is omitted when nothing warned, and `--silent` suppresses warnings there as it does on the console. `warnings` sits beside `data` rather than inside it so a command's own captured keys can never collide with it, and it is reported on the failure document too, where a diagnostic about the input is often what explains the failure.

At most 100 warnings are reported, each truncated to 1,000 characters and 8,000 characters in total; a run that exceeds any of those limits says so in a final entry rather than growing the document without bound.

Because that budget is finite, the array carries the diagnostics a run has no other way to report — not a restatement of what `data` already holds. A command that lists something under a captured key writes the list there and warns only about what the list does not say.

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
>
> Takt's skills are the one target swept by file name rather than by directory
> (its rules, commands, and subagents are swept normally). They are flat files
> sharing a single `.takt/facets/knowledge/` root rather than each getting a
> directory of its own, so what the sweep removes there is a `.md` file directly
> under that root which no `.rulesync/skills/` source produces. The root itself
> and anything nested inside it are left alone. See [Takt](../tools/takt.md).

> **Note on unreadable sources:** This applies to the single-file features —
> `mcp`, `hooks`, `permissions`, and `ignore` — each of which is generated from
> one `.rulesync/` file. When that file exists but cannot be read — malformed
> JSON/JSONC, or content the schema rejects — the problem is reported as an
> error, the feature produces no output, and `generate` exits non-zero, naming
> the affected features. Every other feature in the run still executes first, so
> one bad file does not hide the rest of the errors. Because that feature's
> output could not be regenerated, `--delete` also skips its orphan sweep,
> leaving the previously generated files in place rather than deleting
> configuration the run was unable to rewrite. Under `--watch` the failure is
> reported and the watcher keeps running, so saving a corrected source
> regenerates as usual.
>
> A source file that is simply absent is not an error: that feature just has
> nothing to generate, and the run succeeds — it is still logged, but it does
> not fail the run. Only genuine absence counts; a path that cannot even be
> checked (a permission error, a symlink loop, a symlink whose target is gone)
> is treated as unreadable, not as missing.
>
> The directory-based features handle an unparseable source file differently,
> and not uniformly. `subagents` and `checks` report it as a warning and skip
> that file, because their directories hold free-form Markdown that users also
> keep notes and READMEs in; the rest of the directory still generates and the
> run succeeds. `rules`, `commands`, and `skills` do not: an invalid frontmatter
> there aborts `generate` with that error and a non-zero exit, without the
> per-feature isolation described above.
>
> A source entry that exists but cannot be _read_ is never treated as deleted
> for any of them, warn-and-skip features included: a `.rulesync/` file or
> directory whose symbolic link no longer resolves, or an input root that
> cannot be resolved, stops the run rather than letting `--delete` sweep away
> what it was supposed to generate.

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

Some outputs are files Rulesync merges into rather than owns, because the tool (or you) keeps unrelated settings there: `.amp/settings.json(c)`, `.antigravity/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, `.codex/config.toml`, `.copilot/settings.json`, `.devin/config.json`, `.factory/settings.json`, `.github/copilot/settings.json`, `.grok/config.toml`, `.vibe/config.toml`, `.vscode/settings.json`, `.zcode/config.json`, `.zcode/cli/config.json`, `.zed/settings.json`, `kilo.json(c)`, `opencode.json(c)`, and `reasonix.toml`. These are deliberately **not** added to `.gitignore` by `rulesync gitignore`, so that settings you hand-author in them stay version-controlled.

Because they stay committable, `generate` will not **create** one of them just to hold an empty payload: if Rulesync has nothing to contribute (e.g. no permissions map to that tool), the file is left absent instead of being written as `{}`. A file that already exists is always rewritten as usual, so nothing you authored is dropped. Every other generated file is written even when empty, since for a file Rulesync owns its existence is part of the output.

### Comments in shared JSONC files are preserved

Several of those shared files are JSONC rather than JSON, because the tools themselves put comments in them — VS Code's own "MCP: Add Server" scaffold opens `.vscode/mcp.json` with a comment line. `.vscode/settings.json`, `.vscode/mcp.json`, `.amp/settings.json`, `opencode.json(c)` and `kilo.json(c)` (with their global counterparts) are therefore written back as **edits to the existing text**: only the spans whose values actually changed are rewritten, so your comments, blank lines, and key order survive a regenerate, and a `generate` that computes the same content it wrote last time leaves the file byte-identical.

Rulesync falls back to rewriting the whole document when there is nothing to preserve or nothing to edit against: an empty file, a file whose root is not an object, and a file using `__proto__`, `constructor` or `prototype` as a key (those keys are dropped from every document Rulesync parses, so they are removed rather than left behind). Files in the other formats — JSON, YAML, TOML — are re-serialized as before, so comments in `.codex/config.toml` or `reasonix.toml` are still not retained.

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

| Option                  | Description                                                                                                                                                           | Default                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `--target, -t <target>` | Target format to interpret files as (e.g., 'rulesync', 'claudecode')                                                                                                  | `rulesync`                       |
| `--features <features>` | Comma-separated features to fetch (rules, commands, subagents, skills, ignore, mcp, hooks, permissions, checks)                                                       | `skills`                         |
| `--output <dir>`        | Output directory relative to project root                                                                                                                             | `.rulesync`                      |
| `--conflict <strategy>` | Conflict resolution: `overwrite` or `skip`                                                                                                                            | `overwrite`                      |
| `--no-prune`            | Keep local files inside a fetched skill directory that the remote skill no longer has                                                                                 | Pruning is on                    |
| `--ref <ref>`           | Git ref (branch/tag/commit) to fetch from                                                                                                                             | Default branch                   |
| `--path <path>`         | Subdirectory in the repository                                                                                                                                        | `.` (root)                       |
| `--skills <skills>`     | Comma-separated skill names to fetch (requires the skills feature)                                                                                                    | All skills                       |
| `--interactive, -i`     | Interactively select skills to fetch via a checkbox prompt; nothing is selected initially, press `<a>` to select/deselect all (requires the skills feature and a TTY) | Disabled                         |
| `--token <token>`       | Git provider token for private repositories                                                                                                                           | `GITHUB_TOKEN` or `GH_TOKEN` env |

### Pruning Fetched Skill Directories

A skill is a directory (`skills/<name>/SKILL.md` plus its supporting files), not a single file. When the upstream skill drops or renames a file, an additive fetch would leave the old local copy in place, and the directory would become a mixture of the current upstream files and orphaned leftovers. Agents read whatever is in the directory, so a stale reference or an outdated script keeps steering them long after upstream removed it.

**The remote skill is therefore the source of truth: by default, `fetch` deletes files inside the skill directories it fetched that the remote does not have.** Every deletion is listed in the summary, so the destructive part of the command is never silent:

```text
Fetched from anthropics/skills@main:
  ✓ skills/pdf/SKILL.md (overwritten)
  ✗ skills/pdf/reference.md (deleted - no longer in the remote skill)

Summary: 1 overwritten, 1 deleted
```

Rulesync also warns separately whenever a run deleted anything, so the one part of the command that cannot be undone is not left to be spotted among the rest of the summary.

> [!WARNING]
> Pruning removes **any** file in a fetched skill directory that the remote does not have — including one you added yourself. That is what "mirror the remote" means. Keep your own material outside the skill directories you fetch, or pass `--no-prune`.
>
> This applies to whatever `--output` points at. `--output .` makes the fetched skill directories your project's own `skills/`, so a fetch there prunes the skills you maintain by hand. Fetch into the default `.rulesync/` unless you really mean to mirror a remote repository into your project root.

The scope is deliberately narrow:

- Only the `skills/<name>/` directories fetched in **this** run are pruned. A skill left out by `--skills` or `--interactive` is untouched.
- Other features (`rules/`, `commands/`, `subagents/`, …) are never pruned — the issue only exists for directory-based skills.
- Directories the remote skill no longer has are removed as well, and are listed in the summary under their own name with a trailing slash.
- Symbolic links are unlinked, never followed: a link inside a skill directory can only ever lose the link itself, never whatever it points at. A skill directory that is **itself** a symbolic link is not pruned at all, since deleting through it would reach outside the output directory; Rulesync warns and leaves it alone.
- A local file that the filesystem holds as the same file as one just fetched — a second name for it on a case-insensitive or Unicode-normalizing filesystem, or a hard link — is kept, even though the remote list does not carry that name. The same applies to a symbolic link that resolves to a file or directory this run wrote: it is kept rather than unlinked, since the fetch may have written through it.
- A skill directory Rulesync cannot read or delete from — a permission it does not hold, a disk that gave out — stops that skill's prune where it failed rather than the whole fetch. Rulesync warns, still lists whatever it had already deleted, and moves on to the next skill.
- Nothing more than 15 directories below the skill directory is pruned. That is a limit on the local walk, deep enough that a fetched tree stays well inside it; Rulesync warns and leaves anything deeper alone.
- A skill directory whose name ends in a dot or a space, or whose name has the `NAME~1` shape of a Windows short name, is not pruned. Some systems resolve such a name to a different directory, so the directory that name reads as may not be the directory it opens.
- A skill directory whose name differs from another in `skills/` — one that was already there, or one this same fetch just wrote — only in ways some filesystems ignore — its case, or whether an accented letter is written composed or decomposed — is not pruned either, for the same reason: macOS and Windows resolve `skills/PDF` to an existing `skills/pdf`, and macOS resolves a decomposed name to the composed directory of the same name, so pruning it would judge the local skill's own files stale.
- A skill whose remote listing came back incomplete — GitHub caps a directory listing at 1,000 entries, and entries such as symlinks and submodules cannot be fetched — is not pruned either. Rulesync warns instead, because a local file that upstream still ships cannot be told apart from one it dropped.
- `--conflict skip` disables pruning. That flag says to leave existing local files alone, and it also means the local copies are not this run's output, so they cannot be judged against the remote list.
- `--target <tool>` never prunes, because that conversion path does not fetch skills at all.

Pass `--no-prune` to get the old purely additive behavior.

#### Remote Paths Containing a Backslash or a Colon

A backslash is an ordinary character in a filename on Linux and macOS, and a directory separator on Windows. A colon is ordinary too here, and on Windows it separates a file from one of its alternate data streams, so `skills/pdf::$INDEX_ALLOCATION` is another way of writing `skills/pdf` rather than a directory of its own. A remote file whose path contains either character therefore names one file on some systems and something else on others, so `fetch` skips it and warns rather than picking an interpretation. The rest of the fetch continues normally.

Because the skipped file is still part of the remote skill, the skill directory it came from is not pruned in that run either — a local copy of a file the remote still ships would otherwise be indistinguishable from one it dropped.

#### Skill Names That Look Alike

A repository can publish two skill directories whose names a terminal draws the same way — `skill` spelled with a Cyrillic `ѕ`, or the fullwidth `ｓｋｉｌｌ` beside the plain one. Each is still a separate entry with its own name, so a selection writes exactly the directories that were checked; the risk is only that an entry cannot be told apart by sight from what it appears to be — another entry, a skill you already have, or the plainer, shorter name its own row reads as.

The interactive prompt therefore prefixes such an entry with `[!]` and the reason, ahead of the name itself:

```text
? Select skills to fetch (press <a> to select/deselect all)
 ◯ pdf
 ◯ [!] another entry differs from it only by lookalike letters — skill
 ◯ [!] another entry differs from it only by lookalike letters; mi… — ѕkill
```

The mark comes first so that a name — which the remote repository chooses — cannot be spelled to look like a mark of its own, or reorder one away. A label wider than one line is shortened with an ellipsis for the same reason; the budget is measured in terminal columns, so a name of ideographic spaces cannot buy extra width by being few characters, and it is taken from the terminal the prompt is drawn in — the window's own width, less the five columns the pointer and the checkbox can take between them, and never more than 72 — so a pane split in half shortens the labels along with it. A terminal that does not say how wide it is counts as 80 columns, the width the prompt falls back to when it wraps the rows, and no terminal shortens a label below 16: past that a row would be an ellipsis and little else, and rows that cannot be told apart at all are worse than a row that wraps. The name is measured first and the reasons take the room that is left, which is why the second label above is cut: a cut takes the reasons from the tail, and the mark and the start of the first reason always survive. Two entries whose labels read alike are numbered — `(1) `, `(2) `, in front for the same reason the mark is — so they stay distinct. That covers labels shortened into the same text, and equally `git` beside `ɡit`, where both rows carry the same note and the names are one shape: the numbers do not say which row is which, but they do say there are two of them, and the value behind a label is untouched, so a shortened entry still selects the skill it names. A name that itself begins the way a marked row does is given a mark of its own saying so — judged by the shape it is drawn in rather than the characters it is spelled with, so `(l)` and a `[ǃ]` written with U+01C3 LATIN LETTER RETROFLEX CLICK are marked alongside the plain `(1)` and `[!]`.

An entry is marked for any of five reasons:

- **Another entry has the same display form.** Names are compared with their hidden characters removed, normalized (NFKC), their whitespace collapsed, and lowercased, so `Skill`, `skill`, `skill ` and the fullwidth `ｓｋｉｌｌ` all collide.
- **Another entry differs from it only by lookalike letters.** Two names that read the same once each character is replaced by the Latin letter it is drawn as — `copy` beside the same word spelled entirely in Cyrillic. A name does not have to leave the Latin alphabet to qualify: `c0py` with a zero, `ruIes` with a capital I for the l, `Ⅰist` with the Roman numeral one, and `git` with the script `ɡ` or the dotless `ı` are all marked against the plain spelling. Two letters drawn as one count as well — `forrnat` for `format`, `revievv` for `review` — which no table of single characters can see. `cl` for `d` is left out of that short list on purpose: it opens too many ordinary words, and folding it would report `clone` against a `done` you happen to have. The separator counts too, since nearly every skill name is kebab-case and a name that swaps only its hyphen for U+2010 HYPHEN — drawn identically, belonging to no script, and left alone by the compatibility normalization — would otherwise pass every check as plain ASCII. Neither name mixes scripts on its own, so this pair is visible only by comparing the two.
- **The name carries more whitespace than the row shows.** A run of whitespace is drawn as one gap however long it is, and whitespace at either end of a name is drawn as nothing at all, so `pdf ` and `pdf  reader` reach past what can be seen of them. Both halves of a pair like `pdf` and `pdf ` are already marked as sharing a display form; this reason is what marks the padded name when it is alone on the list. A single blank inside a name that is merely not the plain space — a no-break space, an ideographic space — is not marked here: it is drawn, and the plain name it imitates is reported as the pair it makes under the first reason above, so an ordinary `設定 ガイド` written with the ideographic space is left alone. At either end it is marked like any other blank, since there the question is not which character was chosen but that the name reaches past where it appears to end.
- **The name reads as Latin letters but is written in another script.** Every letter of it is drawn as a Latin one without being Latin, which is the whole-script confusable of UTS #39: `copy` spelled with four Cyrillic letters is marked even when no Latin `copy` is on the list. This check uses the narrower list of letters that are drawn as a _lowercase_ Latin letter while being lowercase themselves, so an ordinary Russian or Greek word — `текст`, `κατα` — is not marked: its letters are ones whose capitals resemble Latin capitals, which is not the same thing. Cherokee, Coptic, Lisu, Osage, Deseret and Tifinagh are taken whole instead of letter by letter — a name written in nothing but one of them is marked — since those alphabets are drawn in Latin letter shapes throughout. Canadian Aboriginal Syllabics and Vai are not: their letters are shapes of their own, so a name in either reads as nothing Latin, and only a mixture with Latin is marked.
- **The name mixes scripts.** A single name built from scripts that share letter shapes, such as `good` with a Cyrillic `о`. The alphabets treated as lookalikes are Latin, Cyrillic, Greek, Armenian, Cherokee, Coptic, Lisu, Canadian Aboriginal Syllabics, Osage, Deseret, Vai and Tifinagh, which are among the ones UTS #39 records as confusable with each other. Japanese, Korean and Chinese names mix scripts by nature and routinely carry Latin, so those combinations are not marked, and neither is Latin beside a script that shares no shapes with it.

The first two reasons are asked of the skills already in the output directory as well as of the other entries, and say `a local skill` in place of `another entry` when that is where the twin is. Without that comparison a repository publishing only the imitation — `dep1oy` against a `deploy` you have had for months — is a single plain-ASCII name in one script with nothing on the list to compare it against, and every check stays quiet. A local skill that names the directory an entry would be written into is the skill that entry would refresh rather than one imitating it, so it is not a collision and is not marked; a second fetch of the same repository is therefore as quiet as the first. Where the two spellings differ only in case, or only in how the name is composed in Unicode, whether they name one directory is the filesystem's answer rather than the listing's — macOS and Windows resolve `skills/PDF` to an existing `skills/pdf`, Linux does not — so Rulesync asks it, and marks the pair only where they really are two directories — and only where the two also read alike, so that a local skill a _second_ entry imitates keeps its place in the comparison while the first entry refreshes it. A fullwidth `ｐｄｆ` is a second directory everywhere and is always marked. Where both another entry and a local skill collide with a name, the entry is the one named, since that is the pair you can compare on screen.

A `fetch` that shows no prompt — a plain one, or one selecting with `--skills` — prints the same reasons as a warning listing the names they apply to, so a scripted run is told what an interactive one would have been shown. The names are judged against everything the repository publishes and everything already in the output directory, as the prompt judges them, and listed for what the run actually writes: `--skills c0py` is told that the name reads like another entry even though the `copy` that makes it so was never fetched.

The mark is display-only: it never removes a skill from the list. It is also not a complete answer — the table of lookalike letters holds the common pairs rather than every one, and a name written entirely in a script the table does not map is compared against nothing — so treat it as a hint to look closer, not as a guarantee that unmarked entries are distinct.

Names that cannot be shown honestly at all are a separate case: a skill directory whose name carries a control character, one that draws as nothing — a zero-width space, a Hangul filler, a braille blank — or one that draws as nothing but blank space or combining marks with no letter to sit on is dropped rather than marked, with a warning naming it in stripped form. That drop applies to every `fetch`, including a plain one with neither `--skills` nor `--interactive`, because such a directory on disk cannot be told from the plain name it imitates in any line Rulesync prints.

A zero-width joiner or a variation selector is dropped only where it hides something. It is kept beside the scripts that are written with one — the Arabic family, the Indic scripts, Mongolian — and beside the pictographs an emoji sequence is built from; anywhere else it can be nothing but padding, so `pdf` with a joiner in it is dropped, and so is `設定` with one between its two characters. Standing where its own script puts it — a Persian or Indic name written with a zero-width non-joiner, an emoji name built from a chain of joiners — it is left alone and the name is fetched normally. A joiner is held to both of its neighbors, since it exists to bind two characters: a name that merely ends in one is a second directory drawn exactly like the name beside it, and is dropped. A variation selector is held only to the character before it, which is the one whose form it selects, so an emoji name may end in one. The keycap sequences — `1️⃣`, `#️⃣`, `*️⃣`, spelled as UTS #51 spells them: one of `0`–`9`, `#` or `*`, then U+FE0F, then U+20E3 — are matched whole, since what they are built on is a digit or an ASCII sign rather than a pictograph. Only the whole sequence is kept: a digit followed by a variation selector with no enclosing keycap behind it is padding still, and is dropped still.

#### Remote Paths in Rulesync's Output

Path names come from the remote repository, so every one that Rulesync prints — the fetch summary, warnings, and debug lines — has its control characters stripped first. A crafted path cannot forge or erase the lines around it, which is what makes the record of what was written and deleted worth reading.

The `--json` output is the exception: it carries each path exactly as the repository spells it, because a machine consumer needs the real name to act on it. Anything that renders a value out of that JSON into a terminal has to strip it itself.

### Examples

```bash
# Fetch skills from external repositories
rulesync fetch vercel-labs/agent-skills
rulesync fetch anthropics/skills

# Fetch only specific skills by name
rulesync fetch anthropics/skills --skills pdf,docx

# Interactively select which skills to fetch (checkbox prompt)
# Nothing is checked when the prompt opens: press <space> to select the
# highlighted skill, <a> to select/deselect all, <i> to invert, and <enter> to confirm.
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

# Keep local files a fetched skill no longer has upstream
rulesync fetch anthropics/skills --no-prune

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
