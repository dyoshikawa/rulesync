# Separate Input Root

The `--input-root <path>` flag lets you point `rulesync generate` at a `.rulesync/` source directory that is different from the current working directory. This decouples where your rule definitions live from where the generated tool configuration files are written.

## Primary use case: centralized rules across all repos

A common workflow is to keep a single set of AI rules in a shared directory (e.g. `~/.aiglobal`) and apply them to every project without switching directories:

```bash
# In any project directory — rules are read from ~/.aiglobal/.rulesync/
rulesync generate --input-root ~/.aiglobal --targets "*" --features rules
```

Without `--input-root`, you would have to `cd ~/.aiglobal && rulesync generate` and then `cd -` back, and the output files would land in `~/.aiglobal` instead of the current project.

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
   rulesync generate --input-root ~/.aiglobal --targets claudecode --features rules
   ```

4. (Optional) Add `--input-root ~/.aiglobal` to a shell alias or your project's Makefile/taskfile so you do not need to type it every time.

## Comparison with `--global`

These two flags serve different but complementary purposes:

|              | `--input-root`                                    | `--global`                                                             |
| ------------ | ------------------------------------------------- | ---------------------------------------------------------------------- |
| **Changes**  | Source location (where `.rulesync/` is read from) | Output location (writes to user-scope config paths, e.g. `~/.claude/`) |
| **Use when** | Your rule definitions live in a non-CWD directory | You want the output to go to the tool's global (user-scope) config     |

They can be combined. For example, to read rules from `~/.aiglobal` and write them to Claude Code's global settings:

```bash
rulesync generate --input-root ~/.aiglobal --global --targets claudecode --features rules
```

> **`--input-root` does not enable `--global`:**
> When `--input-root` is explicitly provided, Rulesync reads `.rulesync/` from that directory, but output scope still follows the CLI flags: use `--global` for user-scope output, and omit it for project-scope output. A `"global": true` setting in the `rulesync.jsonc` under `--input-root` is **not** applied unless you also pass `--global`, and Rulesync will emit a warning when dropping it so the override is visible.
