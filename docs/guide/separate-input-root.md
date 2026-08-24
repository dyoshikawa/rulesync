# Separate Input Root

The `--input-roots <paths...>` flag lets you point `rulesync generate` at one or more rulesync source directories other than the current working directory. This decouples where your rule definitions live from where the generated tool configuration files are written.

Each entry in `--input-roots` is a **rulesync source tree** — the directory that directly contains `rules/`, `skills/`, `mcp.jsonc`, and the other rulesync source files. The path you pass is read exactly as given: `--input-roots ~/.aiglobal/.rulesync` reads rules from `~/.aiglobal/.rulesync/rules/`, skills from `~/.aiglobal/.rulesync/skills/`, and so on.

When you pass more than one entry, Rulesync reads all of them and merges the result. The typical reason to do this is to layer a personal or per-machine override tree on top of a shared team tree — see [Combining multiple source trees](#combining-multiple-source-trees) below.

> **Currently supported on `generate` only.** At present, `--input-roots`/`--input-root` are wired into the `rulesync generate` command only. Other commands (`import`, `convert`, `gitignore`, `install`, `fetch`, `init`) still read `.rulesync/` from the current working directory. To use the same source directory with those commands, `cd` into the source-tree's parent directory first.

## Primary use case: centralized rules across all repos

A common workflow is to keep a single set of AI rules in a shared source tree (e.g. `~/.aiglobal/.rulesync/`) and apply them to every project without switching directories:

```bash
# In any project directory — rules are read from ~/.aiglobal/.rulesync/
rulesync generate --input-roots ~/.aiglobal/.rulesync --targets "*" --features rules
```

Without `--input-roots`, you would have to `cd ~/.aiglobal && rulesync generate` and then `cd -` back, and the output files would land in `~/.aiglobal` instead of the current project.

## Step-by-step setup

1. Create and initialize a shared rules directory:

   ```bash
   mkdir -p ~/.aiglobal
   cd ~/.aiglobal
   rulesync init
   ```

2. Edit your shared rules (`~/.aiglobal/.rulesync/rules/overview.md`, etc.) to your preferences.

3. From any project, generate configurations using the shared rules:

   ```bash
   # In your project directory
   rulesync generate --input-roots ~/.aiglobal/.rulesync --targets claudecode --features rules
   ```

## Combining multiple source trees

The most common reason to pass more than one entry to `--input-roots` is **per-developer local overrides**: check a shared `.rulesync/` tree into version control and let each developer keep an optional untracked `.rulesync.local/` tree next to it for their own tweaks.

`rulesync gitignore` adds `.rulesync.local/` to the generated ignore list, so an overlay tree with that
conventional name stays untracked without any extra setup. Any other name is not recognized, so if you
call your overlay something else (for example `.rulesync.dev/`), add it to `.gitignore` yourself — an
overlay tree can hold personal MCP credentials and permission settings that must not be committed.

```bash
rulesync generate --input-roots ./.rulesync ./.rulesync.local --targets "*" --features rules,mcp
```

With this invocation, Rulesync reads both trees and merges them: files that only exist in `./.rulesync` are used as-is, and any file `./.rulesync.local` also provides replaces the shared version. For example, if a developer creates `./.rulesync.local/rules/coding-style.md`, it replaces `./.rulesync/rules/coding-style.md` only on that developer's machine.

The same mechanism works for other layouts — for example, a globally shared base plus a per-repo overlay:

```bash
rulesync generate --input-roots ~/.aiglobal/.rulesync ./.rulesync --targets "*" --features rules,mcp
```

### Merge rules per feature

The general rule is: later entries win. Each feature refines that rule slightly:

- **Rules, commands, subagents, checks, skills** — merged file-by-file (case-insensitive). Files present only in an earlier tree are kept; a file that also exists in a later tree replaces the earlier version. A skill directory is replaced as a single unit (all of its companion files together). Differently cased names that collapse to the same identity produce a warning instead of being dropped silently; the comparison also normalizes Unicode (NFC), so the composed and decomposed spellings of an accented name — one file on macOS — are treated as the same entry.
- **MCP** — merged one level into the JSON: the top-level `mcpServers` map and each `<toolname>.mcpServers` map are merged by server name (later wins per key). An individual server config is replaced as a whole; patching just its `args` or `env` is not supported.
- **Hooks, permissions, ignore** — the last tree that provides the file wins the whole file. There is no line-level merge. When more than one tree provides the file, Rulesync warns which tree won and which ones it replaced, so the dropped content is easy to trace — these files decide what an agent may read and run, so a silent whole-file replacement would be easy to miss.

Root order is the primary precedence rule. Within a single source tree, a rule or skill outside `.curated/` takes precedence over a same-named curated artifact. That comparison is case-insensitive for the same reason the cross-root merge is — the two names are one file on macOS and Windows — so a curated `shared.md` is skipped even when the local file is spelled `Shared.md`. A case-only match is reported as a warning, because on a case-sensitive filesystem the two are genuinely distinct files. After that per-tree choice is made, a later input root replaces an earlier root's effective artifact even when the later artifact is curated.

The first source tree is the required base and must exist, though it may be empty. Later source trees are optional overlays: a missing overlay contributes nothing, and `--watch` starts reading it if the directory is created while Rulesync is running. This lets teams commit `inputRoots: ["./.rulesync", "./.rulesync.local"]` without requiring every developer to create `.rulesync.local/`. An existing overlay may also supply just one feature — for example, only `mcp.jsonc`.

## Setting input roots in `rulesync.jsonc`

You can set the same value in `rulesync.jsonc` (or `rulesync.local.jsonc`) instead of passing it on the command line:

```jsonc
{
  "inputRoots": ["./.rulesync", "./.rulesync.local"],
}
```

## Deprecated `--input-root` (singular)

An older, singular `--input-root` / `inputRoot` option is still accepted for backward compatibility, but new configurations should use the plural form. If you pass it, Rulesync treats the value as the **parent** of a default `.rulesync/` directory:

```bash
# These two commands are equivalent:
rulesync generate --input-root ~/.aiglobal
rulesync generate --input-roots ~/.aiglobal/.rulesync
```

The singular and plural flags cannot be combined in the same CLI invocation, and they cannot both be set in the same config file. If one config file uses the singular form and another uses the plural form, the plural form wins.

## Comparison with `--global`

These two flags serve different but complementary purposes:

|              | `--input-roots`                                                                  | `--global`                                                             |
| ------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Changes**  | Source location (which rulesync source tree(s) files are read from)              | Output location (writes to user-scope config paths, e.g. `~/.claude/`) |
| **Use when** | Your rule definitions live in a non-CWD directory, or you overlay multiple trees | You want the output to go to the tool's global (user-scope) config     |

They can be combined. For example, to read rules from `~/.aiglobal/.rulesync` and write them to Claude Code's global settings:

```bash
rulesync generate --input-roots ~/.aiglobal/.rulesync --global --targets claudecode --features rules
```

> **`--input-roots` does not enable `--global`.** When any input root is explicitly provided, Rulesync reads source files from those trees, but output scope still follows the CLI flags: use `--global` for user-scope output, and omit it for project-scope output. A `"global": true` setting in the `rulesync.jsonc` under an explicit input root is **not** applied unless you also pass `--global`, and Rulesync will emit a warning when dropping it so the override is visible.

## Symlinks and trust

Rulesync follows symbolic links during file discovery. A symlink inside a source tree that points outside it will be followed transparently, and the resolved file content will be copied into the generated output. This is intentional: it lets you centralize shared skills or rules in one place and reference them via symlinks from multiple project directories without duplication.

The trust boundary is the source tree you point Rulesync at. `--input-roots` entries are `resolve()`-ed to absolute paths before use, but there is no `realpath`-based boundary check on individual symlinks inside them. Only run Rulesync against trees you control. The narrowing is inside skill directories, whose companion files include hidden entries: a hidden entry that a link resolves to outside the skill directory is not carried and is named in a warning, and the entries a skill never carries — credential stores, build trees, `.git` — are refused by the path they resolve to, so renaming a link does not smuggle them in, as is a link resolving into a system pseudo-filesystem (`/proc`, `/sys`, `/dev`). Directory symlink cycles are handled safely — glob-based discovery results are deduplicated by the real file they resolve to, so a cycle does not produce duplicated output, while a skill directory is walked directly and keeps every entry that walk reaches. See the [File Formats § Symlinks](../reference/file-formats.md#symlinks) note for the behavior that applies across all features.
