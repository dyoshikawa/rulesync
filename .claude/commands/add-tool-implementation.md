tool_name_in_rulesync, remarks = $ARGUMENTS

tool_name_in_rulesync: required
remarks: optional

If remarks is provided, please consider its content when performing the following tasks.

Please complete all of the following tasks.

IMPORTANT: You must implement only the specification that generates configuration files for project settings. rulesync does not interact with user settings. For example, implementation that creates or updates configuration files under the user's home directory is strictly prohibited.

## rules generate implementation

Based on the content of @.claude/memories/specification-rules-{tool_name_in_rulesync}.md, please add the implementation for generating {tool_name_in_rulesync} rules files.

## mcp generate implementation

Based on the content of @.claude/memories/specification-mcp-{tool_name_in_rulesync}.md, please add the implementation for generating {tool_name_in_rulesync} mcp configuration files.

## ignore generate implementation

Based on the content of @.claude/memories/specification-ignore-{tool_name_in_rulesync}.md, please add the implementation for generating {tool_name_in_rulesync} ignore files.
