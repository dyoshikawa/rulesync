#!/bin/bash

# Ensure node_modules volume has correct ownership for non-root user
sudo chown -R node:node /workspace/node_modules 2>/dev/null || true

mise trust
mise install
pnpm i
npm i -g opencode-ai @byterover/cipher @openai/codex opencommit @google/gemini-cli
gh auth setup-git
