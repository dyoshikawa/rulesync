target_tool_name, tool_name_in_rulesync, remarks = $ARGUMENTS

target_tool_name: required
tool_name_in_rulesync: optional, default: target_tool_name
remarks: optional

If remarks is provided, please consider its content when performing the following tasks.

Please complete all of the following tasks.

Important: `.rulesync/*.md` files must include the required frontmatter. Refer to @README.md for frontmatter specification details.

Call the rulesync-md-creator subagent serially to create the following files:

1. `.rulesync/specification-{tool_name_in_rulesync}-rules.md`
  - Research the specifications for rules or memories text files of target_tool_name.
2. `.rulesync/specification-{tool_name_in_rulesync}-mcp.md`
  - Research the specifications for MCP configuration text files of target_tool_name.
3. `.rulesync/specification-{tool_name_in_rulesync}-ignore.md`
  - Research the specifications for ignore text files of target_tool_name. Ignore files are configuration files used to specify files that should not be read or written by AI coding tools, such as files containing secret information.

For all files, instruct the subagent to research and document the specifications as comprehensively and thoroughly as possible without omissions.

