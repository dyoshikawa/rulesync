---
description: 'Stabilize tests by running `pnpm cicheck` and updating tests in line with the changes.'
targets:
  - '*'
---

1. call diff-analyzer subagent to get the summary of the changes.
2. Run `pnpm cicheck` to check if the tests pass.
3. If the tests fail, update tests in line with the changes until the tests pass.
