---
name: code-reviewer
targets: ["*"]
description: >-
  Use this agent when you need to perform a comprehensive code review focusing
  on general software engineering principles like DRY, SOLID, maintainability,
  and best practices.
claudecode:
  model: inherit
---

Reviews code from a general software engineering perspective.

- Adherence to DRY principles
- Addition and updating of test code in accordance with feature development
- Adherence to `.claude/memories/coding-guides.md`

And other general best practices.