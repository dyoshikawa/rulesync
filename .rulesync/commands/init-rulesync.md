---
description: 'Command: init-rulesync'
targets:
  - claudecode
---

Analyze this project's codebase and update .rulesync/rules/overview.md files as needed. Especially you should read `README.md` and `CONTRIBUTING.md`.

Please always define the following frontmatter in .rulesync/rules/overview.md files.

---
root: true # true that is less than or equal to one file for overview such as AGENTS.md, false for details such as .agents/memories/*.md
targets: ["*"] # * = all, or specific tools
description: "rulesync project overview and development guidelines for unified AI rules management CLI tool"
globs: ["**/*"] # file patterns to match (e.g., ["*.md", "*.txt"])
cursor: # for cursor-specific rules
  alwaysApply: true
  description: "rulesync project overview and development guidelines for unified AI rules management CLI tool"
  globs: ["*"]
---

In .rulesync/rules/overview.md files, root should be true. Please provide an appropriate description in the description field.
