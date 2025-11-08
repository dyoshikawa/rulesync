---
root: true # true that is less than or equal to one file for overview such as AGENTS.md, false for details such as .agents/memories/*.md
targets: ["*"] # * = all, or specific tools
description: "rulesync project overview and development guidelines for unified AI rules management CLI tool"
globs: ["**/*"] # file patterns to match (e.g., ["*.md", "*.txt"])
cursor: # for cursor-specific rules
  alwaysApply: true
  description: "rulesync project overview and development guidelines for unified AI rules management CLI tool"
  globs: ["*"]
---

# Rulesync Project Overview

This is Rulesync, a Node.js CLI tool that automatically generates configuration files for various AI coding tools from unified AI rule files. The project enables teams to maintain consistent AI coding assistant rules across multiple tools.

Read @README.md if you want to know Rulesync specification.

## Use appropriate MCP servers

- When you search for codebase information, use serena MCP as possible as you can.
- When you search for library documentation, use context7 MCP as possible as you can.
- When you fetch web content, use fetch MCP as possible as you can.

Of course, you can also use your built-in tools if you need.
