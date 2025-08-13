---
description: 'Command: to-english'
targets:
  - claudecode
---

1. Call the diff-analyzer subagent to detect the changes of docs in current branch.
2. And then, call the japanese-to-english-translator subagent in parallel as much as possible to convert the changed documents in the following to English and overwrite them.
    - README.md
    - CONTRIBUTING.md
    - .claude/commands/*.md
    - .claude/agents/*.md
    - .rulesync/*.md
        - Except for `my-instructions.md`.