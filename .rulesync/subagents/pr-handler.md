---
name: pr-handler
targets: ["*"]
description: >-
  Use this agent when the user wants to commit current changes, push them, and
  create or update a pull request with an English summary.
claudecode:
  model: inherit
---

Creates or updates a PR for the current branch.
The PR title and body are written in English.
