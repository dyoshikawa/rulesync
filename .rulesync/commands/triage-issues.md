---
targets:
  - "*"
description: >-
  Triage open GitHub issues by reviewing unlabeled ones and applying the most
  appropriate labels based on their content
---

# Triage Open Issues

Review all open GitHub issues that currently have no labels and apply the most appropriate labels based on their content.

## Step 1: List Available Labels

Fetch the full list of labels defined in this repository so the triage stays within the known label set:

```bash
gh label list --limit 100
```

Treat this list as the authoritative vocabulary. Do not invent new labels.

## Step 2: Find Unlabeled Open Issues

Fetch all open issues that have no labels attached:

```bash
gh issue list --state open --search "no:label" --limit 100 --json number,title,author,url
```

If the result is empty, report that nothing needs triage and stop.

## Step 3: Gather Context per Issue

For each unlabeled issue, read the description and the discussion so the label choice is grounded in the actual content:

```bash
gh issue view <issue_number>
gh issue view <issue_number> --comments
```

Run these in parallel across issues where practical.

## Step 4: Decide the Labels

For each issue, pick the labels that best describe it. Typical signals:

- `bug` — something is broken or behaves incorrectly.
- `enhancement` — a new feature, new tool/feature support, or a capability request.
- `documentation` — docs, README, or `docs/**/*.md` changes.
- `refactoring` — internal restructuring without behavior change.
- `improvement` — quality, DX, or polish work that isn't a bug or a new feature.
- `question` — the author is asking for clarification or usage help.
- `duplicate` — already tracked by another issue (link it in a comment if you apply this).
- `invalid` / `wontfix` — only if the issue itself states this or the content clearly indicates it; otherwise skip.
- `good first issue` — small, well-scoped, approachable for newcomers.
- `help wanted` — maintainer explicitly wants external contribution; do not apply speculatively.
- `considering` — proposals that are worth discussing but not yet accepted.
- `high priority` — explicit urgency signals (regression, blocking users, security). Be conservative.
- `security` — security-relevant reports or hardening work.
- `codex` — specific to the Codex CLI integration.
- `maintainer-scrap` — do NOT add this unless the issue body explicitly says so; it's reserved for maintainer-only scratch notes.

Guidelines:

- Prefer a small, precise set of labels (usually 1–3). Do not over-label.
- Combine a type label (`bug` / `enhancement` / `documentation` / `refactoring` / `improvement` / `question`) with optional modifiers (`good first issue`, `considering`, `security`, `codex`) when they clearly apply.
- If the issue is ambiguous or you cannot confidently choose labels, skip it and note it in the final report rather than guessing.

## Step 5: Apply the Labels

Apply the chosen labels using `gh issue edit`. Example:

```bash
gh issue edit <issue_number> --add-label "bug" --add-label "good first issue"
```

Only add labels; do not remove existing ones (these issues have none by definition, but be defensive).

## Step 6: Report

Output a concise summary grouped by action:

- `Labeled`: `#<number> <title>` → `label1, label2` (one line per issue)
- `Skipped (ambiguous)`: `#<number> <title>` → short reason

Keep the report compact; do not repeat the full issue bodies.
