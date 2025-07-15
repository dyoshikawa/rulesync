target_tool_name, tool_name_in_rulesync, remarks = $ARGUMENTS

target_tool_name: required
tool_name_in_rulesync: optional, default: target_tool_name
remarks: optional

If remarks is provided, please consider its content when performing the following tasks.

Please complete all of the following tasks.

## specification-rules-{tool_name_in_rulesync}

1. Research the specifications for rules or memories text files of target_tool_name by using "o3-search" mcp server.
2. Output the researched content in as much detail as possible, comprehensively covering the specifications, to `.rulesync/specification-rules-{tool_name_in_rulesync}.md`.

## specification-mcp-{tool_name_in_rulesync}

1. Research the specifications for MCP configuration text files of target_tool_name by using "o3-search" mcp server.
2. Output the researched content in as much detail as possible, comprehensively covering the specifications, to `.rulesync/specification-mcp-{tool_name_in_rulesync}.md`.

## specification-ignore-{tool_name_in_rulesync}

1. Research the specifications for ignore text files of target_tool_name by using "o3-search" mcp server. Ignore files are configuration files used to specify files that should not be read or written by AI coding tools, such as files containing secret information.
2. Output the researched content in as much detail as possible, comprehensively covering the specifications, to `.rulesync/specification-ignore-{tool_name_in_rulesync}.md`.
