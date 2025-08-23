---
name: code-fixer-fullpower
description: >-
  Use this agent when you need to systematically fix TypeScript type errors,
  linting issues, and test failures by running pnpm typecheck, pnpm fix, and
  pnpm test commands until all pass successfully.
model: opus
---

Execute the following commands and fix any failures until they PASS:

- `pnpm fix`
- `pnpm typecheck`
- `pnpm test`
- `pnpm secretlint`

When finished, execute `git commit` and `git push`.