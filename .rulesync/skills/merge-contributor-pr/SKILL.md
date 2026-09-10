---
name: merge-contributor-pr
description: >-
  Take a contributor's pull request that cannot be merged as-is — usually a
  conflict with main — resolve the blocker without rewriting their commits, and
  merge it with a merge commit so their authorship survives. Use when the user
  wants a PR fixed up and merged while keeping the original author's commits.
targets:
  - "*"
---

# Merge a Contributor PR Without Losing Their Commits

target_pr = the user's request

If `target_pr` is not provided, use the PR of the current branch.

This skill exists for the case where a PR is good but not mergeable — most often
it conflicts with `main` because something else landed first. The goal is to
clear the blocker and merge, while the contributor's commits stay in the history
exactly as they wrote them.

## The Rule That Shapes Everything Else

The author's commits must survive with their authorship, their messages and
their SHAs intact. That rules out the three usual conflict fixes:

- **No rebase** of their branch. A rebase rewrites every commit; even though the
  author field is preserved, the SHAs change and the branch has to be
  force-pushed, which throws away whatever the author pushed in the meantime.
- **No squash merge.** `gh pr merge --squash` collapses the whole PR into one
  commit. Multiple commits become one, and the co-author trailers are what is
  left of the original shape.
- **No amending or cherry-picking** their commits into a branch of your own.

What is left is a **merge commit**: merge `main` _into_ the PR branch to resolve
the conflict, and merge the PR itself with `--merge`. Both add a commit of your
own and touch nothing that already exists.

## Step 1: Read the Current State

Always re-fetch first. A contributor may have pushed since the PR was last
looked at — including in response to a review that was just posted — and acting
on a stale head is how their work gets clobbered.

```bash
git fetch origin main
git fetch origin pull/<pr_number>/head:refs/remotes/origin/pr-<pr_number> --force
gh pr view <pr_number> --json number,title,state,isDraft,mergeable,mergeStateStatus,author,headRefName,headRepositoryOwner,maintainerCanModify,files
```

Stop and report instead of continuing when:

- the PR is not `OPEN`, or is a draft;
- `mergeable` is already `MERGEABLE` and no other blocker is left — there is
  nothing to resolve, so go straight to Step 5;
- `maintainerCanModify` is `false` and the head is a fork. Without it there is
  no way to push the resolution; ask the author to merge `main` into their
  branch themselves, or to enable maintainer edits.

Note the author's login and the head branch — both are needed later.

## Step 2: Inspect the Conflict Read-Only

Find out what actually conflicts before touching a branch:

```bash
git merge-tree --write-tree --name-only origin/main origin/pr-<pr_number>
```

Judge what the conflict is made of:

- **Generated files** (for this repository: `src/generated/docs-content.ts`,
  `README.md` and `docs/reference/supported-tools.md` tables, `.gitignore`,
  `Formula/rulesync.rb`) are never resolved by hand. Take either side, then
  re-run the generator and let it produce the correct merged output.
- **Source and prose conflicts** that only interleave two independent additions
  are safe to resolve mechanically — keep both.
- **A conflict that needs a judgement call about what the author meant** is not
  yours to make. Do not guess. Say so in a PR comment, ask the author to merge
  `main` into their branch, and stop.

## Step 3: Resolve on a Throwaway Local Branch

Never resolve on `main`, and never leave the repository on the work branch
afterwards.

```bash
git switch -c merge-pr-<pr_number> origin/pr-<pr_number>
git merge origin/main --no-edit
```

Resolve each conflicted file per Step 2 — for a generated file, run its
generator (`pnpm run generate:docs-content`, `pnpm run generate:tables`,
`pnpm dev gitignore`) and stage the result rather than editing conflict markers
out by hand. Confirm no marker survives anywhere:

```bash
git diff --check
git grep -n '^<<<<<<< \|^>>>>>>> ' -- . || echo "no conflict markers"
```

Then run the full check before committing anything:

```bash
pnpm cicheck
```

Commit the merge with a message that says what was resolved and how. Only the
conflict resolution belongs in this commit — no drive-by fixes, no review
findings addressed on the author's behalf. Those go in a comment or a follow-up
issue, so the PR the author opened stays the PR that gets merged.

## Step 4: Push the Resolution to the Author's Branch

Push to the head repository, which for a fork PR is the contributor's own:

```bash
git push https://github.com/<head_owner>/<repo>.git HEAD:<head_ref_name>
```

**Never pass `--force` or `--force-with-lease` here.** The push must be a
fast-forward. If it is rejected, that is the safety net doing its job: the
author pushed while this was in progress. Do not override it — delete the local
branch, return to Step 1, and re-read what they pushed. Frequently it makes the
whole resolution unnecessary, because the author rebased or fixed it themselves.

Then leave the local repository as it was found:

```bash
git checkout main
git branch -D merge-pr-<pr_number>
```

## Step 5: Wait for CI, Then Merge

The push restarts the checks, so the earlier green run means nothing now.

```bash
gh pr checks <pr_number> --watch
```

Merge only once every check passes. Never merge while a check is `fail` or
`pending` — `--admin` bypasses required checks and must not be used to force
past red or in-progress CI. If a check fails on the merged result, report it and
leave the PR open.

Two things are worth checking before the merge itself, because a fork PR's head
is untrusted code:

- Confirm the diff still contains only what was reviewed. Compare the PR head
  against the commit that was reviewed and read anything new.
- If the PR touches GitHub Actions workflows, build/release configuration, or
  dependency manifests (`package.json`, lockfiles), stop and ask the user to
  confirm before merging.

Merge with a merge commit — never `--squash`, never `--rebase`:

```bash
gh pr merge <pr_number> --admin --merge
```

Then thank the author and clean up:

```bash
gh pr comment <pr_number> --body "@<author_login> Thank you!"
git checkout main && git pull --prune
```

## Step 6: Verify the History

Confirm the author's commits actually landed under their name:

```bash
git log --format="%h %an <%ae> %s" -5
```

Their commits must appear with their own authorship, alongside the merge commit.
If they do not, something rewrote history — report it rather than glossing over
it.

## Step 7: Report

Report the PR number and title, the author, what the blocker was and how it was
resolved, the merge commit, and the list of the author's commits that survived
into `main`. Mention anything deliberately left out of the resolution commit
(review findings, follow-up issues) so it is not silently dropped.
