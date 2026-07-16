# FAQ

## The generated `.mcp.json` doesn't work properly in Claude Code

You can try adding the following to `.claude/settings.json` or `.claude/settings.local.json`:

```diff
{
+ "enableAllProjectMcpServers": true
}
```

According to [the documentation](https://code.claude.com/docs/en/settings), this means:

> Automatically approve all MCP servers defined in project .mcp.json files

## Google Antigravity doesn't load rules when `.agents` directories are in `.gitignore`

Google Antigravity has a known limitation where it won't load rules, workflows, and skills if the `.agents/rules/`, `.agents/workflows/`, and `.agents/skills/` directories are listed in `.gitignore`, even with "Agent Gitignore Access" enabled.

> **Note:** Antigravity 2.0 uses the plural `.agents/` directory by default (the `antigravity-ide` and `antigravity-cli` targets).

**Workaround:** Instead of adding these directories to `.gitignore`, add them to `.git/info/exclude`:

```bash
# Remove from .gitignore (if present)
# **/.agents/rules/
# **/.agents/workflows/
# **/.agents/skills/

# Add to .git/info/exclude
echo "**/.agents/rules/" >> .git/info/exclude
echo "**/.agents/workflows/" >> .git/info/exclude
echo "**/.agents/skills/" >> .git/info/exclude
```

`.git/info/exclude` works like `.gitignore` but is local-only, so it won't affect Antigravity's ability to load the rules while still excluding these directories from Git.

Note: `.git/info/exclude` can't be shared with your team since it's not committed to the repository.

## Codex CLI denies SSH agent access, temp-dir writes, or reading its own config with a generated permissions profile

The `[permissions.rulesync]` profile that rulesync generates into `.codex/config.toml` extends Codex CLI's `:workspace` baseline. That baseline is deliberately conservative, so day-to-day development can still hit permission denials: `git push`/`git fetch` over SSH cannot reach the SSH agent socket, some build tools fail without a writable temp dir, and Codex may be blocked from reading its own `~/.codex` configuration.

rulesync emits the `.git` write carve-outs for you (`".git/**" = "write"` with `".git/config" = "read"` under `:workspace_roots`; opt out with the `codexcli.git_write_rules: false` override). Everything below, however, depends on your environment or workflow, so rulesync does not add it by default. Where to put each piece differs, because the two tables are managed differently:

**Network settings: edit `.codex/config.toml` directly.** Network settings are out of rulesync's management scope by design, keeping you free to edit them. rulesync preserves user-authored network keys when it regenerates the file — `network.enabled` (as long as the profile carries no rulesync-managed allow domains) and unknown keys such as `dangerously_allow_all_unix_sockets` are carried forward verbatim, with a warning so they stay visible:

```toml
[permissions.rulesync.network]
enabled = true
# Simplest option: allow all unix sockets. Codex names this "dangerously_*"
# because it is broad, but it avoids hardcoding an env-dependent socket path.
dangerously_allow_all_unix_sockets = true

# Stricter alternative: allow only the SSH agent socket.
# Replace the path with the actual value of $SSH_AUTH_SOCK on your machine;
# Codex does not expand environment variables in these keys.
# [permissions.rulesync.network.unix_sockets]
# "/path/to/ssh-agent.sock" = "allow"
```

**Filesystem entries: author them in `.rulesync/permissions.json`, not in `config.toml`.** The profile's `filesystem` table is fully managed — hand-written entries there are replaced on the next `rulesync generate`. Add the rules to the canonical config instead (use the tool-scoped `codexcli.permission` block so they do not leak into other tools' outputs) and regenerate:

```jsonc
{
  "permission": {
    // ...your shared rules...
  },
  "codexcli": {
    "permission": {
      "write": { ":tmpdir": "allow", ":slash_tmp": "allow" },
      "read": { "~/.codex/**": "allow", "~/.codex/auth.json": "deny" },
    },
  },
}
```

This generates into the profile as `":tmpdir" = "write"`, `":slash_tmp" = "write"`, `"~/.codex/**" = "read"`, and `"~/.codex/auth.json" = "deny"`, and round-trips through `rulesync import`. Note that a tool-scoped category replaces the shared one wholesale for Codex CLI: if your shared `permission` block already has `read`/`write` rules that should also apply to Codex CLI, repeat them inside `codexcli.permission`.

What each entry does:

- **Unix socket access**: `git push`/`git fetch` over SSH needs the agent socket. `dangerously_allow_all_unix_sockets = true` is the simple, environment-independent option; a per-socket `unix_sockets` allow entry with the resolved `$SSH_AUTH_SOCK` path is the stricter one.
- **`:tmpdir` / `:slash_tmp` write**: many build tools require a writable temp directory (`$TMPDIR` and `/tmp` respectively).
- **`~/.codex/**` read with `auth.json` deny**: Codex can read its own configuration tree while your credentials stay protected. Tilde paths are expanded by Codex itself, so no manual `$HOME` resolution is needed.
- **`glob_scan_max_depth`**: no need to add it — rulesync emits the Codex default (`8`) automatically whenever the generated workspace-root rules contain unbounded `**` patterns (the default `.git/**` carve-out already is one).

See the [Codex permissions reference](https://developers.openai.com/codex/permissions) for the full path and network syntax.

## Generated rule files create noise in pull request diffs

Because many AI coding tools (Claude Code, Cursor, Copilot, Antigravity, etc.) need to read their rule files directly from the working tree, the files rulesync generates are intentionally not `.gitignore`d. On repositories with many targets, the generated files can dominate a pull request diff and make code review harder.

**Workaround:** Add the generated paths to `.gitattributes` with the [`linguist-generated`](https://docs.github.com/en/repositories/working-with-files/managing-files/customizing-how-changed-files-appear-on-github#marking-files-as-generated) attribute. GitHub's PR UI will then collapse those files by default while still keeping them visible and loadable by the tools themselves.

Example `.gitattributes` for a repo that uses `.agent/`, Claude Code, Cursor, and Copilot targets:

```
.agent/rules/**           linguist-generated
.agent/skills/**          linguist-generated
.agent/workflows/**       linguist-generated
CLAUDE.md                 linguist-generated
.cursor/rules/**          linguist-generated
.github/copilot-instructions.md linguist-generated
```

Adjust the list to match the targets you have configured. These entries only affect how GitHub displays the files in diffs — they don't change how Git tracks them, and they don't interfere with the tools reading the rules.
