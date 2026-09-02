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

## Available Skills

| Skill          | What it covers                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `rulesync`     | The Rulesync CLI: the init → write → generate workflow, and where to look things up with `rulesync docs`.         |
| `rulesync-mcp` | The [Rulesync MCP server](../reference/mcp-server.md): its single `rulesyncTool`, and how to call each operation. |

Fetching without `--skills` or `--interactive` installs all of them.

Re-fetching mirrors the remote skill: a file the upstream skill no longer ships is deleted from the local skill directory, and every deletion is listed in the fetch summary. Pass `--no-prune` to keep such files. See [Pruning Fetched Skill Directories](../reference/cli-commands.md#pruning-fetched-skill-directories).
