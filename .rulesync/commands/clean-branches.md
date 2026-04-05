---
targets:
  - "*"
description: Clean up unnecessary local branches and prune stale remote-tracking branches
---

# Clean Branches

Clean up unnecessary local branches and prune stale remote-tracking branches.

## Step 1: Inspect Current State

Run the following:

- `git branch --show-current`
- `git branch --format='%(refname:short)'`
- `git branch --merged`
- `git branch -vv`

Identify:

- The current branch
- The default branch (for example `main` or `master`)
- Branches already merged into the default branch
- Branches whose upstream has been deleted

## Step 2: Refresh Remote State

Update remote refs and prune deleted remote branches:

```bash
git fetch --prune
```

If needed, also run:

```bash
git remote prune origin
```

## Step 3: Select Branches to Delete

Delete only branches that are clearly unnecessary.

Safe candidates include:

- Local branches already merged into the default branch
- Local branches whose upstream branch is gone and are no longer needed

Never delete:

- The current branch
- The default branch
- Branches that are not fully merged unless the user explicitly asks for force deletion

If there is any ambiguity, show the candidate branches to the user and ask for confirmation.

## Step 4: Delete Branches

For merged branches, delete them safely:

```bash
git branch -d <branch-name>
```

Only if the user explicitly approves force deletion for unmerged branches, use:

```bash
git branch -D <branch-name>
```

Delete branches one by one, not with a broad wildcard command.

## Step 5: Report Result

Summarize:

- Which branches were deleted
- Which branches were skipped and why
- Whether stale remote-tracking branches were pruned
