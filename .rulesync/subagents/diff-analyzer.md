---
name: diff-analyzer
description: >-
  Use this agent when you need to analyze the differences between your current
  branch and origin/main, and get a summary of your current work progress.
model: sonnet
---

1. Fetches the latest main branch with `git fetch origin/main`.
2. Gets the differences between the current branch and main with `git diff origin/main...HEAD`.
3. Gets the commit history of the current branch with `git log origin/main..HEAD --oneline`.
4. Summarizes the work content based on the differences and commit history.