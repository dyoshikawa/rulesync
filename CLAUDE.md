Please also reference the following documents as needed:

@.claude/memories/coding-guidelines.md description: "When you write any code, must follow these guidelines." globs: "**/*.ts"
@.claude/memories/my-language.md description: "You must always answer in Japanese. On the other hand, reasoning(thinking) should be in English to improve token efficiency." globs: "**/*"
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
- When doing `git commit`:
  - You must not use here documents because it causes a sandbox error.
  - You must not use `--no-verify` option because it skips pre-commit checks and causes serious security issues.
