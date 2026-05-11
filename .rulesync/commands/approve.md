---
targets:
  - "*"
description: Approve a pull request using gh pr review --approve
---

# Approve Pull Request

Approve a pull request using `gh pr review --approve`.

## Input

```
$ARGUMENTS
```

## Step 1: Determine the Target PR

Parse `$ARGUMENTS` to identify the PR to approve:

### Case A: PR number or URL is provided

- Extract the PR number from the argument
- Examples: `123`, `#123`, `https://github.com/owner/repo/pull/123`

### Case B: No argument provided

- Get the PR associated with the current branch:
  ```bash
  gh pr view --json number,title,state
  ```

### Case C: Unable to determine the PR

If the PR cannot be determined (e.g., no PR exists for the current branch, or the argument is ambiguous), **ask the user** to specify which PR to approve.

## Step 2: Verify the PR

Before approving, confirm the PR details:

```bash
gh pr view <pr_number> --json number,title,state,author,baseRefName,headRefName,isDraft
```

Check:

1. The PR state is `OPEN`
2. The PR is not a draft (`isDraft` is `false`)
3. Display the PR title, number, and author to the user for confirmation

If the PR is not open or is a draft, inform the user and stop.

## Step 3: Approve the PR

Execute the approve command:

```bash
gh pr review <pr_number> --approve
```

**Important**: Only approve ONE PR at a time. If multiple PRs are somehow specified, ask the user which single PR to approve.

If you want to add a comment along with the approval, use the `--body` option:

```bash
gh pr review <pr_number> --approve --body "<approval_comment>"
```

## Step 4: Report Result

After approving:

1. Confirm the PR was successfully approved
2. Display the approved PR number and title
