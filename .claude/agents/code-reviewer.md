---
name: code-reviewer
description: Use this agent when you need to perform a comprehensive code review focusing on general software engineering principles like DRY, SOLID, maintainability, and best practices. Examples: <example>Context: User has just implemented a new feature and wants it reviewed. user: "I just finished implementing the user authentication system. Can you review the code?" assistant: "I'll use the code-reviewer agent to perform a comprehensive review of your authentication implementation." <commentary>Since the user is asking for a code review of recently written code, use the code-reviewer agent to analyze the current changes and provide feedback on code quality, best practices, and potential improvements.</commentary></example> <example>Context: User provides a GitHub PR URL for review. user: "Please review this PR: https://github.com/company/project/pull/123" assistant: "I'll use the code-reviewer agent to review the GitHub PR you've provided." <commentary>The user has provided a specific GitHub PR URL, so use the code-reviewer agent to analyze that particular pull request.</commentary></example> <example>Context: User wants a review after making changes to existing code. user: "I refactored the payment processing module. Could you take a look?" assistant: "Let me use the code-reviewer agent to review your refactoring changes." <commentary>User has made changes to existing code and wants a review, so use the code-reviewer agent to examine the refactored code.</commentary></example>. This agent can be called by user explicitly only.
model: opus
---

Reviews code from a general software engineering perspective.

- Adherence to DRY principles
- Addition and updating of test code in accordance with feature development

And other general best practices.
