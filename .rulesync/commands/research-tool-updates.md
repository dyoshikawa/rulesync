---
targets:
  - claudecode
description: >-
  Research recent upstream releases of every rulesync target tool, detect
  capabilities rulesync has not yet followed, and file one GitHub issue per
  tool for the gaps.
---

# Research Tool Updates

TARGET = $ARGUMENTS

Purpose: for every target tool rulesync supports, investigate the tool's recent
releases (official release notes / GitHub releases preferred), compare them
against rulesync's current implementation, and open a per-tool GitHub issue for
any upstream capability rulesync has not yet caught up with. When an issue for
that tool already exists, supplement it with a comment instead of filing a
duplicate.

## Step 0: Determine Scope

- If `TARGET` is provided, investigate **only that tool**. Accept either the
  display name (e.g., `Claude Code`) or the `--targets` id (e.g., `claudecode`).
  Validate it against the supported tool list from Step 1; if it does not match
  any known tool, stop and report the valid options.
- If `TARGET` is empty, investigate **all** supported target tools.

## Step 1: Enumerate Supported Target Tools

Read the **`Supported Tools and Features`** matrix in `README.md`. This matrix
is the authoritative source of what rulesync supports today. Extract, for each
in-scope tool:

- The display name and the `--targets` identifier.
- The currently supported feature columns (`rules`, `ignore`, `mcp`,
  `commands`, `subagents`, `skills`, `hooks`, `permissions`) and their scope
  markers, using the legend:
  - ✅ project mode, 🌏 global mode, 🎮 simulated (project only),
    🔧 MCP tool config.

Do not hardcode the tool list from memory — re-read the matrix each run so the
command stays in sync with the README.

## Step 2: Launch One Research Subagent per Target Tool

For each in-scope tool, delegate the investigation to a subagent via the Agent
tool. Run them in parallel, but cap concurrency to roughly **5 at a time** to
avoid overload; launch the next wave as earlier ones finish.

- `subagent_type`: `general-purpose`
- Role framing: "You are researching upstream updates for a single coding-agent
  tool on behalf of rulesync."
- Inputs to pass:
  - The tool display name and `--targets` id.
  - The tool's matrix row (the features rulesync currently supports and their
    scope markers).
- Instructions to include in the subagent prompt:
  - Start from the `rulesync-feature-research` skill. If
    `references/<tool>.md` exists under that skill, use it as the map of the
    tool's official documentation and feature surfaces.
  - Research the tool's **recent releases**. Prefer primary sources: official
    release notes, changelogs, and GitHub releases. Use `WebSearch` and
    `WebFetch`, and confirm candidate URLs against the primary source. Capture
    exact version numbers, dates, and URLs.
  - For each rulesync feature dimension (`rules`, `ignore`, `mcp`, `commands`,
    `subagents`, `skills`, `hooks`, `permissions`), check whether the upstream
    tool has **introduced or changed** a capability that rulesync has **not yet
    followed** — e.g., new config keys, new file locations or naming, a new
    project/global scope, new hook events, new MCP transports, metadata fields,
    format changes, or deprecated surfaces that rulesync still emits.
  - Ground every claim in rulesync's actual implementation. Inspect the
    relevant `src/**` adapters and processor gates (prefer the Serena MCP
    symbol tools over reading whole files), and validate the generated output
    with a dry-run:

    ```bash
    pnpm run dev generate --targets <id> --features "*" --dry-run
    pnpm run dev generate --targets <id> --features "*" --global --dry-run
    ```

  - Return a structured report. For each gap include: the feature, the upstream
    capability with its source URL and version/date, rulesync's current
    behavior, and a concrete proposed follow-up. If there are no material gaps,
    return exactly `No gaps`.
  - Report only **material capability gaps** — do not list tests, fixtures, or
    refactor chores unless they are required to explain a gap.

## Step 3: Consolidate Findings per Tool

Collect each subagent's report. Group the gaps by tool. Tools that returned
`No gaps` are skipped in the issue-creation step but still appear in the final
report.

