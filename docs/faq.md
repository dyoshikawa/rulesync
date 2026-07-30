# FAQ

## `rulesync generate` doesn't produce what I expect

Run `rulesync doctor` first. It performs read-only diagnostics on `rulesync.jsonc` and `rulesync.local.jsonc` and reports problems the generator silently tolerates — most importantly misspelled or unknown configuration keys (the config schema is non-strict, so a typo like `"target"` instead of `"targets"` is otherwise ignored and generation quietly falls back to defaults). See the [Doctor Command](./reference/cli-commands.md#doctor-command) reference for the full list of checks.

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

rulesync emits the `.git` write carve-out for you (`".git/**" = "write"` under `:workspace_roots`; opt out with the `codexcli.git_write_rules: false` override). The whole subtree — including `.git/config` — is writable, because everyday commands such as `git remote add`, `git push -u`, and local-scope `git config` write to the repository config; users who want stricter isolation can add their own `read` override (e.g. `read: { ".git/config": "allow" }`) in the canonical permissions. Everything below, however, depends on your environment or workflow, so rulesync does not add it by default. Where to put each piece differs, because the two tables are managed differently:

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

**Filesystem entries: author them in `.rulesync/permissions.jsonc`, not in `config.toml`.** The profile's `filesystem` table is fully managed — hand-written entries there are replaced on the next `rulesync generate`. Add the rules to the canonical config instead (use the tool-scoped `codexcli.permission` block so they do not leak into other tools' outputs) and regenerate:

```jsonc
{
  "permission": {
    // ...your shared rules...
  },
  "codexcli": {
    "permission": {
      "write": {
        ".": "allow",
        ".git/**": "allow",
        ".agents/**": "allow",
        ".codex/**": "allow",
        ":root": "allow",
        ":minimal": "allow",
        ":tmpdir": "allow",
        ":slash_tmp": "allow",
      },
      "read": { "~/.codex/**": "allow", "~/.codex/auth.json": "deny" },
    },
  },
}
```

Note that this example is intentionally permissive: the `":root"` + `":minimal"` write pair grants the sandbox full disk write access — see the trade-off in the entry list below for narrower alternatives.

This generates into the profile as `"." = "write"`, `".git/**" = "write"`, `".agents/**" = "write"`, and `".codex/**" = "write"` under `:workspace_roots`, plus `":root" = "write"`, `":minimal" = "write"`, `":tmpdir" = "write"`, `":slash_tmp" = "write"`, `"~/.codex/**" = "read"`, and `"~/.codex/auth.json" = "deny"`, and round-trips through `rulesync import` — with two exceptions. First, `".git/**" = "write"` matches rulesync's default carve-out exactly, so import skips it (it is re-added on every generate); if you later opt out with `codexcli.git_write_rules: false` after an import, re-author the `".git/**": "allow"` write rule in the canonical config. Second, `":minimal"` is never imported regardless of its value — rulesync treats it as its fixed `"read"` baseline — so after an import, re-author the `":minimal": "allow"` write rule as well or the next generate silently drops back to `":minimal" = "read"`. Note that a tool-scoped category replaces the shared one wholesale for Codex CLI: if your shared `permission` block already has `read`/`write` rules that should also apply to Codex CLI, repeat them inside `codexcli.permission`.

What each entry does:

- **Unix socket access**: `git push`/`git fetch` over SSH needs the agent socket. `dangerously_allow_all_unix_sockets = true` is the simple, environment-independent option; a per-socket `unix_sockets` allow entry with the resolved `$SSH_AUTH_SOCK` path is the stricter one.
- **`.` / `.git/**` / `.agents/**` / `.codex/**` write**: the practical write set for the workspace itself. `"."` spells out the workspace-subtree write access the `:workspace` baseline already grants (a tool-scoped category replaces the shared block wholesale, so keeping it explicit avoids surprises), and `".git/**"` matches the carve-out rulesync emits by default anyway. `.agents/**` and `.codex/**` genuinely add access: Codex's `:workspace` baseline keeps `.git`, `.agents`, and `.codex` read-only inside workspace roots, so without these rules a Codex session cannot update agent files or its own project-level config — for example, running `rulesync generate` inside a session would be denied when writing `.agents/` or `.codex/` outputs. Trade-off: the baseline keeps those two directories read-only precisely so a sandboxed session cannot rewrite its own configuration — with `.codex/**` writable, a compromised or prompt-injected session could relax `.codex/config.toml` (approval policy, permission profiles, MCP servers) for its next run, and with `.agents/**` writable it could persist injected instructions into rule/skill files. Drop these two entries if your workflow does not need in-session writes there.
- **`:root` / `:minimal` write**: package runners such as `npx {package}` unpack into the npm cache under the home directory (`~/.npm/_npx`), and many dev tools write to home-directory caches (`~/.cache`, `~/.local`, corepack/pnpm stores); the `:workspace` baseline denies these writes, which breaks the commands outright. `":root" = "write"` alone is not enough: rulesync emits `":minimal" = "read"` by default (the platform-default system paths needed for sandboxed command execution), and Codex treats that entry as narrowing the broader `:root` grant — the policy no longer qualifies for full disk write access, so writes that `:root` appears to allow can still be denied. Raise `":minimal"` to write alongside `":root"` to get the intended effect. Trade-off: the pair grants the sandbox full disk write access, including platform system paths — a compromised or prompt-injected session could then modify shell startup files, `PATH` binaries, or system configuration outside the workspace, effectively neutralizing the sandbox's write isolation. Prefer narrower home-directory patterns instead (e.g. `"~/.npm/**"`, `"~/.cache/**"`) unless you specifically need system-wide writes, at the cost of chasing each tool's cache path.
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
