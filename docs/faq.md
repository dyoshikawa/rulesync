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

## Google Antigravity doesn't load rules when `.agent` directories are in `.gitignore`

Google Antigravity has a known limitation where it won't load rules, workflows, and skills if the `.agent/rules/`, `.agent/workflows/`, and `.agent/skills/` directories are listed in `.gitignore`, even with "Agent Gitignore Access" enabled.

**Workaround:** Instead of adding these directories to `.gitignore`, add them to `.git/info/exclude`:

```bash
# Remove from .gitignore (if present)
# **/.agent/rules/
# **/.agent/workflows/
# **/.agent/skills/

# Add to .git/info/exclude
echo "**/.agent/rules/" >> .git/info/exclude
echo "**/.agent/workflows/" >> .git/info/exclude
echo "**/.agent/skills/" >> .git/info/exclude
```

`.git/info/exclude` works like `.gitignore` but is local-only, so it won't affect Antigravity's ability to load the rules while still excluding these directories from Git.

Note: `.git/info/exclude` can't be shared with your team since it's not committed to the repository.
