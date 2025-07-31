Analyze this project's codebase and update .rulesync/overview.md files as needed.

.rulesync/overview.mdには必ず以下のfrontmatterを定義してください。

---
root: true | false               # Required: Rule level (true for overview, false for details)
targets: ["*"]                   # Required: Target tools (* = all, or specific tools)
description: "" # Required: Rule description
globs: ["**/*"]                  # Required: File patterns
cursorRuleType: "always"         # Optional: Cursor-specific rule type (always, manual, specificFiles, intelligently)
---

.rulesync/overview.md では、rootはtrueです。descriptionには適切な説明を記述してください。
