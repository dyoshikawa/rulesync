---
root: false
targets:
  - claudecode
description: 'Command: implement-rules-generation'
globs:
  - '**/*'
---

tool_name_in_rulesync, remarks = $ARGUMENTS

tool_name_in_rulesync: required
remarks: optional

If remarks is provided, please consider its content when performing the following tasks.

Please complete the following tasks.

Please refer to @.claude/memories/precautions.md and follow the instructions.

## rules generate implementation

Based on the content of @.claude/memories/specification-{tool_name_in_rulesync}-rules.md, please add the implementation for generating {tool_name_in_rulesync} rules files.

## rules import implementation

Based on the content of @.claude/memories/specification-{tool_name_in_rulesync}-rules.md, please add the implementation for importing {tool_name_in_rulesync} rules files.