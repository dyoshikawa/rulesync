---
root: false
targets:
  - claudecode
description: 'Command: to-english-all'
globs:
  - '**/*'
---

Call the japanese-to-english-translator subagent in parallel as much as possible to convert the following documents to English and overwrite them.

- README.md
- CONTRIBUTING.md
- .claude/commands/*.md
- .claude/agents/*.md
- .rulesync/*.md
    - Except for `my-instructions.md`.