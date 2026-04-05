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

## Step 1: Gather PR Context

Run the following in parallel:

- Get the PR description and metadata.
- Get the PR diff.
- If needed, inspect changed files individually for deeper context.

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
