---
description: 'Command: update-docs-all'
targets:
  - claudecode
---

Call the docs-updater subagent to update the following documents in light of the changes detected by the diff-analyzer. All files should be processed at once in a single subagent execution.

- README.md, docs/**/*.md
  - For users of this tool. Focus on usage and specifications.
- CONTRIBUTING.md
  - For developers of this tool. Focus on project structure, dependencies, development environment setup, and testing methods.