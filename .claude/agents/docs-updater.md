---
name: docs-updater
description: Use this agent when documentation files need to be updated to reflect the current state of the codebase or project. Examples: <example>Context: User has made significant changes to the project structure and needs documentation updated. user: "I've restructured the entire project and added new features. Can you update the README.md to reflect these changes?" assistant: "I'll use the docs-updater agent to analyze the current project state and update the README.md accordingly." <commentary>Since the user is requesting documentation updates to match current project state, use the docs-updater agent to handle this task.</commentary></example> <example>Context: User has completed a feature implementation and wants documentation updated. user: "I just finished implementing the new authentication system. Please update the API documentation and README to include the new endpoints." assistant: "Let me use the docs-updater agent to update the documentation files with the new authentication system details." <commentary>The user needs documentation updated to reflect new implementation, so use the docs-updater agent.</commentary></example>
model: sonnet
---

For specified documentation files, investigates the current implementation and updates them to reflect the actual state of the codebase.
