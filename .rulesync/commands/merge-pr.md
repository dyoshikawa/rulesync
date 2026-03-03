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

## Step 3: Check GitHub Actions Workflow Status

Verify that all CI checks have passed before merging:

```bash
gh pr checks <pr_number>
```

Check:

1. All workflow checks show `pass` status
2. No checks are `pending` or `fail`

If any checks have failed or are still running, inform the user and ask whether to:

- Wait for pending checks to complete
- Investigate failed checks before merging
- Proceed with merge anyway (using `--admin` will bypass required checks)

## Step 4: Merge the PR

Execute the merge command:

```bash
gh pr merge <pr_number> --admin --merge
```

**Important**: Only merge ONE PR at a time. If multiple PRs are somehow specified, ask the user which single PR to merge.

## Step 5: Report Result

After merging:

1. Confirm the PR was successfully merged
2. Display the merged PR number and title

## Step 6: Clean Up Local Branch / Worktree

After merge, clean up local state for the head branch from Step 2 (`<branch-name>`). Here, `<base-branch>` is the base branch name from Step 2 (`baseRefName`, e.g. `main`).

1. Detect whether `<branch-name>` is attached to a worktree:
   ```bash
   git worktree list --porcelain
   ```
2. Parse the porcelain output by blocks (entries are separated by a blank line).
   - Only consider blocks that include a `branch` line (detached HEAD blocks have no `branch` line).
   - If no block has `branch refs/heads/<branch-name>`, treat it as “no worktree found for the branch.”
   - Capture a fallback `<worktree-path>` from the first `worktree <path>` entry.
3. Validate inputs before using them in commands.
   - `<branch-name>` and `<base-branch>` must be treated as literals: reject values that start with `-` or contain whitespace, `$`, backticks, quotes, backslashes, `;`, `&`, `|`, `<`, `>`, `(`, `)`, or newlines.
   - `<worktree-path>` must come from porcelain output (not user input). Reject it if it contains `$`, backticks, or newlines.
4. If a worktree is found for `<branch-name>`, capture its `worktree <path>` and resolve the matching `git gtr` name:

   ```bash
   git gtr list --porcelain
   ```

   - `<worktree-name>` is the `name` field in the `git gtr` porcelain block whose `path` matches `<worktree-path>` (do not assume it is the basename).

5. Before removal, if the current directory is inside `<worktree-path>`, move to a safe worktree (e.g., the main worktree root) so the target can be deleted.
6. Remove the worktree:

   ```bash
   git gtr rm -- "<worktree-name>"
   ```

   - This removes both the worktree directory and the associated branch.

7. If no worktree is associated with `<branch-name>`, fall back to normal branch cleanup from any existing worktree (do not assume current dir is the main worktree):
   ```bash
   git -C "<worktree-path>" checkout -- "<base-branch>" && git -C "<worktree-path>" pull --prune && git -C "<worktree-path>" branch -d -- "<branch-name>"
   ```
