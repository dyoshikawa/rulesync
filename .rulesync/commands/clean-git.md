---
description: "Clean branches and worktrees"
targets:
  - "*"
---

1. Delete all local branches except for current branch and main branch.
2. Run `git worktree prune` to clean up stale worktree references.
3. Run `git pull --prune`
