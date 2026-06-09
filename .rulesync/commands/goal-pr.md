---
targets:
  - "*"
description: >-
  Drive a pull request to a clean state and merge it: run /review-pr, fix every
  mid-or-above finding, and repeat until no mid-or-above findings remain, then
  merge. Use when the user wants to finish a PR by reviewing, fixing, and
  merging it, or triggers on "/goal-pr".
---

# Goal PR Command

target_pr = $ARGUMENTS

This command drives a pull request all the way to merge. It repeatedly runs
`/review-pr`, fixes every finding of severity `mid` or above, and merges the PR
once a review round reports no `mid`-or-above findings.

## 0. Determine and Prepare the Target PR

1. If `target_pr` is provided (e.g. `123`, `#123`, or a PR URL), use it.
2. Otherwise, look for the PR of the current branch:

   ```bash
   gh pr view --json number,title,state,headRefName 2>/dev/null
   ```

3. If no PR exists yet, create one (this satisfies the "PR is the goal" intent):
   - Run the `/commit-push-pr` command to commit the current changes, push the
     branch, and open a PR.
   - Then resolve `target_pr` to the freshly created PR number.

Confirm that the current local branch is the PR's head branch, because the fix
phase below must commit and push fixes onto that branch. If they differ, ask the
user how to proceed and stop.

## 1. Exit Condition

The loop exits when a single review round reports:

- **0** findings of severity `mid`, `high`, or `critical`.

In other words, only `low` findings (or no findings at all) may remain. Set a
hard safety cap of **10 iterations**. If the exit condition is still not met at
the cap, stop the loop and report the remaining findings to the user for a
manual decision instead of merging.

## 2. Iteration Loop

Repeat the following until the exit condition is satisfied or the cap is hit.

### 2-1. Review Phase

Run the `/review-pr` command with `target_pr`. It assigns each finding a
severity (`low` / `mid` / `high` / `critical`) and a sequential number, and also
reports the GitHub Actions workflow status.

Note: `/review-pr` only reads remote state and must not switch the local branch.
Keep that constraint intact during the review phase.

### 2-2. Evaluate the Exit Condition

Count the findings by severity from the review result.

- If `mid + high + critical == 0`: exit the loop and go to **Section 3**.
- Otherwise: proceed to the fix phase.

### 2-3. Fix Phase

Fix every finding of severity `mid` or above on the current branch (you may also
fix `low` findings opportunistically). Unlike the review phase, this phase works
on the local branch directly:

1. Edit the relevant files to address each `mid`-or-above finding. If you
   intentionally reject a finding, record the reason and treat it as resolved.
2. Run `pnpm cicheck` (or the narrower `pnpm cicheck:code` / `cicheck:content`
   when appropriate) and fix any failures before continuing.
3. Commit the fixes with a descriptive message and push them to the PR's head
   branch:

   ```bash
   git add . && git commit -m "<message>" && git push
   ```

Emit a short status line such as
`Iteration N — mid: X, high: Y, critical: Z; pushed fixes`, then return to
**Section 2-1** so the updated PR (and its CI) is reviewed again.

## 3. Merge

Once the exit condition is met, merge the PR by running the `/merge-pr` command
with `target_pr`. That command verifies the PR is open, checks GitHub Actions
status, merges with `gh pr merge --admin --merge`, posts a thank-you comment,
and cleans up the local branch.

If CI is still failing or pending at this point, follow `/merge-pr`'s guidance
(wait, investigate, or confirm with the user) rather than blindly merging.

## 4. Final Report

After the loop ends, report to the user:

- **Outcome**: `Merged` (exit condition met and PR merged) or `Capped` (hit the
  iteration cap without converging; not merged).
- **Iterations**: how many review/fix rounds were executed.
- **Final severity summary**: the counts per severity from the last review
  round.
- **Result**: the merged PR number and title, or — when capped — the list of
  remaining `mid`-or-above findings for the user to decide on.
