---
description: "Add and update tests in line with the changes."
targets:
  - "*"
---

1. call diff-analyzer subagent to get the summary of the changes.
2. Add and update tests in line with the changes.
3. Fix the code until `pnpm cicheck:code` passes.
