---
targets:
  - "*"
description: >-
  Run the review-full-pr command on another model (github-copilot/gpt-5.4) via
  opencode, then thoroughly investigate and vet the resulting findings, and
  present only the valid ones to the user.
---

# GPT Review Command

Run the review-full-pr command on another model (github-copilot/gpt-5.4) via
opencode, then thoroughly investigate and vet the resulting findings, extract
only the valid ones, and present them to the user.

## Prerequisites

- OpenCode must be installed.
  - If not installed, tell the user it can be installed with `curl -fsSL https://opencode.ai/install | bash`.
- OpenCode must be configured to use GitHub Copilot.
  - If not configured, tell the user to run `opencode` and use the `/connect` command to authenticate with GitHub Copilot.

## 0. Variable Definitions

PR_TARGET = $ARGUMENTS

If no PR URL or PR number is provided, use the PR associated with the current branch as the review target.

## 1. Run review-full-pr via opencode

Run the following command to have the github-copilot/gpt-5.4 model execute the review-full-pr skill via opencode.

```bash
opencode run \
  --model github-copilot/gpt-5.4 \
  "review-full-pr スキルで ${PR_TARGET} をレビューしてください"
```

- `--model github-copilot/gpt-5.4`: Use the GPT-5.4 model.

Capture all output from the command.

## 2. Investigate and Vet the Review Results

For each finding in the review results obtained from opencode, investigate thoroughly using the following steps. Consider using subagents when appropriate.

### 2-1. Verify the Actual Code at the Finding's Location

- Based on the file path and line number in the finding, read the actual code to verify.
- Also check related context (related functions, classes, settings, etc.) that underlies the finding.

### 2-2. Judge the Validity of the Finding

Judge each finding from the following perspectives:

- **Fact check**: Does the finding match the actual code (is it not a hallucination)?
- **Impact**: Does the reported issue actually have an impact?
- **Context understanding**: Is it valid given the project's conventions and architecture?
- **Reproducibility**: Can the reported issue actually occur?

### 2-3. Classify the Finding

- **Valid**: A finding that is confirmed to be a real issue after checking the actual code.
- **Rejected**: A hallucination, misunderstanding, or a finding that is not an issue given the project context.

## 3. Present the Results

Output in the following format.

<Format>
# GPT Review Result

## Overview

- Review target PR: (PR URL or number)
- opencode model: github-copilot/gpt-5.4
- Total findings: N
- Valid findings: M

## Valid Findings

(List only findings judged as valid in the format below. If none, write "None".)

### Finding 1: (Title)

- **File**: `path/to/file.ext:line`
- **Problem**: (What is the problem)
- **Reason**: (Why it is a problem, based on the actual code you verified)
- **Severity**: "Must fix before merge" / "Can be deferred"
- **Recommended fix**: (Specific fix approach)

## Rejected Findings

(List rejected findings and the reasons concisely. If none, write "None".)

- ~~Finding~~: Reason for rejection
  </Format>

## References

- https://opencode.ai/docs/ja
