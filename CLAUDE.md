Please also reference the following documents as needed:

@.claude/memories/coding-guidelines.md description: "When you write any code, must follow these guidelines." globs: "**/*.ts"
@.claude/memories/testing-guidelines.md description: "When you write tests, must follow these guidelines." globs: "**/*.test.ts"
# Rulesync Project Overview

This is Rulesync, a Node.js CLI tool that automatically generates configuration files for various AI coding tools from unified AI rule files. The project enables teams to maintain consistent AI coding assistant rules across multiple tools.

- Read @README.md if you want to know Rulesync specification.
- Manage runtimes and package managers with @mise.toml . 
- When you want to check entire codebase:
  - You can use:
    - `pnpm cicheck:code` to check code style, type safety, and tests.
    - `pnpm cicheck:content` to check content style, spelling, and secrets.
    - `pnpm cicheck` to check both code and content.
  - Basically, I recommend you to run `pnpm cicheck:code` only to daily checks. Because it is fast, `pnpm cicheck:content` and `pnpm cicheck` are slower.

## Use appropriate MCP servers

- When you search for codebase information, you should use serena MCP.
- When you search for library documentation, you should use context7 MCP.
- When you fetch web content, you should use fetch MCP.
- When you need to handle rules, commands, MCP, ignore files, and subagents for any AI agents, you should use Rulesync MCP.

Of course, you can also use your built-in tools if you need.

In this project, all MCP servers are provided via the Modular MCP server. When you want to check available tools and call them, you must always call the Modular MCP server first. If you feel any need whatsoever to use any of the MCP servers mentioned above, you should list the tools with Modular MCP.
