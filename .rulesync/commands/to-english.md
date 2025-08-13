---
description: 'Command: to-english'
targets:
  - claudecode
---

1. Call the diff-analyzer subagent to detect the changes of docs in current branch.
2. And then, call the japanese-to-english-translator subagent to convert the changed documents in the following to English and overwrite them. All files should be processed at once in a single subagent execution.
    - README.md
    - CONTRIBUTING.md
    - .claude/commands/*.md
    - .claude/agents/*.md
    - .rulesync/*.md
        - Except for `my-instructions.md`.