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

Execute the following in parallel:

- Call code-reviewer subagent to review the code changes in $target_pr.
- Call security-reviewer subagent to review the security issues in $target_pr.

Integrate and report the execution results from each subagent. Additionaly, please output PR number in the result so that the user can easily find the PR.

## Reporting Rules

- Assign a severity level to each finding: low, mid, high, or critical.
- Assign a sequential number to each finding (e.g., #1, #2, #3, ...).
