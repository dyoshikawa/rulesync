# Global Mode

You can use global mode via Rulesync by enabling `--global` option. It can also be called as user scope mode.

In global mode, Rulesync reads the sources in the current directory (or the configured input roots) and writes the generated files under your home directory (for example `~/.claude/CLAUDE.md`, `~/.claude/skills/`, `~/.codex/AGENTS.md`, `~/.agents/skills/`) instead of the project.

Every feature can be generated and imported in global mode — `rules`, `ignore`, `mcp`, `commands`, `subagents`, `skills`, `hooks`, `permissions`, and `checks` — for each tool that has a user-scope location for it. Which tool supports which feature globally is marked with 🌏 in the [Supported Tools](../reference/supported-tools.md) table. A target or feature without global support is skipped with a warning.

1. Create an any name directory. For example, if you prefer `~/.aiglobal`, run the following command.

   ```bash
   mkdir -p ~/.aiglobal
   ```

2. Initialize files for global files in the directory.

   ```bash
   cd ~/.aiglobal
   rulesync init
   ```

3. Edit `~/.aiglobal/rulesync.jsonc` to enable global mode, and choose the targets and features to generate.

   ```jsonc
   {
     "global": true,
     "targets": ["claudecode", "codexcli"],
     "features": ["rules", "skills"],
   }
   ```

4. Edit `~/.aiglobal/.rulesync/rules/overview.md` to your preferences.

   ```md
   ---
   root: true
   ---

   # The Project Overview

   ...
   ```

5. Generate rules for global settings.

   ```bash
   # Run in the `~/.aiglobal` directory
   rulesync generate
   ```

> [!NOTE]
> Currently, when in the directory enabled global mode:
>
> - `rulesync.jsonc` is read the same way as in project mode: `targets`, `features`, `delete`, `sources`, `verbose`, and the other keys all apply. The exceptions are `outputRoots`, which is replaced by your home directory (or by a tool home override such as `HERMES_HOME`; see [CLI Commands](../reference/cli-commands.md#tool-home-overrides-win-over-the-output-root-in-global-scope)), and the `simulateCommands` / `simulateSubagents` / `simulateSkills` options, which have no effect because simulated features are project-mode only. An explicit `inputRoot` / `inputRoots` in the configuration file also turns off `"global": true` from that file (pass `--global` to keep it); see [Separate Input Root](./separate-input-root.md).
> - Multiple `root: true` files can target the same tool in project and global modes. Compatible root or plain-Markdown single-file outputs are combined with a blank line between files. Local rules are composed first in lexicographic source file path order, followed by non-overridden `.curated/` rules in lexicographic order, so filename prefixes control composition order within each set. Distinct native paths remain separate. Explicitly supported plain-Markdown modular path collisions are combined (fragments whose generated output carries its own frontmatter block stay separate), unsafe collisions involving a source root rule fail, and other exact or case-insensitive modular collisions warn that the last write wins wherever their paths collide.

## Installing skills from external sources

[Declarative sources](./declarative-sources.md) work in global mode too. Declare them in the global directory's `rulesync.jsonc`, run `rulesync install` there to fetch them into `.rulesync/skills/.curated/` (and `.rulesync/rules/.curated/` for rules), and `rulesync generate` writes them to the user-scope skill directories of every selected target:

```jsonc
// ~/.aiglobal/rulesync.jsonc
{
  "global": true,
  "targets": ["claudecode", "codexcli"],
  "features": ["rules", "skills"],
  "delete": false,
  "sources": [{ "source": "anthropics/skills", "skills": ["skill-creator"] }],
}
```

```bash
cd ~/.aiglobal
rulesync install && rulesync generate
# -> ~/.claude/skills/skill-creator/ and ~/.agents/skills/skill-creator/
```

## `delete` and shared user-scope directories

User-scope directories such as `~/.claude/skills/` and `~/.agents/skills/` are often shared with skills you installed by hand or with other tools (plugin managers, other skill installers). Keep that in mind before enabling `delete` in global mode:

- With `"delete": true` (or `--delete`), the orphan sweep removes **every** skill directory directly under a selected target's skills directory that this run did not generate — Rulesync cannot tell a skill installed by another tool from a stale one it generated earlier. This is the case for `claudecode` (`~/.claude/skills/`), `codexcli` and `agentsskills` (`~/.agents/skills/`), and most other targets; only a few targets whose skills directory also holds another feature's output narrow the sweep to the entries they own. For example, a skill another installer placed in `~/.agents/skills/` is deleted when `codexcli` (or `agentsskills`) is a target and no `.rulesync/skills/` source produces it.
- Symbolic links and hidden entries (names starting with `.`) directly under the skills directory are never swept, and a skills directory that is itself a symbolic link (for example, one linked from a dotfiles checkout) is skipped with a warning.
- With `"delete": false` (the default), Rulesync only writes the skills it generates and leaves everything else in those directories alone, so it can coexist with other installers. Stale skills generated earlier then have to be removed by hand.