## Step 4: File One GitHub Issue per Tool with Gaps

Fetch the label vocabulary once up front so it is ready for issue creation:

```bash
gh label list --limit 100
```

Then, for **each** tool that has gaps, run the duplicate check below before
deciding whether to open a new issue.

### Step 4-1: Check for an Existing Issue (mandatory)

Never open an issue without first checking for a duplicate. Search both open and
recently closed issues, and do not rely on the title alone — a follow-up issue
for the same tool may use different wording.

```bash
gh issue list --state all --search "<tool name>" --json number,title,url,state,labels
gh issue list --state all --search "<--targets id>" --json number,title,url,state,labels
```

Treat an issue as a duplicate when it tracks the same tool's upstream follow-up,
even if it only partially overlaps with the newly found gaps. When a candidate
looks related, read it before deciding:

```bash
gh issue view <issue_number>
gh issue view <issue_number> --comments
```

Branch on the result:

- **A matching issue exists** → go to Step 4-2 (comment, do not open a new
  issue).
- **No matching issue exists** → go to Step 4-3 (create a new issue).

### Step 4-2: Supplement the Existing Issue with a Comment

When a duplicate exists, **do not file a new issue**. Instead, leave a comment on
the existing issue that supplements it with the newly discovered information.

- First read the issue body and its existing comments (Step 4-1) so you only add
  what is **not already covered** — newly found releases, additional gaps, or
  changed/closed gaps. Do not restate information that is already there.
- If the current research surfaced nothing new beyond what the issue already
  records, skip the comment and just note it in the final report.
- Write the comment in English, with the same evidence discipline as a new issue
  (primary-source links and version/date for every claim).

Comment structure:

```markdown
## Upstream update (re-check on <YYYY-MM-DD>)

### Newly found releases / changes

The releases or changes not yet reflected in this issue, each with an inline
link to the primary source and the version/date.

### Additional or changed gaps

Gaps not already listed here, or existing gaps that upstream has since
resolved/deprecated. Use the README support labels (`project`, `global`,
`simulated`, `unsupported`) when describing rulesync's side.

### References

Full clickable URLs for the new sources, with a short note on why each is cited.
```

```bash
gh issue comment <issue_number> --body "<comment>"
```

### Step 4-3: Create a New Issue

When no matching issue exists, create one issue for the tool. **All issue
content (title, body, labels) must be written in English**, regardless of the
conversation language.

- Title: `Follow up <Tool> upstream updates: <short summary>`
- Body structure:

  ```markdown
  ## Summary

  One or two sentences describing the upstream updates rulesync should follow.

  ## Recent Releases

  The relevant recent releases / changes, each with an inline link to the
  primary source and the version/date.

  ## Gaps

  Per feature, what the upstream tool now supports vs. rulesync's current
  behavior, with source links. Use the README support labels (`project`,
  `global`, `simulated`, `unsupported`) when describing rulesync's side.

  ## Proposed Follow-up

  Concrete changes rulesync should make (adapters, scope, frontmatter,
  generated output). Keep it actionable.

  ## References

  Bulleted list of every primary source consulted, with full clickable URLs and
  a short note on why each is cited.
  ```

- Labels: pick a small, precise set from the fetched vocabulary (do not invent
  labels). Always add `maintainer-scrap` (issues filed by this command are
  maintainer scraps). Also add `enhancement` plus `considering`; add `codex`
  for the Codex CLI, and `security` only when relevant.

```bash
gh issue create --title "<title>" --body "<body>" --label "<label1>,<label2>"
```

## Step 5: Report

Output a compact summary, one line per in-scope tool:

- `Filed`: `<Tool>` → `<issue URL>` (short gap summary)
- `Commented (duplicate)`: `<Tool>` → `<existing issue URL>` (what the comment added)
- `Skipped (already covered)`: `<Tool>` → `<existing issue URL>` (duplicate with nothing new to add)
- `No gaps`: `<Tool>`

Then list any tools whose research was inconclusive (e.g., releases could not be
confirmed from primary sources) so the user can follow up manually.
