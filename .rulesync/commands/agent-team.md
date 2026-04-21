---
targets:
  - claudecode
description: >-
  Form an Agent Team of Implementer and Reviewer subagents to tackle the given
  task, looping implementation and review until the Reviewer reports zero
  high-or-above findings and no more than three mid findings.
---

# Agent Team Command

TASK = $ARGUMENTS

If TASK is not provided, ask the user for the task description and stop.

Coordinate an Agent Team composed of an **Implementer Agent** and a **Reviewer
Agent**. Iterate the implementation/review loop until the exit condition is
satisfied.

## 0. Exit Condition

The loop exits when **both** of the following hold in a single review round:

- **0** findings of severity `high` or `critical`.
- **3 or fewer** findings of severity `mid`.

Findings of severity `low` do not affect the exit condition.

Set a hard safety cap of **10 iterations**. If the exit condition is still not
met at the cap, stop the loop and report the remaining findings to the user for
manual decision.

## 1. Iteration Loop

Repeat the following steps until the exit condition is satisfied.

### 1-1. Implementation Phase

Delegate to the Implementer Agent via the Agent tool.

- `subagent_type`: `general-purpose`
- Role framing: "You are the Implementer Agent on an Agent Team."
- Inputs to pass:
  - The original TASK.
  - All Reviewer findings from the previous round (if any), grouped by
    severity.
- Instructions to include in the prompt:
  - Implement the TASK end-to-end in the current repository.
  - Address every Reviewer finding from the previous round. For each finding,
    either fix it or, if you intentionally reject it, record the reason.
  - Edit files directly; do not only describe changes.
  - Run `pnpm cicheck` (or the narrower `pnpm cicheck:code` / `cicheck:content`
    when appropriate) and fix any failures before returning.
  - Report: a concise summary of the changes, the list of modified files, how
    each previous finding was handled, and the result of the checks.

### 1-2. Review Phase

Delegate to the Reviewer Agent via the Agent tool.

- `subagent_type`: `code-reviewer`
- Role framing: "You are the Reviewer Agent on an Agent Team."
- Inputs to pass:
  - The original TASK.
  - The Implementer's summary and the list of modified files from this round.
- Instructions to include in the prompt:
  - Review the changes for correctness, design quality, tests, and adherence
    to project conventions (see `CLAUDE.md`, `docs/**/*.md`, and
    `.claude/rules/feature-change-guidelines.md`).
  - Also consider security concerns.
  - Produce a findings list. For each finding, include:
    - Sequential number (e.g., `#1`, `#2`).
    - Severity: `low` / `mid` / `high` / `critical`.
    - File path and line number(s).
    - Problem description and recommended fix.
  - At the end of the report, include a **Severity Summary** with the counts
    per severity level so the exit condition can be evaluated mechanically.

### 1-3. Evaluate the Exit Condition

Parse the Reviewer's Severity Summary.

- If `high + critical == 0` **and** `mid <= 3`: exit the loop.
- Otherwise: feed the findings into the next Implementation Phase and
  continue.

Between iterations, emit a short status line to the user such as
`Iteration N complete — high/critical: X, mid: Y, low: Z`.

## 2. Final Report

After the loop exits, report the following to the user:

- **Outcome**: `Converged` (exit condition met) or `Capped` (hit iteration cap).
- **Iterations**: how many rounds were executed.
- **Remaining findings**: the final Severity Summary, plus the full list of
  remaining `mid` and `low` findings (and any `high`/`critical` findings that
  remain when the loop was capped).
- **Changes**: a brief summary of what was implemented and which files were
  modified.
- **Next steps**: suggestions for the user (e.g., create a commit / PR via
  `/commit-push-pr`).

Do **not** auto-commit or open a PR from this command; leave that to the user.
