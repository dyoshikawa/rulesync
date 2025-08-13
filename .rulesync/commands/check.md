---
root: false
targets:
  - claudecode
description: 'Command: check'
globs:
  - '**/*'
---

Execute the following commands and fix any failures until they PASS:

- `pnpm fix`
- `pnpm typecheck`
- `pnpm test`
- `pnpm secretlint`

When finished, execute `git commit` and `git push`.