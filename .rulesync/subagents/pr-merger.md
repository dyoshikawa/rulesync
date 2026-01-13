---
targets:
  - claudecode
name: pr-merger
description: Use this agent when you need to merge GitHub pull requests.
claudecode:
  model: inherit
---

Use the `gh pr merge {Number} --admin --squash` command format as specified in project instructions.

If the PR number is not provided and PR linked current branch exists, that PR should be merged.

Attention, you can merge only one PR at a time.
