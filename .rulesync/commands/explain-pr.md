---
targets:
  - "*"
description: "Explain a PR: the background problem and the proposed solution"
---

target_pr = $ARGUMENTS

If target_pr is not provided, use the PR of the current branch.

## Step 1: Gather PR Information

Run the following in parallel:

- Get the PR description and metadata: `gh pr view <pr_number>`
- Get the PR diff: `gh pr diff <pr_number>`

## Step 2: Analyze and Explain

Based on the PR content, explain the following two aspects:

1. **Background (Problem/Motivation):** What issue or limitation existed before this PR? Why was this change needed?
2. **Solution:** What approach does this PR take to address the problem? Summarize the key changes and design decisions.

Keep the explanation concise and focused. Use the language of the current conversation (follow the user's language).
