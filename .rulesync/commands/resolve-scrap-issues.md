---
targets:
  - "*"
description: >-
  Fetch recent maintainer-scrap issues, validate each with web research, then
  either close the ones that need no action or open a single consolidated pull
  request that resolves the ones that do
---

Fetch the newest scrap issues (GitHub issues labeled `maintainer-scrap`), understand each one, validate whether it is still a real and actionable problem using web research and codebase inspection, and then drive each issue to closure: close the issues that need no action, and resolve the actionable ones — bundling them into a single pull request when there is more than one.

This command extends `understand-scrap-issues`: Steps 1–3 are the same intake flow, and Steps 4 onward add validation and resolution.

## Step 1: Fetch the Latest Scrap Issues

List the most recent open issues that carry the `maintainer-scrap` label. `gh issue list` returns issues in creation order (newest first), so limiting to 3 yields the 3 newest:

```bash
gh issue list --label maintainer-scrap --state open --limit 3 --json number,title,url,createdAt
```

If the result is empty, report that there are no open scrap issues and stop.

## Step 2: Gather Each Issue's Content

For each scrap issue returned, read both the body and the discussion. Run these in parallel across the issues where practical:

```bash
gh issue view <issue_number>
gh issue view <issue_number> --comments
```

If an issue references related pull requests, commits, or files that are needed to understand it, gather that context as well.

## Step 3: Understand and Summarize

For each scrap issue, explain the following based on its content:

1. **Topic:** A one-line summary of what the scrap note is about.
2. **Background:** The context, motivation, or problem the note captures and why it matters.
3. **Details / Findings:** The specific observations, problems, or content recorded in the note.
4. **Proposed Solution / Next Steps:** Any solution or actionable next step mentioned. If none is recorded, state explicitly that it is still undecided.

Keep each summary concise and focused. Present the issues in the order returned (newest first), with the issue number, title, and URL as a heading for each.

## Step 4: Validate Each Issue

Decide, per issue, whether it still describes a real, actionable problem. Combine three angles:

- **Web research (`WebSearch` / `WebFetch`):** Verify any claim that depends on external facts — a tool's current file format, config schema, default location, scope support, deprecation, or recent behavior change. Prefer primary sources (official docs, release notes, source code) over blog posts, and cross-check non-trivial claims against at least one primary source. Capture exact URLs and version numbers; they will be cited. Run independent searches in parallel.
- **Codebase inspection:** Check whether the issue is already resolved, partially handled, or contradicted by the current code. Prefer the Serena MCP symbol tools over reading whole files. Apply the project rules in `CLAUDE.md`, `.claude/rules/**`, and `docs/**` (for example, the feature-change and frontmatter conventions).
- **Issue discussion:** Honor any maintainer decision already recorded in the comments (e.g., "won't do", "superseded by #N").

Classify each issue into exactly one bucket:

- **No action needed** — invalid, obsolete, already fixed, out of scope, a duplicate, or explicitly declined. Record the concrete reason and the evidence (URLs / file references / linked issue) behind it.
- **Action needed** — a real problem confirmed to still exist, with a concrete, defensible fix in mind.

If validation is genuinely inconclusive (the legitimacy cannot be settled by research or code), do not force a decision: leave the issue open, report it as needing a maintainer call, and exclude it from both Step 5 and Step 6.

## Step 5: Close the Issues That Need No Action

For every issue classified as **No action needed**, post an explanatory comment and close it. The comment must state the reason and cite the evidence (inline links to primary sources, file paths, or related issue/PR numbers) so the decision is auditable. Write the comment in English.

```bash
gh issue close <issue_number> --comment "<reason with evidence>"
```

Do not close an issue without leaving this reasoning comment.

## Step 6: Resolve the Issues That Need Action

If no issue is **Action needed**, skip to Step 7.

### 6a. Plan the change

For all actionable issues, decide the concrete edits, grounded in the Step 4 findings. Follow `.claude/rules/feature-change-guidelines.md` where applicable (e.g., `rules-processor.ts` conventions, frontmatter precedence, `gitignore.ts`, scope support, README/docs sync, and preserving the Tool × Feature happy-path tests).

### 6b. Branch

Create one branch for the whole batch. If the current branch is `main` or `master`, create a descriptive branch (e.g., `resolve-scrap-issues-<short-topic>`); otherwise reuse the current working branch.

### 6c. Implement

Make the edits for every actionable issue. When several issues touch the same area, resolve them together coherently rather than with conflicting patches.

### 6d. Verify

Run the project checks and fix anything they surface before committing:

```bash
pnpm cicheck
```

If the change affects generated config files (commands, rules, gitignore, etc.), regenerate them as the relevant docs/rules instruct (for example, `pnpm dev gitignore`) and keep `README.md` and `docs/**` in sync with the implemented behavior.

### 6e. Commit, push, and open ONE consolidated PR

Stage and commit with a clear message, then push:

```bash
git add .
git commit -m "<message>"
git push -u origin <branch-name>
```

Open a single pull request that resolves all actionable issues in the batch. The body must include a `Closes #<n>` line for every issue it fixes so they auto-close on merge:

```bash
gh pr create --title "<title>" --body "<description>"
```

The PR description should include:

- A summary of the changes, grouped by the issue each part resolves.
- `Closes #<issue_number>` lines for every actionable issue (one consolidated PR even when there are multiple issues).
- The validation evidence (key research links) that justified the change.
- A test plan / the result of `pnpm cicheck`.

If a PR already exists for the branch, update it instead of creating a duplicate (use `gh api repos/<owner>/<repo>/pulls/<pr-number> -X PATCH` to avoid GraphQL deprecation warnings).

## Step 7: Report Result

Summarize, per issue:

- **Closed (no action):** issue number, title, and the reason it was closed.
- **Resolved (PR):** issue number, title, and the single PR URL that closes it.
- **Left open (inconclusive):** issue number, title, and what a maintainer still needs to decide.

All issue comments, PR title, and PR body must be written in English regardless of the conversation language. Write the final report to the user in the language of the current conversation.
