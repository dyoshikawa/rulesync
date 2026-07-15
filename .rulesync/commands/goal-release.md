---
targets:
  - "*"
description: >-
  Cut a release end to end: run /draft-release to open the release PR and
  draft GitHub release, wait for CI to turn green, then run /merge-pr to merge
  the release PR. Use when the user wants to draft and merge a release in one
  go, or triggers on "/goal-release".
---

# Goal Release Command

new_version = $ARGUMENTS

This command drives a release all the way to merge. It runs `/draft-release` to
open the release pull request (and create the draft GitHub release), waits for
the PR's CI checks to pass, and then runs `/merge-pr` to merge it.

## 1. Draft the Release

Run the `/draft-release` command with `new_version`.

- If `new_version` is provided (e.g. `v1.2.3` or `1.2.3`), pass it through
  unchanged; `/draft-release` normalizes the `v` prefix itself.
- If `new_version` is empty, pass no argument; `/draft-release` determines the
  next version automatically via the `release-dry-run` skill.

When `/draft-release` finishes, it has:

- created a `release/v<version>` branch with the version-bump commits,
- opened a pull request against `main`, and
- created a draft GitHub release `v<version>` with the release notes.

## 2. Resolve the Release PR

Identify the pull request created in Step 1 from the current
`release/v<version>` branch:

```bash
gh pr view --json number,title,state,headRefName
```

Confirm that `headRefName` matches the `release/v<version>` branch created in
Step 1. This command must only ever merge that release PR — if the resolved PR
is a different one, stop and report to the user instead of merging.

## 3. Wait for CI

Wait for the release PR's GitHub Actions checks to finish:

```bash
gh pr checks <pr_number> --watch
```

- If every check passes, proceed to Step 4.
- If a check fails, investigate and fix the failure on the release branch
  (run `pnpm cicheck` locally, commit, and push), then wait for the re-run.
  Never proceed to the merge while any check is `fail` or `pending`.
- Set a safety cap of **3** fix attempts. If CI is still red after the cap,
  stop and report the failing checks to the user instead of merging.

## 4. Merge the Release PR

Run the `/merge-pr` command with the release PR number. It re-verifies the PR
state and CI status, merges with `gh pr merge --admin --merge`, posts a
thank-you comment, and cleans up the local branch.

## 5. Final Report

Report to the user:

- The merged release PR number and title.
- The new version and a link to the draft GitHub release (publishing the
  release is intentionally left as a manual follow-up step).
- Any CI fixes that were needed along the way.
