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
