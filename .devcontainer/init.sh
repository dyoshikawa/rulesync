#!/bin/bash
set -euo pipefail

# `~/.bashrc` returns early for non-interactive shells, and `mise activate` only
# updates PATH from PROMPT_COMMAND, which never runs in a script. Use shims so
# mise-managed tools (pnpm, node, go, ...) are directly callable here. Note that
# shims only apply to processes started through them: if `mise.toml` ever grows
# an `[env]` section, this script needs `mise env` / `mise exec` for it.
# Assigning before `eval` keeps `set -e` able to catch a mise failure, which it
# cannot do for `eval "$(...)"`.
mise_shims_env="$(/home/node/.local/bin/mise activate bash --shims)"
eval "$mise_shims_env"

# Ensure node_modules and pnpm-store volumes have correct ownership for non-root user
sudo chown -R node:node /workspace/node_modules 2>/dev/null || true
sudo chown -R node:node /home/node/.pnpm-store 2>/dev/null || true

# Ensure workspace-worktrees volume has correct ownership for non-root user to use gtr
sudo mkdir -p /workspace-worktrees
sudo chown -R node:node /workspace-worktrees 2>/dev/null || true

# Set up the git credential helper before the slower steps below, so a failure
# there cannot leave it unconfigured. `gh auth setup-git` errors out when no
# GitHub credentials are present (GITHUB_TOKEN is optional for contributors), and
# that must not fail container creation.
if gh auth status >/dev/null 2>&1; then
  gh auth setup-git
else
  echo "init.sh: no GitHub credentials found, skipping 'gh auth setup-git'" >&2
fi

# Configure pnpm store directory for devcontainer
pnpm config set store-dir /home/node/.pnpm-store

# Install project dependencies
pnpm install
