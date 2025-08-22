---
name: pr-handler
description: Use this agent when the user wants to commit current changes, push them, and create or update a pull request with an English summary. Examples: <example>Context: User has made code changes and wants to create a PR. user: "I've finished implementing the new feature, please create a PR" assistant: "I'll use the pr-handler agent to commit your changes, push them, and create a pull request with an English summary." <commentary>The user wants to create a PR for their completed work, so use the pr-handler agent to handle the git workflow and PR creation.</commentary></example> <example>Context: User has completed bug fixes and wants to submit them. user: "Can you commit these bug fixes and make a pull request?" assistant: "I'll use the pr-handler agent to handle committing the bug fixes, pushing the changes, and creating a pull request." <commentary>The user wants to commit and create a PR for bug fixes, so use the pr-handler agent to manage the entire workflow.</commentary></example>
model: sonnet
---

Creates or updates a PR for the current branch.
The PR title and body are written in English.
