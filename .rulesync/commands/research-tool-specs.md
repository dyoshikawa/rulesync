---
description: 'Command: research-tool-specs'
targets:
  - claudecode
---

target_tool_name, tool_name_in_rulesync, overwrite, remarks = $ARGUMENTS

target_tool_name: required
tool_name_in_rulesync: optional, default: target_tool_name
overwrite: optional, default: false
remarks: optional

If overwrite is true, even though the files already exists, please overwrite them.
If remarks is provided, please consider its content when performing the following tasks.

Please complete all of the following tasks.

Important: `.rulesync/*.md` files must include the required frontmatter. Refer to @README.md for frontmatter specification details.

Use the context7 MCP and web search to research the specifications and create the following files:

1. `.rulesync/rules/specification-{tool_name_in_rulesync}-rules.md`
  - Research the specifications for rules or memories text files of target_tool_name using context7 and web search.
2. `.rulesync/rules/specification-{tool_name_in_rulesync}-mcp.md`
  - Research the specifications for MCP configuration text files of target_tool_name using context7 and web search.
3. `.rulesync/rules/specification-{tool_name_in_rulesync}-ignore.md`
  - Research the specifications for ignore text files of target_tool_name using context7 and web search. Ignore files are configuration files used to specify files that should not be read or written by AI coding tools, such as files containing secret information.
4. `.rulesync/rules/specification-{tool_name_in_rulesync}-commands.md`
  - Research the specifications for custom slash commands of target_tool_name using context7 and web search. Only part of the AI coding tools supports the custom slash commands function, so md files about only the tools that support this function should be created.

For all files, research and document the specifications as comprehensively and thoroughly as possible without omissions.

The markdown files should include the following frontmatter:

---
root: true | false               # Required: Rule level (true for overview, false for details)
targets: ["*"]                   # Required: Target tools (* = all, or specific tools)
description: "Brief description" # Required: Rule description
globs: []                        # Required: File patterns to match (e.g., ["*.md", "*.txt"])
cursorRuleType: "always"         # Optional: Cursor-specific rule type (always, manual, specificFiles, intelligently)
---

Set root to `false`. Set targets to `*`. Write appropriate content for the description. Specify an empty array `[]` for globs.
