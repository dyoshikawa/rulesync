---
targets:
  - "*"
description: >-
  Create a GitHub issue that consolidates passed content into a single scrap
  issue with background context and solution details, labeled as
  maintainer-scrap.
---

Create a single GitHub issue that consolidates all the content provided by the user.

## Requirements

- Write the issue entirely in English.
- Always attach the `maintainer-scrap` label to the issue.
- Additionally, judge whether other labels are appropriate based on the content and attach them as needed. For example:
  - `bug` — if the content describes a defect or unexpected behavior
  - `enhancement` — if the content proposes a new feature or improvement
  - `documentation` — if the content relates to docs updates
  - `refactor` — if the content discusses code restructuring
  - Use `gh label list` to check available labels in the repository before attaching.
- Structure the issue so it is easy to understand even when revisited later:
  - **Background**: Describe the context, motivation, and why this matters.
  - **Details**: Include the specific content, observations, or problems passed by the user.
  - **Solution / Next Steps**: Propose a solution or outline actionable next steps.
- Use a clear, descriptive title that summarizes the scrap topic.
- Use `gh issue create` to create the issue.

## Workflow

1. Review the content provided by the user.
2. Organize and enrich it with background information and proposed solutions.
3. Check available labels with `gh label list` and determine which labels to attach in addition to `maintainer-scrap`.
4. Draft the issue body in the structure above.
5. Create the issue with the appropriate labels using `gh issue create --label maintainer-scrap --label <other-labels>`.
