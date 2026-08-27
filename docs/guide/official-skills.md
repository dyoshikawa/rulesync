# Official Skills

Rulesync provides official skills that you can install using the fetch command or declarative sources:

```bash
# One-time fetch
rulesync fetch dyoshikawa/rulesync

# Fetch only specific skills, or pick them interactively
# The interactive prompt starts with nothing selected; press <a> to select/deselect all.
rulesync fetch dyoshikawa/rulesync --skills rulesync
rulesync fetch dyoshikawa/rulesync --interactive

# Or declare in rulesync.jsonc and run 'rulesync install'
```

This will install the Rulesync documentation skill to your project.

Re-fetching mirrors the remote skill: a file the upstream skill no longer ships is deleted from the local skill directory, and every deletion is listed in the fetch summary. Pass `--no-prune` to keep such files. See [Pruning Fetched Skill Directories](../reference/cli-commands.md#pruning-fetched-skill-directories).
