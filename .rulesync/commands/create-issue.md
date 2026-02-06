---
targets:
  - "*"
description: >-
  Create a GitHub issue with detailed description, purpose, and appropriate
  labels
---

# Create GitHub Issue

## Step 1: Gather Information

Receive the issue topic from $ARGUMENTS or the user's description.

If the information is insufficient, ask the user to clarify the following:

- What needs to be done (the task or problem)
- Why it needs to be done (the purpose or motivation)

## Step 2: Research Context

Before writing the issue, investigate the relevant parts of the codebase to understand:

- Which files and modules are affected
- Existing related code patterns
- Potential impact and scope of the change

## Step 3: Draft the Issue

Create a well-structured issue with the following sections:

```markdown
## Summary

A concise one-liner describing what this issue is about.

## Motivation / Purpose

Why this change is needed. Explain the problem, user impact, or improvement opportunity.

## Details

Detailed description of what needs to be done:

- Specific changes required
- Files or modules likely affected
- Acceptance criteria or expected behavior

## Additional Context

Any relevant links, screenshots, or references (if applicable).
```

## Step 4: Assign Labels

Choose appropriate labels from the existing repository labels based on the issue content:

- `bug` — Something isn't working
- `enhancement` — New feature or request
- `documentation` — Improvements or additions to documentation
- `refactoring` — Code refactoring
- `improvement` — General improvement
- `security` — Security-related issue
- `high priority` — Urgent issues

Additionally, evaluate whether the issue is suitable for newcomers. If the contribution is straightforward (e.g., small scope, well-defined, minimal domain knowledge required), also assign the `good first issue` label.

## Step 5: Create the Issue

```bash
gh issue create --title "<concise title>" --body "<drafted body>" --label "<label1>,<label2>,..."
```

## Step 6: Report Result

Output the created issue URL and a summary of:

- Issue title
- Assigned labels
- Whether `good first issue` was applied and why (or why not)
