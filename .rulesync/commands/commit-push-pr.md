---
targets:
  - "*"
description: "Commit current changes, push to remote, and create or update a pull request"
---

# Commit, Push, and PR Management

## Step 1: Check Current Branch

Run `git branch --show-current` to get the current branch name.

If the current branch is `main` or `master`:

1. Generate a descriptive branch name based on the staged/unstaged changes
2. Create and switch to the new branch: `git checkout -b <new-branch-name>`

## Step 2: Stage and Commit Changes

1. Run `git status` to check for changes
2. If there are unstaged changes, stage them: `git add .`
3. Analyze the changes and create a meaningful commit message
4. Commit with: `git commit -m "<commit-message>"`

## Step 3: Push to Remote

Push the branch to remote with upstream tracking:

```bash
git push -u origin <branch-name>
```

## Step 4: Handle Pull Request

Check if a PR already exists for this branch:

```bash
gh pr view --json number,title,body 2>/dev/null
```

### If PR does NOT exist:

Create a new PR:

```bash
gh pr create --title "<title>" --body "<description>"
```

The PR description should include:

- Summary of changes
- Test plan (if applicable)

### If PR already exists:

1. Compare the current PR title and description with the actual changes
2. If updates are needed (e.g., scope of changes has expanded), update the PR using GitHub API:

```bash
gh api repos/<owner>/<repo>/pulls/<pr-number> -X PATCH -f title="<new-title>" -f body="<new-description>"
```

Note: Use `gh api` instead of `gh pr edit` to avoid GraphQL deprecation warnings. 3. If no updates are needed, skip this step

## Step 5: Report Result

Output the PR URL and a summary of actions taken.
