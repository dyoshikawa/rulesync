---
targets:
  - '*'
description: >-
  Fetch latest origin/main and rebase it onto the current branch, resolving
  conflicts if necessary
---
# Rebase Latest Main

Fetch the latest `origin/main` and rebase it onto the current working branch.

## Step 1: Verify Current State

1. Check the current branch:
   ```bash
   git branch --show-current
   ```

2. Ensure there are no uncommitted changes:
   ```bash
   git status --porcelain
   ```
   
   If there are uncommitted changes, either:
   - Commit them first, or
   - Ask the user how to proceed (commit, stash, or abort)

## Step 2: Fetch Latest Changes

Fetch the latest changes from the remote:
```bash
git fetch origin main
```

## Step 3: Rebase onto origin/main

Start the rebase:
```bash
git rebase origin/main
```

### If rebase succeeds without conflicts:
Proceed to Step 5.

### If conflicts occur:

1. Identify conflicting files:
   ```bash
   git diff --name-only --diff-filter=U
   ```

2. For each conflicting file:
   - Read the file content to understand the conflict
   - Analyze both versions (HEAD and origin/main)
   - Resolve the conflict by choosing the appropriate changes or merging them
   - Stage the resolved file:
     ```bash
     git add <resolved-file>
     ```

3. Continue the rebase:
   ```bash
   git rebase --continue
   ```

4. Repeat until all conflicts are resolved and rebase is complete.

## Step 4: Handle Rebase Failure

If unable to resolve conflicts automatically:
- Show the conflicting files and conflict markers to the user
- Ask for guidance on how to resolve
- If the user wants to abort:
  ```bash
  git rebase --abort
  ```

## Step 5: Push Changes

After successful rebase, force push to update the remote branch:
```bash
git push --force-with-lease
```

Note: `--force-with-lease` is safer than `--force` as it prevents overwriting others' work.

## Step 6: Report Result

Summarize the operation:
1. Number of commits rebased
2. Any conflicts that were resolved
3. Confirmation that the branch is now up-to-date with origin/main
