---
root: false
targets: ['*']
description: "Claude Code memories specification"
globs: []
---

# Claude Code Memories

https://docs.anthropic.com/en/docs/claude-code/memory

## Overview
A memory system that provides project-specific and user-specific context and instructions to Claude Code.

## Memory Types
1. **Project Memory** (`./CLAUDE.md`): Team-shared project instructions
2. **User Memory** (`~/.claude/CLAUDE.md`): Personal settings common to all projects
3. **Project Memory (Local)**: Deprecated

## Key Features
- Automatically loaded when Claude Code starts
- Can import other files using `@path/to/import` syntax
- Supports relative and absolute path imports
- Maximum import depth is 5 hops

## Memory File Best Practices
- Include specific instructions
- Use structured Markdown with bullet points
- Organize under descriptive headings
- Review and update regularly

## Quick Add Features
- Quick memory addition with `#` at the beginning of lines
- Edit memory files with system editor using `/memory` command

## Search Mechanism
- Recursive search from current working directory to root
- Discover CLAUDE.md files in subtrees when reading specific file regions