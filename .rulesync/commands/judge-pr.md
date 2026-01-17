---
targets:
  - "*"
description: Judge PR
---

target_pr = $ARGUMENTS

If target_pr is not provided, use the PR of the current branch.

First, check the github status of the PR. If the status is not success, exit with error.

Execute the following in parallel:

- Call code-reviewer subagent to review the code changes in $target_pr.
- Call security-reviewer subagent to review the security issues in $target_pr.

Integrate and report the execution results from each subagent.

And then, if the code changes are good, call pr-merger subagent to merge the PR.
