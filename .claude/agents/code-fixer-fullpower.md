---
name: code-fixer-fullpower
description: Use this agent when you need to systematically fix TypeScript type errors, linting issues, and test failures by running pnpm typecheck, pnpm fix, and pnpm test commands until all pass successfully. Examples: <example>Context: User has written some new TypeScript code that has type errors and wants to fix all issues. user: "I just added a new feature but there are type errors and some tests are failing. Can you fix everything?" assistant: "I'll use the code-fixer-fullpower agent to systematically run typecheck, fix, and test commands until everything passes." <commentary>The user has code quality issues that need systematic fixing, so use the code-fixer-fullpower agent to resolve all TypeScript, linting, and testing issues.</commentary></example> <example>Context: After a refactoring, the codebase has multiple issues that need to be resolved. user: "After my refactoring, pnpm typecheck is showing errors and some tests broke" assistant: "Let me use the code-fixer-fullpower agent to systematically resolve all the issues." <commentary>Multiple code quality issues need systematic resolution, perfect use case for the code-fixer-fullpower agent.</commentary></example>. This agent can be called by user explicitly only.
model: opus
---

Execute the following commands and fix any failures until they PASS:

- `pnpm fix`
- `pnpm typecheck`
- `pnpm test`
- `pnpm secretlint`

When finished, execute `git commit` and `git push`.
