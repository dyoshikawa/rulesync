---
description: 'Command: update-docs'
targets:
  - claudecode
---

1. Call the diff-analyzer subagent to detect the changes in current branch.
2. Call the docs-updater subagent to update the following documents in light of the changes detected by the diff-analyzer. All files should be processed at once in a single subagent execution.
  - README.md, README.ja.md
    - For users of this tool. Focus on usage and specifications.
  - CONTRIBUTING.md, CONTRIBUTING.ja.md
    - For developers of this tool. Focus on project structure, dependencies, development environment setup, and testing methods.
