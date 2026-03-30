---
name: clean-worktrees
description: "Clean git worktrees created by git-worktree-runner"
targets:
  - "*"
---

1. Run `git gtr list` to list all worktrees.
2. For each worktree branch that is NOT the default branch (e.g. main), run `git gtr rm --force {branch}` to remove it.
3. Run `git pull --prune` to fetch latest changes and prune deleted remote branches.
