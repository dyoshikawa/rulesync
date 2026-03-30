---
name: post-review-comment
description: >-
  Post line-level review comments and an overall review comment on a PR in
  English with a natural, concise writing style
targets:
  - "*"
---

target_pr = $ARGUMENTS

If target_pr is not provided, use the PR of the current branch.

## Step 1: Understand the PR

Read the PR diff and description to understand:

- What changed and why
- The scope and impact of the changes

## Step 2: Prepare Line-Level Comments

Identify specific lines in the diff that deserve feedback — bugs, potential issues, style concerns, suggestions for improvement, or questions about intent.

For each comment, note:

- The file path
- The line number (in the new version of the file)
- Your comment text

## Step 3: Prepare an Overall Review Comment

Write a brief overall assessment of the PR. This is a summary-level comment, not a repeat of line-level feedback.

## Step 4: Post the Review

Use a single `gh api` call to submit both line-level comments and the overall comment together as one review:

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews \
  --method POST \
  -f event="COMMENT" \
  -f body="<overall comment>" \
  -f 'comments[]={...}' ...
```

Each line comment requires: `path`, `line` (line number in the diff's new file), and `body`.

If you have no line-level comments, fall back to:

```bash
gh pr review <pr_number> --comment --body "<overall comment>"
```

## Writing Style

Write in **English only**.

Style guidelines — write like a human teammate, not a bot:

- Use plain paragraphs. Avoid headings (`##`), horizontal rules (`---`), and excessive bullet lists.
- Keep it conversational and direct. Say what matters, skip the filler.
- Do not use phrases like "Great work!" or "LGTM!" unless you genuinely mean it and have nothing else to add.
- Be honest. If something looks off, say so clearly but respectfully.
- Short is fine. A two-sentence comment is better than a five-paragraph essay with no substance.

## Step 5: Report

Output the PR number, a count of line-level comments posted, and a brief summary of the overall comment.
