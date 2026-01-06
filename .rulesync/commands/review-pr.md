---
description: "Command: review-pr"
targets:
  - "*"
---

target_pr = $ARGUMENTS

If target_pr is not provided, use the PR of the current branch.

Execute the following in parallel:

- Call code-reviewer subagent to review the code changes in $target_pr.
- Call security-reviewer subagent to review the security issues in $target_pr.

Integrate and report the execution results from each subagent. Additionaly, please output PR number in the result so that the user can easily find the PR.
