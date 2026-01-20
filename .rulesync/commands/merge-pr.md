---
targets:
  - "*"
description: Merge a pull request using gh pr merge --admin
---

# Merge Pull Request

Merge a pull request using `gh pr merge --admin`.

## Input

```
$ARGUMENTS
```

## Step 1: Determine the Target PR

Parse `$ARGUMENTS` to identify the PR to merge:

### Case A: PR number or URL is provided

- Extract the PR number from the argument
- Examples: `123`, `#123`, `https://github.com/owner/repo/pull/123`

### Case B: No argument provided

- Get the PR associated with the current branch:
  ```bash
  gh pr view --json number,title,state
  ```

### Case C: Unable to determine the PR

If the PR cannot be determined (e.g., no PR exists for the current branch, or the argument is ambiguous), **ask the user** to specify which PR to merge.

## Step 2: Verify the PR

Before merging, confirm the PR details:

```bash
gh pr view <pr_number> --json number,title,state,mergeable,author,baseRefName,headRefName
```

Check:

1. The PR state is `OPEN`
2. Display the PR title and number to the user for confirmation

If the PR is not open or not mergeable, inform the user and stop.

## Step 3: Merge the PR

Execute the merge command:

```bash
gh pr merge <pr_number> --admin --merge
```

**Important**: Only merge ONE PR at a time. If multiple PRs are somehow specified, ask the user which single PR to merge.

## Step 4: Report Result

After merging:

1. Confirm the PR was successfully merged
2. Display the merged PR number and title

## Step 5: Clean Up Local Branch

Ask the user if they want to clean up the local branch. If yes, execute:

```bash
git checkout main && git pull && git branch -d <branch-name>
```

Where `<branch-name>` is the head branch name from Step 2 (e.g., `fix/rulesync-import-targets`).
