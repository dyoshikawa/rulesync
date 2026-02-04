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

- Read @README.md if you want to know Rulesync specification.
- Manage runtimes and package managers with @mise.toml .
- When you want to check entire codebase:
  - You can use:
    - `pnpm cicheck:code` to check code style, type safety, and tests.
    - `pnpm cicheck:content` to check content style, spelling, and secrets.
    - `pnpm cicheck` to check both code and content.
  - Basically, I recommend you to run `pnpm cicheck` to daily checks.
- When doing `git commit`:
  - You must run `pnpm cicheck` before committing to verify quality.
  - You must not use here documents because it causes a sandbox error.
  - You must not use `--no-verify` option because it skips pre-commit checks and causes serious security issues.
- When you read or search the codebase:
  - You should check Serena MCP server tools, and use those actively.
