---
targets:
  - "*"
description: >-
  Review a pull request for code quality and security issues. Use when the user
  wants to review a PR, check PR code changes, or audit a pull request. Triggers
  on: "review PR", "review pull request", "check this PR", "/review-pr".
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
- When invoking subagents, explicitly instruct them that switching the local branch is forbidden and that they must inspect changes via `git`/`gh` commands only.

Execute the following in parallel:

- Call code-reviewer subagent to review the code changes in $target_pr. Pass along the rule that the local branch must not be switched and that diffs must be obtained via `git`/`gh` commands.
- Call security-reviewer subagent to review the security issues in $target_pr. Pass along the rule that the local branch must not be switched and that diffs must be obtained via `git`/`gh` commands.

Integrate and report the execution results from each subagent. Additionaly, please output PR number in the result so that the user can easily find the PR.

## Reporting Rules

- Assign a severity level to each finding: low, mid, high, or critical.
- Assign a sequential number to each finding (e.g., #1, #2, #3, ...).

## After the Review: Check GitHub Actions Workflows

After completing the content review, check the status of the GitHub Actions workflows for $target_pr (for example, using `gh pr checks` or `gh run list`).

- Report the status of every workflow run to the user, including runs that are still in progress.
- For each failing workflow, also report:
  - The likely cause of the failure (based on the relevant logs or job output).
  - Candidate solutions or next steps to resolve it.
