---
targets:
  - "*"
description: >-
  Review a pull request for code quality and security issues without using
  subagents. Use when the user wants a lighter-weight PR review in a single
  command.
---

target_pr = $ARGUMENTS

If target_pr is not provided, use the PR of the current branch.

## Important: Do Not Switch the Local Branch

- Do NOT check out, switch, or otherwise move the local branch (e.g., `git checkout`, `git switch`, `gh pr checkout`).
- To inspect the PR's changes, use `git` and `gh` commands that read remote state without moving the working tree. For example:
  - `gh pr view $target_pr` to read PR metadata and description.
  - `gh pr diff $target_pr` to read the diff.
  - `gh pr view $target_pr --json files` or `gh api` to list changed files.
  - `git fetch origin pull/<PR_NUMBER>/head:refs/remotes/origin/pr-<PR_NUMBER>` and `git diff origin/main...origin/pr-<PR_NUMBER>` if a local read-only ref is needed.

## Step 1: Gather PR Context

Run the following in parallel:

- Get the PR description and metadata via `gh pr view $target_pr` (do not check out the PR locally).
- Get the PR diff via `gh pr diff $target_pr`.
- If needed, inspect changed files individually for deeper context using `gh` / `git` commands (e.g., `gh api`, `git show`) — without switching the local branch.

## Step 2: Review the Changes

Review the PR directly in this command without calling any subagents.

Focus on both of the following:

1. **Code Review**
   - Bugs or behavioral regressions
   - Incorrect assumptions or edge cases
   - Missing or weak tests
   - Maintainability issues that could cause near-term problems

2. **Security Review**
   - Injection risks
   - Auth/authz mistakes
   - Secrets exposure
   - Unsafe file, network, shell, or deserialization behavior
   - Dependency or configuration changes that could weaken security

## Step 3: Report Findings

Integrate all findings into one review result. Please output the PR number in the result so that the user can easily find the PR.

## Reporting Rules

- Assign a severity level to each finding: low, mid, high, or critical.
- Assign a sequential number to each finding (e.g., #1, #2, #3, ...).
- Present findings first, ordered by severity.
- If no findings are discovered, explicitly state that no findings were found.
- Keep the summary brief and focused on risk and testing gaps.

## Step 4: Check GitHub Actions Workflows

After completing the content review, check the status of the GitHub Actions workflows for $target_pr (for example, using `gh pr checks` or `gh run list`).

- Report the status of every workflow run to the user, including runs that are still in progress.
- For each failing workflow, also report:
  - The likely cause of the failure (based on the relevant logs or job output).
  - Candidate solutions or next steps to resolve it.
