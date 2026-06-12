---
targets:
  - "*"
description: "Plan how to port a feature, configuration, or implementation from this repository into another repository. Analyzes the source feature here and the target repo's conventions, then writes a multi-file porting plan (overview, source analysis, target analysis, plan, diff) to tmp/porting-another-repository-{YYYYMMDD-HHmm}/*.md for the user to review and apply manually."
---

arguments = $ARGUMENTS

Parse `arguments` as:

- `target_repo`: the repository to port INTO, in `owner/repo` form, a URL, or a local path
- `scope`: what to port from THIS repository (a feature name, directory, file, or rough description)

If `target_repo` is not provided, ask the user which repository to port into.
If `scope` is not provided, ask the user what part of this repository they want to port.

The direction is fixed: the **source** is this repository, the **target** is `target_repo`. This command never modifies the target repository directly — it only produces a porting plan on disk for the user to apply manually.

## Step 0: Prepare the Output Directory

Compute a single timestamp once and reuse it for every file:

```bash
ts="$(date +%Y%m%d-%H%M)"
out="tmp/porting-another-repository-${ts}"
mkdir -p "${out}"
```

All artifacts in this run go under `${out}/`. Do not recompute the timestamp per file — every file must share the same directory.

## Step 1: Analyze the Source (This Repository)

Understand exactly what is being ported. Prefer Serena MCP symbol tools (`mcp__serena__get_symbols_overview`, `mcp__serena__find_symbol`, `mcp__serena__find_referencing_symbols`) over reading whole files.

Identify, for the requested `scope`:

- The entry points and the files that implement it.
- Its dependencies within this repo (shared utilities, base classes, types, config) that would also need to come along.
- Any build/test/tooling wiring it relies on (scripts, configs, fixtures, CI steps).
- External package dependencies it pulls in.

Write the result to `${out}/01-source-analysis.md`.

## Step 2: Analyze the Target Repository

Understand the target's conventions so the port fits in naturally.

- If `target_repo` is a local path, inspect it directly (Serena/grep/read).
- If it is `owner/repo` or a URL, use `gh repo view`, `gh api repos/<owner/repo>/contents/<path>`, and the deepwiki MCP (`mcp__deepwiki__ask_question`, `mcp__deepwiki__read_wiki_contents`) to learn its structure.

Capture:

- Language, package manager, build/test tooling, and directory layout.
- Where the equivalent of the source feature would live in the target's structure.
- Naming, style, and architectural conventions the port must follow.
- Existing functionality that overlaps or conflicts with what is being ported.

Write the result to `${out}/02-target-analysis.md`.

## Step 3: Produce the Porting Plan

Map source concepts onto the target. Use a small mapping table (source path/symbol → target path/symbol) — it is far easier to read than prose for this.

Cover:

- A step-by-step sequence of changes, ordered so the target stays buildable.
- Required dependency additions (with versions) and tooling/config changes.
- Adaptations needed to match the target's conventions (renames, refactors, API shape changes).
- Risks, open questions, and anything deliberately out of scope.
- A short test/verification plan for the target.

Write the result to `${out}/03-porting-plan.md`.

## Step 4: Produce Concrete Diffs

For each step in the plan, write the concrete code/config the user should add to the target, in fenced blocks labeled with their target file paths. Where an existing target file changes, show a unified-diff-style snippet. Keep these ready to copy-paste.

Write the result to `${out}/04-diff.md`.

## Step 5: Write the Overview and Report

Write `${out}/00-overview.md` last, as the index for the run. It must contain:

- Source repo and `scope`, target repo, and the timestamp.
- A one-paragraph summary of what is being ported and the recommended approach.
- A links list to the other files (`01-source-analysis.md` … `04-diff.md`) with a one-line description of each.
- Top risks and open questions surfaced during the analysis.

Then report to the user:

- The absolute path of `${out}/`.
- A one-line summary of the port (what moves, where it lands).
- The top open questions the user needs to decide before applying the plan.
