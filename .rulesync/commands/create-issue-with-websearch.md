---
targets:
  - "*"
description: >-
  Create a GitHub issue from a vague idea by thoroughly researching the topic
  on the web to sharpen the specification before filing
---

topic = $ARGUMENTS

Use this command when the user only has a rough, fuzzy idea and needs heavy web research to clarify the target specification before creating an issue. If the user already has a concrete, well-scoped task in mind, use `create-issue` instead.

## Step 1: Gather the Initial Idea

Receive the topic from `topic` or the user's description.

If the input is very sparse, ask the user just enough to anchor the research:

- What is the rough area or goal? (e.g., a tool to support, a feature to add, a behavior to change)
- Why do they want it — what problem or limitation triggered the idea?
- Any hard constraints known up front (must/must-not, scope boundaries)?

Do not push for full specification details at this stage. The point of this command is to resolve the unknowns through research, not to force the user to resolve them manually.

## Step 2: Research the Topic on the Web

Investigate the topic thoroughly using `WebSearch` and `WebFetch`. The goal is to raise the resolution of the specification until concrete, defensible design decisions become possible.

Look for, as applicable to the topic:

- Official documentation of any tool, standard, protocol, or API involved — prefer primary sources over blog posts.
- File formats, configuration schemas, naming conventions, and default locations used by the target tool(s).
- Feature support matrices: project vs. global scope, supported file types, known limitations.
- Recent changes, deprecations, or pre-release behavior that might affect the design.
- Prior art: how similar tools or competing implementations solve the same problem.
- Existing discussions (GitHub issues, release notes, RFCs) that reveal open questions or community expectations.

Guidelines while researching:

- Run multiple searches in parallel when the angles are independent.
- Cross-check claims against at least one primary source before relying on them.
- Capture exact URLs, version numbers, and quoted snippets as you go — they will be cited in the issue.
- If a source disagrees with another, note the disagreement explicitly rather than silently picking one side.
- Stop expanding research once the open questions needed to draft the issue are answered; avoid rabbit holes unrelated to the decision.

## Step 3: Research the Codebase

With the web findings in hand, investigate the relevant parts of this repository to ground the issue in the real code:

- Which files, modules, or conventions are affected?
- How do existing, analogous features handle the same concerns (scope, frontmatter, generated output, tests)?
- Which project-specific rules apply (see `CLAUDE.md`, `.claude/rules/**`, `docs/**`)?

Prefer the Serena MCP symbol tools over reading whole files.

## Step 4: Synthesize the Specification

Before drafting, write down internally:

- The sharpened problem statement (one or two sentences).
- The concrete proposal — scope, interfaces, file layout, defaults — as resolved by the research.
- Open questions that research could not close, stated as explicit unknowns.
- Trade-offs and the reasoning behind the chosen direction.

If, after research, the idea still cannot be pinned down to an actionable proposal, stop and report this to the user instead of filing a vague issue.

## Step 5: Draft the Issue

**All issue content (title, body, labels) must be written in English**, regardless of the conversation language.

Use this structure:

```markdown
## Summary

A concise one-liner describing the sharpened proposal.

## Motivation / Purpose

The problem or opportunity, grounded in what the research revealed (user impact, missing capability, spec gap, etc.).

## Background from Research

Key findings from the web research that shape the proposal. Keep it tight — cite sources with links and, where useful, exact version numbers.

## Proposed Specification

The concrete plan the research supports:

- Behavior and scope (project / global, supported inputs, outputs)
- File formats, paths, frontmatter, and defaults
- Interactions with existing features in this repo
- Acceptance criteria / expected behavior

## Open Questions

Unresolved points that need a maintainer decision, each phrased as a concrete question with the options considered.

## References

Bulleted list of the primary sources used, with links.
```

Be faithful to the research: do not assert behavior that was not confirmed. If a claim is inferred rather than verified, label it as such.

## Step 6: Assign Labels

Fetch the repository label vocabulary and choose from it — do not invent labels:

```bash
gh label list
```

Pick a small, precise set (usually 1–3). Typical combinations for this command:

- A type label such as `enhancement`, `documentation`, or `question`.
- `considering` when the proposal is worth discussing but not yet accepted — common for issues created via this command, since the spec was just sharpened and may still need maintainer sign-off.
- `good first issue` only if the final proposal is small, well-scoped, and approachable for newcomers. Fuzzy, research-heavy issues usually are not.

## Step 7: Create the Issue

```bash
gh issue create --title "<concise title>" --body "<drafted body>" --label "<label1>,<label2>,..."
```

## Step 8: Report Result

Output:

- The created issue URL
- Issue title and assigned labels
- A short list of the most important research sources used
- Any open questions that remain for the maintainer to decide
