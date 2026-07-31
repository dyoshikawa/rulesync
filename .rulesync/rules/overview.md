---
root: true # true for overview fragments such as AGENTS.md; multiple root files can be composed for the same target. false for details such as .agents/memories/*.md
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
- About the `skills/` directory at the repository root:
  - This directory contains official skills that are distributed for users to install via the `rulesync fetch` command (e.g., `npx rulesync fetch dyoshikawa/rulesync --features skills`).
  - It is NOT the same as `.rulesync/skills/`, which holds the project's own skill definitions used during generation.
  - Do not modify the root `skills/` directory unless you intend to change the official skills distributed to users.
- The distributed skill `skills/rulesync/` ships only `SKILL.md`, which delegates detailed lookup to the `rulesync docs` CLI command. The bundled documentation itself is embedded from `docs/**/*.md` into `src/generated/docs-content.ts` by `scripts/generate-docs-content.ts` (regenerate with `pnpm run generate:docs-content`; CI fails on drift).
- Always preserve the existence of end-to-end happy-path test cases that cover the Tool × Feature matrix.
- When researching topics, if the built-in webfetch tool cannot retrieve a page's content (e.g., because the page is a SPA), use the `playwright-cli` skill instead.
