## Global Mode

You can use global mode via Rulesync by enabling `--global` option. It can also be called as user scope mode.

Currently, supports rules and commands generation for Claude Code. Import for global files is supported for rules and commands.

1. Create an any name directory. For example, if you prefer `~/.aiglobal`, run the following command.
   ```bash
   mkdir -p ~/.aiglobal
   ```
2. Initialize files for global files in the directory.
   ```bash
   cd ~/.aiglobal
   npx rulesync init
   ```
3. Edit `~/.aiglobal/rulesync.jsonc` to enable global mode.
   ```jsonc
   {
     "global": true,
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
   npx rulesync generate
   ```

> [!NOTE]
> Currently, when in the directory enabled global mode:
>
> - `rulesync.jsonc` only supports `global`, `features`, `delete` and `verbose`. `Features` can be set `"rules"` and `"commands"`. Other parameters are ignored.
> - `rules/*.md` only supports single file has `root: true`, and frontmatter parameters without `root` are ignored.
> - Only Claude Code is supported for global mode commands.
