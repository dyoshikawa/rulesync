# Global Mode

You can use global mode via Rulesync by enabling `--global` option. It can also be called as user scope mode.

Currently, supports rules generation for Claude Code, GitHub Copilot, and OpenCode. Import for global files is supported for rules and commands. Command generation in global mode remains Claude Code only.

1. Create an any name directory. For example, if you prefer `~/.aiglobal`, run the following command.

   ```bash
   mkdir -p ~/.aiglobal
   ```

2. Initialize files for global files in the directory.

   ```bash
   cd ~/.aiglobal
   rulesync init
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
   rulesync generate
   ```

> [!NOTE]
> Currently, when in the directory enabled global mode:
>
> - `rulesync.jsonc` only supports `global`, `features`, `delete` and `verbose`. `Features` can be set `"rules"` and `"commands"`. Other parameters are ignored.
> - Multiple `root: true` files can target the same tool in project and global modes. Compatible root or single-file outputs are combined in deterministic source-discovery order with a blank line between files; distinct native paths remain separate, and unsafe modular or case-only path collisions fail explicitly.
> - Only Claude Code is supported for global mode commands.
