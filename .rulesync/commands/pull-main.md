---
targets:
  - "*"
description: >-
  Switch to main branch and pull latest changes with prune. Use when the user
  wants to pull latest main, update main, or sync main with remote.
---

# Pull Main

Switch to the `main` branch and pull the latest changes from `origin/main` while pruning stale remote-tracking references.

## Step 1: Inspect Current State

Check the current branch:

```bash
git branch --show-current
```

If already on `main`, note it for the final report.

## Step 2: Switch to Main

Switch to the `main` branch:

```bash
git switch main
```

## Step 3: Pull with Prune

Pull the latest changes from `origin/main` with `--prune` to remove stale remote-tracking branches:

```bash
git pull --prune
```

## Step 4: Report Result

Summarize the operation:

- Whether a branch switch occurred
- Number of commits pulled (fast-forward or merge)
- Any stale remote-tracking branches that were pruned
