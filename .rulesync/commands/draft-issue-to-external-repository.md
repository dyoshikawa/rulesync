---
targets:
  - "*"
description: >-
  Draft a GitHub issue targeting a third-party repository (outside this
  project's owner). Researches the target repo's conventions and the topic in
  depth, iterates with the user on scope and tone, and produces a final body
  saved to tmp/external-repository-issues/*.md for the user to post manually
  when gh auth lacks permission on the target.
---

arguments = $ARGUMENTS

Parse `arguments` as:

- `target_repo`: the target repository in `owner/repo` form (or a URL)
- `intent`: the rough idea the user wants to propose (may be vague — this command is designed to sharpen it)

If `target_repo` is not provided, ask the user which repository to file against.
If `intent` is not provided, ask the user what they want to propose.

This command is for proposing a change to a repository **we do not own**. When the target is a repo under the user's own owner, prefer `create-issue` or `create-issue-with-websearch` instead.

## Step 1: Inspect the Target Repository

Before drafting anything, understand the target repo's conventions. Run in parallel:

- `gh repo view <owner/repo> --json description,url,defaultBranchRef,primaryLanguage,latestRelease`
- `gh issue list --repo <owner/repo> --limit 20 --state all --json number,title,labels,state` — read recent titles to learn the house style (prefix tags like `[FEATURE]`, casing, length).
- `gh api repos/<owner/repo>/contents/.github/ISSUE_TEMPLATE` — list templates. If a feature-request template exists, fetch it with `gh api` or a raw URL and note the required sections plus any auto-applied title prefix / labels.
- `gh label list --repo <owner/repo>` — note which labels exist (do not invent labels later).
- Optionally fetch `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md` if present to catch any issue-filing rules.

If no issue template exists, plan to use a light structure (Problem / Proposal / Alternatives / Additional context) that mirrors common feature-request templates.

## Step 2: Research the Topic

Ground the proposal in primary sources before writing anything opinionated.

- Use `WebSearch` / `WebFetch` for official docs of the target project, release notes, and any pre-existing discussion (open/closed issues, PRs, RFCs).
- Use the deepwiki MCP (`mcp__deepwiki__ask_question`, `mcp__deepwiki__read_wiki_contents`) against the target repo for structural questions — it is often faster and more definitive than grepping manually.
- For deep or multi-angle investigation, delegate to a subagent (`Agent` with `subagent_type: "general-purpose"`) with a self-contained prompt. Ask for a definitive answer, not a hedged summary.
- Cross-check any claim the draft will rely on against at least one primary source. If two sources disagree, note the disagreement in the draft rather than silently picking a side.

## Step 3: Ground the Proposal in This Repo

If the proposal implies work on our side (e.g., a new target, a new integrator, a new feature), inspect this repository's state so the draft is accurate:

- Which features / directories / schemas exist here and will need to map to the target's concepts?
- Prefer Serena MCP symbol tools (`mcp__serena__find_symbol`, `mcp__serena__get_symbols_overview`) over reading whole files.
- If the proposal includes popularity / adoption claims, verify the numbers before writing them down. For npm downloads: `curl -s "https://api.npmjs.org/downloads/point/<start>:<end>/<package>"`. For stars/forks: `gh repo view <owner/repo> --json stargazerCount,forkCount`.

## Step 4: Align with the User on Scope and Tone

Before drafting the full body, surface the design choices that most shape the final issue. Ask the user about:

- **Temperature**: "Please consider this" (proposal + offer) vs. "Please implement this" (request). This changes how forceful the body reads and whether to include an explicit implementation offer.
- **Scope boundaries**: minimum-viable vs. full surface. A small, shippable proposal is usually easier to get accepted; follow-ups can be called out explicitly.
- **Hard non-goals**: things deliberately out of scope. Name them so the maintainer doesn't have to ask.
- **Any claims that need numbers**: adoption stats, benchmarks, etc.

Iterate briefly — one or two rounds — until the scope is pinned down. Do not start drafting the full body while these are still open.

## Step 5: Draft in the Conversation Language First

Draft the body in the conversation language (typically Japanese for this user) so the user can review and correct efficiently. Keep the structure that the target repo's template dictates — if the template uses bold-heading prompts like `**Describe the solution you'd like**`, match that exactly. If there is no template, fall back to plain conversational paragraphs.

Style guidance:

- Write like a human teammate proposing to peers in another team, not like an automated bot.
- Lead with the problem and the "why", not with the solution.
- Use small, tight mapping tables when concepts map across systems — tables are much easier to read than a wall of bullets for that case.
- State open questions as concrete decisions the maintainer needs to make, each with the options considered.
- If an implementation offer is appropriate (confirmed in Step 4), close with a short, concrete commitment ("happy to put up the PR — new integrator, target profile, and tests against a sample package").
- Avoid filler like "Thanks for maintaining this great project!" unless genuinely warranted.

Iterate with the user on the draft until they approve it.

## Step 6: Translate the Approved Draft to English

All issue content (title, body, labels) **must be in English** regardless of the conversation language. Translate faithfully — do not "improve" content during translation. Preserve tables, code fences, and links verbatim.

Title conventions:

- If the target template auto-applies a title prefix (e.g., `[FEATURE] `), keep it.
- Otherwise pick a short, imperative title (under 70 characters) that names the change.

## Step 7: Try Posting, Fall Back to Disk

Attempt to create the issue directly:

```bash
gh issue create --repo <owner/repo> \
  --title "<title>" \
  --body-file <path to english body>
```

If the template auto-applies labels, do not pass `--label` (the template wins). If no template auto-applies labels, pass only labels that exist in the repo's label vocabulary gathered in Step 1.

If posting fails (common cause: fine-grained PATs cannot create issues on repos outside the user's owner — `Resource not accessible by personal access token`), do **not** retry blindly. Instead:

1. Save the final English body to `tmp/external-repository-issues/<owner>-<repo>-<slug>.md`, where `<slug>` is a short kebab-case summary of the proposal.
2. At the top of that file include a metadata block (before the issue body) with:
   - `# <suggested issue title>`
   - Target repo
   - Template path used (if any)
   - Suggested title
   - Auto-applied labels (from template frontmatter, if any)
   - A pre-filled new-issue URL of the form `https://github.com/<owner>/<repo>/issues/new?template=<template-filename>` when a template exists, otherwise `https://github.com/<owner>/<repo>/issues/new`
   - A `---` horizontal rule separating the metadata from the issue body
3. Report the path to the user and explain how to post (web UI paste, or re-authenticate `gh` with `gh auth login --web` and let this command retry).

## Step 8: Report

Output:

- If posted: the issue URL, title, and any labels applied.
- If saved to disk: the absolute path of the saved file, the suggested title, and the pre-filled new-issue URL.
- A one-line summary of the proposal's scope (what's in, what's out).
- Any open questions the draft left for the maintainer to decide.
