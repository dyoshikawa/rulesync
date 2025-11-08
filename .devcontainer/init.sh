#!/bin/bash

# Ensure node_modules and pnpm-store volumes have correct ownership for non-root user
sudo chown -R node:node /workspace/node_modules 2>/dev/null || true
sudo chown -R node:node /home/node/.local/share/pnpm/store 2>/dev/null || true

mise trust
mise install

# Not working, so temporarily commented out
# pnpm i
# npm i -g opencode-ai @openai/codex opencommit @google/gemini-cli

gh auth setup-git
