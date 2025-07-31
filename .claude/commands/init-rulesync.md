Analyze this project's codebase and update .rulesync/overview.md files as needed.

Please always define the following frontmatter in .rulesync/overview.md files.

---
root: true | false               # Required: Rule level (true for overview, false for details)
targets: ["*"]                   # Required: Target tools (* = all, or specific tools)
description: "" # Required: Rule description
globs: ["**/*"]                  # Required: File patterns
cursorRuleType: "always"         # Optional: Cursor-specific rule type (always, manual, specificFiles, intelligently)
---

In .rulesync/overview.md files, root should be true. Please provide an appropriate description in the description field.
