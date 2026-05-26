---
targets:
  - "*"
description: >-
  Fetch the most recent maintainer-scrap issues (up to 3) and understand their
  content
---

Fetch the newest scrap issues (GitHub issues labeled `maintainer-scrap`) and understand what each one is about, so you can catch up on recently jotted-down notes before acting on them.

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

Use the language of the current conversation (follow the user's language).
