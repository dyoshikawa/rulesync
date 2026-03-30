---
name: review-and-comments
description: >-
  Review a PR for code quality and security issues, then post review comments on
  it. Runs review-pr followed by post-review-comments sequentially.
targets:
  - "*"
---

target_pr = $ARGUMENTS

If target_pr is not provided, use the PR of the current branch.

## Step 1: Review the PR

Run the `review-pr` skill with $target_pr.

## Step 2: Post Review Comments

Using the review results from Step 1, run the `post-review-comments` skill with $target_pr.
