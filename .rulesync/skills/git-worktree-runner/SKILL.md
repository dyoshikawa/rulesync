---
name: git-worktree-runner
description: >-
  Manages git worktrees using git-worktree-runner (gtr). Use when the user needs
  to create, list, remove, or navigate worktrees with `git gtr` commands, open
  editors or AI tools in worktrees, or manage parallel development branches.
targets:
  - "*"
allowed-tools: "Bash(git-worktree-runner:*)"
---

# Git Worktree Runner (gtr)

git-worktree-runner (gtr) is a CLI tool that wraps `git worktree` with quality-of-life features for modern development workflows including editor and AI tool integration.

## Quick Start

```bash
# Create a new worktree
git gtr new feature-branch

# Create from a remote branch
git gtr new my-branch --from origin/feature-branch

# Open editor in the worktree
git gtr editor feature-branch

# Start AI tool (claude, codex, etc.) in the worktree
git gtr ai feature-branch

# Remove a worktree
git gtr rm feature-branch
```

## Commands

### Creating Worktrees

```bash
# Create a new worktree with a new branch
git gtr new feature-name

# Create from a specific ref (remote branch, tag, commit)
git gtr new my-branch --from origin/main
git gtr new hotfix --from v1.2.3

# Create and immediately open in editor
git gtr new feature -e

# Create and immediately start AI tool
git gtr new feature -a

# Create with both editor and AI tool
git gtr new feature -e -a
```

### Opening Editor / AI Tool

```bash
# Open the configured editor for a worktree
git gtr editor feature-branch

# Start configured AI tool in a worktree
git gtr ai feature-branch
```

### Running Commands

```bash
# Run an arbitrary command in a worktree
git gtr run feature-branch npm test
git gtr run feature-branch pnpm build
```

### Navigation

```bash
# Navigate to a worktree directory
cd "$(git gtr go feature-branch)"
```

### Listing and Managing

```bash
# List all worktrees
git gtr list

# Remove a worktree
git gtr rm feature-branch

# Rename a worktree
git gtr mv old-name new-name
```

## Configuration

```bash
# Set default editor (cursor, vscode, zed, etc.)
git gtr config set gtr.editor.default cursor

# Set default AI tool (claude, codex, opencode, aider, etc.)
git gtr config set gtr.ai.default claude

# Configure files to copy into new worktrees
git gtr config add gtr.copy.include "**/.env"
git gtr config add gtr.copy.include "**/.env.local"
git gtr config add gtr.copy.include "**/.env.example"

# View current configuration
git gtr config list
```

## Example: Parallel AI Development

```bash
# Create isolated worktrees for parallel AI agents
git gtr new feature-auth --from origin/main
git gtr new feature-api --from origin/main
git gtr new bugfix-login --from origin/main

# Start AI tools in each worktree
git gtr ai feature-auth
git gtr ai feature-api
git gtr ai bugfix-login

# Check status of all worktrees
git gtr list

# Clean up when done
git gtr rm feature-auth
git gtr rm feature-api
git gtr rm bugfix-login
```

## Example: PR Review in Isolated Worktree

```bash
# Create a worktree from PR branch
git gtr new review-pr-123 --from origin/pr-branch

# Open in editor to review
git gtr editor review-pr-123

# Run tests in isolation
git gtr run review-pr-123 pnpm test

# Clean up after review
git gtr rm review-pr-123
```

## Example: Hotfix While Working on Feature

```bash
# Current work is on feature-branch, need to do a hotfix
git gtr new hotfix-critical --from origin/main

# Open editor for the hotfix
git gtr new hotfix-critical -e

# After hotfix is done, remove the worktree
git gtr rm hotfix-critical
# Back to feature-branch work without context switching
```
