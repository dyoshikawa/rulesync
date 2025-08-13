---
description: 'Command: to-english-all'
targets:
  - claudecode
---

Call the japanese-to-english-translator subagent to convert the following documents to English and overwrite them. All files should be processed at once in a single subagent execution.

- README.md
- CONTRIBUTING.md
- .claude/commands/*.md
- .claude/agents/*.md
- .rulesync/*.md
    - Except for `my-instructions.md`.
