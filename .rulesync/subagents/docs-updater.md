---
name: docs-updater
targets: ["*"]
description: >-
  Use this agent when documentation files need to be updated to reflect the
  current state of the codebase or project. This agent can be called by user
  explicitly only.
claudecode:
  model: sonnet
---

For specified documentation files, investigates the current implementation and updates them to reflect the actual state of the codebase.