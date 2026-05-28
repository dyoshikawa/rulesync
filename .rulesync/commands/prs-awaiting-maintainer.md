---
targets:
  - "*"
description: >-
  List open pull requests where the ball is in the maintainer's court: CI is
  green and the PR is ready for a maintainer to review, re-review, or merge. Use
  when the user wants to see PRs awaiting maintainer action.
---

# List PRs Awaiting Maintainer Action

Identify open pull requests where the ball is in the **maintainer's** court — the PR is ready and the next action belongs to a maintainer (review, re-review, or merge), not the author.

## Signals That the Ball Is on the Maintainer's Side

- CI is fully green: every check is passing, with none failing or pending.
- The PR is not a draft.
- And at least one of:
  - The PR was newly opened and has not been reviewed yet (awaiting first review).
  - The author pushed new commits after a `CHANGES_REQUESTED` review (re-review needed).
  - The author has replied to or resolved the review comments and is now waiting on the maintainer.
  - A maintainer review was requested and has not yet been provided.
- The most recent meaningful activity is from the author (or CI) — not an unanswered maintainer question.

Exclude a PR when the next action clearly belongs to the author (see the complementary `prs-awaiting-author` command): CI failing, unaddressed review comments, changes requested without follow-up commits, or an open maintainer question awaiting the author's reply.

## Step 1: List Open Non-Draft PRs

```bash
gh pr list --state open --limit 100 --json number,title,author,isDraft,createdAt,updatedAt,url,reviewDecision,reviewRequests
```

Skip any PR where `isDraft` is `true`.

## Step 2: Gather Per-PR Signals

For each candidate PR, gather details (run in parallel across PRs where practical):

- **CI status**: `gh pr checks <number>` — treat as green only if every check is passing and none are pending or failing.
- **Reviews and decision**: `gh pr view <number> --json reviewDecision,reviews,latestReviews,reviewRequests`.
- **Discussion and who spoke last**: `gh pr view <number> --comments`, and if needed `gh api repos/{owner}/{repo}/pulls/<number>/comments` for inline review threads.
- **Commit timeline vs. last review time**: to determine whether the author pushed commits after a `CHANGES_REQUESTED` review.

The maintainers for this repository are `dyoshikawa` and `cm-dyoshikawa`; treat an `author_association` of `OWNER`, `MEMBER`, or `COLLABORATOR` as the maintainer side. Use this to decide who the author is and whose turn it is.

## Step 3: Classify

For each PR, decide whether the ball is on the maintainer's side using the signals above. When uncertain, lean toward including it but note the ambiguity rather than guessing silently.

## Step 4: Report

Output a concise list, most recently updated first. For each PR:

- `#<number> <title>` — author, age, and the reason it is the maintainer's turn (e.g., "awaiting first review", "re-review after author pushed fixes", "author replied, ready to merge").
- Include the PR URL so the user can open it quickly.

Keep the report compact: do not paste full diffs or comment bodies. If nothing qualifies, say so explicitly.
