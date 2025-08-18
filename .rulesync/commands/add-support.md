---
description: 'Add support for a new AI coding tool.'
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

## 1. Research tool specifications

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

## 2. Implement rules generation and import

Please complete the following tasks.

Please refer to @.rulesync/rules/precautions.md and follow the instructions.

### rules generate implementation

Based on the content of @.rulesync/rules/specification-{tool_name_in_rulesync}-rules.md, please add the implementation for generating {tool_name_in_rulesync} rules files.

### rules import implementation

Based on the content of @.rulesync/rules/specification-{tool_name_in_rulesync}-rules.md, please add the implementation for importing {tool_name_in_rulesync} rules files.

## 3. Implement ignore generation

Please complete the following tasks.

Please refer to @.rulesync/rules/precautions.md and follow the instructions.

### ignore generate implementation

Based on the content of @.rulesync/rules/specification-{tool_name_in_rulesync}-ignore.md, please add the implementation for generating {tool_name_in_rulesync} ignore files.

## 4. Implement mcp generation

Please complete the following tasks.

Please refer to @.rulesync/rules/precautions.md and follow the instructions.

### mcp generate implementation

Based on the content of @.rulesync/rules/specification-{tool_name_in_rulesync}-mcp.md, please add the implementation for generating {tool_name_in_rulesync} mcp configuration files.

## 5. Update gitignore command

Please complete the following tasks.

Please refer to @.rulesync/rules/precautions.md and follow the instructions.

## gitignore command update

Please identify the generated files for {tool_name_in_rulesync} from the content of @.rulesync/rules/specification-*-{tool_name_in_rulesync}.md.

Then, add the generated files for {tool_name_in_rulesync} to the output list of the gitignore command.

## 6. Fix code

Call the code-fixer subagent to stabilize the all implementations above.

## 7. Create PR

Call the pr-creator subagent to create a PR for the all implementations above.

## 8. Self-review

Please review and fix the all implementations above.

1. Call the code-reviewer subagent and the security-reviewer subagent to review the all implementations above.
2. Review the code by the aspect about @.rulesync/rules/precautions.md.
3. You check the review results above and modify the code if necessary.
4. Call the code-fixer subagent to stabilize the code after the fix.
