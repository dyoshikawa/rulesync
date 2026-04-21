---
targets:
  - "*"
description: >-
  Post a reply comment on a GitHub issue in English with a natural, concise
  writing style, based on the intent passed as arguments
---

arguments = $ARGUMENTS

Parse `arguments` as:

- `target_issue`: the issue number (or URL) to reply to
- `intent`: the gist of the reply the user wants to post (what to say, the stance to take, the points to cover)

If `target_issue` is not provided, ask the user which issue to comment on.
If `intent` is not provided, ask the user what the reply should convey.

## Step 1: Gather Issue Context

Run the following in parallel:

- Get the issue description and metadata: `gh issue view <issue_number>`
- Get the issue comments: `gh issue view <issue_number> --comments`

If the issue references related pull requests, commits, or files that are needed to craft an informed reply, gather that context as well.

## Step 2: Draft the Reply

Based on the issue content and the user's `intent`, draft a reply comment.

- Ground the reply in the actual discussion — address the latest comment or the original issue as appropriate.
- Reflect the user's `intent` faithfully; do not add positions the user did not ask for.
- If relevant context is missing or a decision cannot be made without more information, say so in the reply rather than guessing.

## Step 3: Post the Comment

Post the drafted reply using:

```bash
gh issue comment <issue_number> --body "<reply body>"
```

## Writing Style

Write in **English only**.

Style guidelines — write like a human teammate, not a bot:

- Use plain paragraphs. Avoid headings (`##`), horizontal rules (`---`), and excessive bullet lists.
- Keep it conversational and direct. Say what matters, skip the filler.
- Do not use phrases like "Great point!" or "Thanks for raising this!" unless you genuinely mean it and have nothing else to add.
- Be honest. If you disagree or see an issue, say so clearly but respectfully.
- Short is fine. A two-sentence comment is better than a five-paragraph essay with no substance.

## Step 4: Report

Output the issue number and a brief summary of the comment that was posted.
