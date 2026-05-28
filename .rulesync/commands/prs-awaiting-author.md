---
targets:
  - "*"
description: >-
  List open pull requests where the ball is in the author's court: CI is
  failing, review comments are unaddressed, or a maintainer question is awaiting
  the author's reply. Use when the user wants to see PRs awaiting author action.
---

# List PRs Awaiting Author Action

Identify open pull requests where the ball is in the **author's** court — the next action belongs to the PR author (fix CI, address review feedback, answer a question), not a maintainer.

## Signals That the Ball Is on the Author's Side

- CI is failing or has not been made to pass (failing or stuck checks).
- The latest review is `CHANGES_REQUESTED` and the author has not pushed follow-up commits since.
- There are review comments / inline threads the author has not yet replied to or resolved.
- A maintainer asked a question that is awaiting the author's reply.
- The PR is a draft (still work in progress on the author's side).

Exclude a PR when the next action clearly belongs to the maintainer (see the complementary `prs-awaiting-maintainer` command): CI green, author has responded, and the PR is awaiting first review, re-review, or merge.

## Step 1: List Open PRs

```bash
gh pr list --state open --limit 100 --json number,title,author,isDraft,createdAt,updatedAt,url,reviewDecision,reviewRequests
```

Include drafts here — a draft is, by definition, still on the author's side.

## Step 2: Gather Per-PR Signals

For each PR, gather details (run in parallel across PRs where practical):

- **CI status**: `gh pr checks <number>` — flag the PR if any check is failing.
- **Reviews and decision**: `gh pr view <number> --json reviewDecision,reviews,latestReviews` — flag if the decision is `CHANGES_REQUESTED`.
- **Discussion and who spoke last**: `gh pr view <number> --comments`, and if needed `gh api repos/{owner}/{repo}/pulls/<number>/comments` for inline review threads — flag if a maintainer's comment or question is the most recent and remains unanswered.
- **Commit timeline vs. last review time**: to determine whether the author has pushed commits after a `CHANGES_REQUESTED` review (if not, the ball is still with the author).

The maintainers for this repository are `dyoshikawa` and `cm-dyoshikawa`; treat an `author_association` of `OWNER`, `MEMBER`, or `COLLABORATOR` as the maintainer side. Use this to decide who the author is and whose turn it is.

## Step 3: Classify

For each PR, decide whether the ball is on the author's side using the signals above. When uncertain, lean toward including it but note the ambiguity rather than guessing silently.

## Step 4: Report

Output a concise list, most recently updated first. For each PR:

- `#<number> <title>` — author, age, and the reason it is the author's turn (e.g., "CI failing", "changes requested, no follow-up commits", "unanswered review comment", "draft / WIP").
- Include the PR URL so the user can open it quickly.

Keep the report compact: do not paste full diffs or comment bodies. If nothing qualifies, say so explicitly.
