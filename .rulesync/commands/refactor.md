---
description: 'Refactor'
targets:
  - claudecode
---

1. Call refactoring-planner subagent to plan refactoring tasks.
2. Execute refactoring.
3. Do the following actions and fix any failures if exists. Until all pass successfully, do the following actions again.
  1. Call the fix-planner subagent to get the plan to fix the code.
  2. Execute the plan while analyzing the related files. Please execute `pnpm typecheck`, `pnpm fix`, `pnpm test` and `pnpm secretlint` yourself as needed. If you get stuck, please call the fix-planner subagent again.
4. When finished, execute `git commit` and `git push`.
