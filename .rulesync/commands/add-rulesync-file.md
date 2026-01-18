---
targets:
  - "*"
description: >-
  Create a Rulesync file (rule, command, subagent, skill, ignore, or mcp) using
  the Rulesync MCP Server
---

# Add Rulesync File

Create a Rulesync file based on the user's request using the Rulesync MCP Server.

## Input

```
$ARGUMENTS
```

## Step 1: Analyze the Request

Parse `$ARGUMENTS` to determine:

1. **File type**: rule, command, subagent, skill, ignore, or mcp
2. **File name**: The name/path of the file to create
3. **Frontmatter**: Required metadata fields
4. **Body content**: The main content of the file

## Step 2: Clarify Missing Information

If any of the following is unclear or missing, ask the user:

### For rule files:

- `root`: Is this a root rule file? (true/false)
- `targets`: Which tools should this apply to? (e.g., `["*"]`, `["claudecode", "cursor"]`)
- `description`: What is the purpose of this rule?
- `globs`: What file patterns should this rule apply to? (e.g., `["**/*.ts"]`)

### For command files:

- `description`: What does this command do?
- `targets`: Which tools should support this command?

### For subagent files:

- `name`: What is the subagent's name?
- `description`: What is the subagent's purpose?
- `targets`: Which tools should support this subagent?

### For skill files:

- `name`: What is the skill's name?
- `description`: What does this skill do?
- `targets`: Which tools should support this skill?

### For ignore files:

- What patterns should be ignored?

### For mcp files:

- What MCP servers should be configured?
- What are the commands and arguments for each server?

## Step 3: Create the File

Use the Rulesync MCP Server's `rulesyncTool` with the following parameters:

- `feature`: The file type (rule, command, subagent, skill, ignore, or mcp)
- `operation`: "put"
- `targetPathFromCwd`: The file path
- `frontmatter`: The metadata object (for rule/command/subagent/skill)
- `body`: The content (for rule/command/subagent/skill)
- `content`: The raw content (for ignore/mcp)

## Step 4: Confirm Creation

After creating the file, confirm to the user:

1. The file path that was created
2. A summary of the frontmatter and content
3. Remind them to run `rulesync generate` to apply changes to target tools
