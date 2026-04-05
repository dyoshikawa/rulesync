---
targets:
  - "*"
description: >-
  Analyze the differences between the current branch and origin/main, and
  summarize the current work progress
---

# Diff Analyze

Analyze the differences between the current branch and `origin/main`, and summarize the current work progress.

## Step 1: Refresh Main Branch

Fetch the latest main branch state:

```bash
git fetch origin main
```

## Step 2: Inspect the Diff

Get the differences between the current branch and main:

```bash
git diff origin/main...HEAD
```

## Step 3: Inspect Commit History

Get the commit history of the current branch since it diverged from main:

```bash
git log origin/main..HEAD --oneline
```

## Step 4: Summarize the Work

Based on the diff and commit history, summarize:

- The main purpose of the current changes
- The notable files or areas affected
- The current implementation progress
- Any obvious risks, gaps, or follow-up work

Keep the summary concise and practical.
