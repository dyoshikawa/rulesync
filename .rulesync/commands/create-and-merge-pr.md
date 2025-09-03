---
description: 'create and merge PR'
targets:
  - claudecode
---

1. Call the pr-handler subagent to create or update a PR.
2. Check whether the PR is linked to the current branch. If not, exit with error.
3. Check the status of the PR. If the status is not success, exit with error.
4. Call the pr-merger subagent to merge the PR.

Attention, you can merge only one PR that is linked to the current branch at a time.
