---
targets:
  - "*"
description: >-
  Stabilize cicheck by running `pnpm cicheck:code` and updating code in line
  with the changes.
---

1. call diff-analyzer subagent to get the summary of the changes.
2. Run `pnpm cicheck:code` to check if the tests pass.
3. If the tests fail, update tests in line with the changes until the tests pass.
