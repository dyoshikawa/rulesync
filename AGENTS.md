Please also reference the following rules as needed. The list below is provided in TOON format, and `@` stands for the project root directory.

rules[4]:

- path: @.opencode/memories/coding-guidelines.md
  description: "When you write any code, must follow these guidelines."
  applyTo[1]: \*_/_.ts
- path: @.opencode/memories/feature-change-guidelines.md
  description: "When you add or change features, must follow these guidelines."
- path: @.github/workflows/AGENTS.md
  description: Guidelines to avoid GitHub Actions script injection vulnerabilities.
  applyTo[1]: .github/workflows/\*.yml
- path: @.opencode/memories/testing-guidelines.md
  description: "When you write tests, must follow these guidelines."
  applyTo[2]: **/\*.test.ts,src/e2e/**/\*.spec.ts

# Rulesync Project Overview

This is Rulesync, a Node.js CLI tool that automatically generates configuration files for various AI coding tools from unified AI rule files. The project enables teams to maintain consistent AI coding assistant rules across multiple tools.

- Read `README.md` and `docs/**/*.md` if you want to know Rulesync specification.
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
  - When creating a PR, you should include a link in the PR description that associates the PR with its issue.
- When you read or search the codebase:
  - You should check Serena MCP server tools, and use those actively.
- About the `skills/` directory at the repository root:
  - This directory contains official skills that are distributed for users to install via the `rulesync fetch` command (e.g., `npx rulesync fetch dyoshikawa/rulesync --features skills`).
  - It is NOT the same as `.rulesync/skills/`, which holds the project's own skill definitions used during generation.
  - Do not modify the root `skills/` directory unless you intend to change the official skills distributed to users.
- The contents of `docs/` and `skills/rulesync/` are automatically synchronized by `scripts/sync-skill-docs.ts`. Be aware that their content may overlap.
- Always preserve the existence of end-to-end happy-path test cases that cover the Tool × Feature matrix.

I'm a Japanese developer. So you must always answer in Japanese. On the other hand, reasoning(thinking) should be in English to improve token efficiency.

However, this project is for English speaking people. So when you write any code, comments, documentation, commit messages, PR title and PR descriptions, you must always use English.
